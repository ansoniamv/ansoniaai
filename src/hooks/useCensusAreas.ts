import { useEffect, useRef, useState } from "react";
import { Popup, type GeoJSONSource, type Map as MLMap, type MapLayerMouseEvent } from "maplibre-gl";
import { areaHex, formatArea, type AcsAttrs, type AreaContext, type AreaLayer, type AreaLevel } from "@/lib/censusLayers";
import {
  dataZoom, fetchGrowthBaseline, fetchTile, fetchVintage, levelFor, mergeTiles, tilesFor,
  type AreaFeature, type Vintage,
} from "@/lib/censusTiles";

const SOURCE = "census-areas";
const FILL = "census-fill";
const LINE = "census-line";
/** The deal layers PipelineMapPage draws. A click on a pin is the pin's, not the area's. */
const PIN_LAYERS = ["points", "clusters"];

export type CensusAreaState = {
  status: "off" | "loading" | "ready" | "error";
  error: string | null;
  level: AreaLevel | null;
  vintage: Vintage | null;
  /** Growth only: the baseline it is measured from. */
  baselineVintage: Vintage | null;
  /** Areas in view, and how many of them have a value for the layer. */
  inView: number;
  withValue: number;
  /** The view needs more tiles than we will fetch; zoom in. */
  tooWide: boolean;
};

const OFF: CensusAreaState = {
  status: "off", error: null, level: null, vintage: null, baselineVintage: null,
  inView: 0, withValue: 0, tooWide: false,
};

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

/** The basemap's first label layer: areas go under it so place names stay legible. */
function firstSymbolLayer(m: MLMap): string | undefined {
  return m.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
}

function vintageLabel(v: Vintage): string {
  return `${v.start}–${String(v.end).slice(2)}`;
}

/**
 * Whole-map census shading under the deal pins.
 *
 * Owns its own source and layers, inserted under the basemap's labels, so the
 * pin effect in PipelineMapPage can tear down and rebuild the deal layers as
 * often as it likes without touching these. `ready` going false — a theme
 * swap reloads the style and drops every layer — is what makes this rebuild.
 */
export function useCensusAreas(
  map: MLMap | null,
  ready: boolean,
  layer: AreaLayer | undefined,
  isDark: boolean,
): CensusAreaState {
  const [state, setState] = useState<CensusAreaState>(OFF);
  const popup = useRef<Popup | null>(null);
  // Read at build time rather than listed as a dependency. A theme change
  // already rebuilds through `ready` (the page clears it, swaps the style,
  // and sets it again once the new one lands); depending on isDark as well
  // would rebuild a second time, onto the old style, in the gap between.
  const dark = useRef(isDark);
  dark.current = isDark;

  useEffect(() => {
    const m = map;
    if (!m || !ready || !layer) {
      setState(OFF);
      return;
    }

    let cancelled = false;
    let request = 0;
    let hovered: string | null = null;
    let vintage: Vintage | null = null;
    let ctx: AreaContext = {};
    let baselineVintage: Vintage | null = null;

    m.addSource(SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      // Feature-state hover keys on the GEOID, which is stable across tiles
      // and refetches; a generated id would not be.
      promoteId: "GEOID",
      attribution: 'Census data: <a href="https://www.census.gov/programs-surveys/acs" target="_blank" rel="noopener">US Census Bureau ACS</a> via Esri Living Atlas',
    });
    const before = firstSymbolLayer(m);
    m.addLayer({
      id: FILL, type: "fill", source: SOURCE,
      paint: {
        "fill-color": ["get", "c"],
        // No-value areas are drawn faintly rather than hidden, so a grey patch
        // reads as "Census has nothing here", not as a hole in the layer.
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.85,
          ["==", ["get", "v"], null], 0.18,
          dark.current ? 0.62 : 0.55,
        ],
      },
    }, before);
    m.addLayer({
      id: LINE, type: "line", source: SOURCE,
      paint: {
        "line-color": dark.current ? "#0B1016" : "#FFFFFF",
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.25, 10, 0.6],
        "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2, 0.5],
      },
    }, before);

    const paint = (features: AreaFeature[], level: AreaLevel, tooWide: boolean, done = true) => {
      let withValue = 0;
      const out = features.map((f) => {
        const v = layer.value(f.properties as AcsAttrs, ctx);
        if (v != null) withValue++;
        return { ...f, properties: { ...f.properties, v, c: areaHex(v, layer) } };
      });
      const src = m.getSource(SOURCE) as GeoJSONSource | undefined;
      src?.setData({ type: "FeatureCollection", features: out });
      setState({
        status: done ? "ready" : "loading", error: null, level, vintage, baselineVintage,
        inView: out.length, withValue, tooWide,
      });
    };

    const refresh = async () => {
      const id = ++request;
      const zoom = m.getZoom();
      const level = levelFor(zoom, layer);
      const z = dataZoom(zoom, level);
      const b = m.getBounds();
      const tiles = tilesFor({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, z);
      if (tiles == null) {
        paint([], level, true);
        return;
      }
      setState((s) => ({ ...s, status: "loading", level }));
      // Each tile is painted as it lands. A tile nobody has asked for in the
      // last hour is cold at Esri's CDN and can take several seconds (7.5 s
      // for a national county tile, measured 2026-10-19; 0.2 s once warm),
      // and waiting on the slowest would leave the whole map blank for it.
      const got: AreaFeature[][] = [];
      try {
        await Promise.all(tiles.map((t) => fetchTile(level, t).then((f) => {
          // A slower answer for a view the user has already left must not
          // overwrite the one they are looking at.
          if (cancelled || id !== request) return;
          got.push(f);
          if (got.length < tiles.length) paint(mergeTiles(got), level, false, false);
        })));
        if (cancelled || id !== request) return;
        paint(mergeTiles(got), level, false);
      } catch (e) {
        if (cancelled || id !== request) return;
        setState((s) => ({ ...s, status: "error", error: (e as Error).message, level }));
      }
    };

    const setup = async () => {
      try {
        vintage = await fetchVintage();
        if (layer.countyOnly) {
          const base = await fetchGrowthBaseline();
          baselineVintage = base.vintage;
          ctx = { baseline: base.population, growthYears: vintage.end - base.vintage.end };
        }
      } catch (e) {
        if (!cancelled) setState({ ...OFF, status: "error", error: (e as Error).message });
        return;
      }
      if (!cancelled) void refresh();
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMove = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (vintage) void refresh(); }, 150);
    };
    m.on("moveend", onMove);

    const setHover = (geoid: string | null) => {
      if (hovered === geoid) return;
      if (hovered && m.getSource(SOURCE)) m.setFeatureState({ source: SOURCE, id: hovered }, { hover: false });
      hovered = geoid;
      if (geoid) m.setFeatureState({ source: SOURCE, id: geoid }, { hover: true });
    };
    const onHover = (e: MapLayerMouseEvent) => setHover((e.features?.[0]?.properties?.GEOID as string) ?? null);
    const onLeave = () => setHover(null);
    m.on("mousemove", FILL, onHover);
    m.on("mouseleave", FILL, onLeave);

    const onClick = (e: MapLayerMouseEvent) => {
      const pins = PIN_LAYERS.filter((l) => m.getLayer(l));
      if (pins.length && m.queryRenderedFeatures(e.point, { layers: pins }).length) return;
      const p = e.features?.[0]?.properties as (AcsAttrs & { v: number | null }) | undefined;
      if (!p) return;
      // A null property does not survive tiling — it arrives absent — so
      // anything that is not a finite number is no value.
      const v = typeof p.v === "number" && Number.isFinite(p.v) ? p.v : null;
      const moe = v != null ? layer.moe?.(p) : null;
      const place = [p.NAME, p.State].filter(Boolean).join(", ");
      const valueLine = v != null
        ? escapeHtml(formatArea(v, layer))
          + (moe != null ? ' <span style="opacity:.7">± ' + escapeHtml(layer.format(moe)) + "</span>" : "")
        : '<span style="opacity:.75">' + (layer.countyOnly && !ctx.baseline?.has(p.GEOID)
          ? "county boundary changed since the baseline" : "not published for this area") + "</span>";
      const source = vintage
        ? "ACS " + (layer.countyOnly && baselineVintage
          ? vintageLabel(baselineVintage) + " → " + vintageLabel(vintage)
          : vintageLabel(vintage)) + " 5-yr"
        : "ACS 5-yr";
      const el = document.createElement("div");
      el.innerHTML = [
        '<div style="font-weight:600;font-size:13px;margin-bottom:2px">' + escapeHtml(place || p.GEOID) + "</div>",
        '<div style="font-size:11px;line-height:1.7">',
        "<div><strong>" + escapeHtml(layer.label) + ":</strong> " + valueLine + "</div>",
        typeof p.B01001_001E === "number"
          ? "<div><strong>Population:</strong> " + p.B01001_001E.toLocaleString("en-US") + "</div>" : "",
        '<div style="opacity:.7">' + escapeHtml(source) + " · GEOID " + escapeHtml(p.GEOID) + "</div>",
        "</div>",
      ].join("");
      popup.current?.remove();
      popup.current = new Popup({ closeButton: true, maxWidth: "260px" })
        .setLngLat(e.lngLat).setDOMContent(el).addTo(m);
    };
    m.on("click", FILL, onClick);

    setState({ ...OFF, status: "loading" });
    void setup();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      m.off("moveend", onMove);
      m.off("mousemove", FILL, onHover);
      m.off("mouseleave", FILL, onLeave);
      m.off("click", FILL, onClick);
      popup.current?.remove();
      // After a theme swap the style is new and these are already gone.
      try {
        if (m.getLayer(LINE)) m.removeLayer(LINE);
        if (m.getLayer(FILL)) m.removeLayer(FILL);
        if (m.getSource(SOURCE)) m.removeSource(SOURCE);
      } catch {
        // The map was removed first (page unmount); nothing left to clean.
      }
    };
  }, [map, ready, layer]);

  return state;
}

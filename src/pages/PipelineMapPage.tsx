import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Map as MLMap, Popup, NavigationControl, LngLatBounds,
  type GeoJSONSource, type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// Side-effect import: sets the worker URL before any Map is constructed.
import "@/lib/maplibreWorker";
import { Layers, Maximize2, Minimize2, Search, X } from "lucide-react";
import { useMapDeals, type MapDeal } from "@/hooks/useMapDeals";
import { useDealCrime, type DealCrime } from "@/hooks/useDealCrime";
import { useMapPrefs } from "@/hooks/useMapPrefs";
import { searchDealsByName } from "@/lib/dealSearch";
import { useMapSignals, type MapSignal } from "@/lib/marketData";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ACTIVE_STATUSES, DEAL_STATUSES, DEAL_STATUS_HEX, getStatus, type DealStatus,
} from "@/lib/dealStatus";
import {
  BASEMAP_DARK, BASEMAP_LIGHT, CRIME_BUCKETS, CRIME_UNKNOWN_HEX, GRADED_BY_ID,
  GRADED_LAYERS, NO_DATA_HEX, bandHex, crimeBucket, legendBands,
  type GradedLayer, type LayerGroup, type LayerId,
} from "@/lib/mapLayers";

type Located = MapDeal & { latitude: number; longitude: number };

/** A deal is mappable only with BOTH coordinates; one alone is meaningless. */
function isLocated(d: MapDeal): d is Located {
  const lat = (d as unknown as { latitude: number | null }).latitude;
  const lng = (d as unknown as { longitude: number | null }).longitude;
  return typeof lat === "number" && typeof lng === "number"
    && Number.isFinite(lat) && Number.isFinite(lng)
    // 0,0 sits in the Atlantic. It is the classic "failed geocode written as a
    // number" value, so it counts as missing rather than being plotted there.
    && !(lat === 0 && lng === 0);
}

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains("dark")));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

function addressOf(d: MapDeal): string {
  const a = d as unknown as Record<string, string | null>;
  return [a.address ?? a.property_address, a.city, a.state].filter(Boolean).join(", ") || "No address";
}

/** The floating surface shared by every control that sits on the map. */
const PANE = "rounded-lg border border-hairline bg-card/95 backdrop-blur-sm shadow-lg";

/**
 * What a deal reads for the active layer.
 *
 * Three outcomes, kept apart on purpose. A number is a measurement. `stale`
 * means a number exists but describes somewhere the deal no longer is — the 33
 * deals whose coordinates were corrected after Esri measured their rings.
 * `null` means nothing was ever measured. Collapsing the last two into "no
 * value" would be survivable; collapsing either into a number would not.
 */
type Reading = { value: number | null; stale: boolean; reason: string | null };

const NOTHING: Reading = { value: null, stale: false, reason: null };

function readLayer(
  deal: MapDeal,
  layer: GradedLayer,
  signals: Map<string, MapSignal> | undefined,
): Reading {
  if (layer.source === "esri") {
    // Same rule as the crime layer: a ring measured around the old point says
    // nothing about the neighbourhood the deal is actually in.
    if (deal.esri_enrichment_stale === true) {
      return { value: null, stale: true, reason: "location corrected — enrichment pending" };
    }
    const raw = layer.id === "median_income" ? deal.median_income_tract : deal.population_growth_pct;
    return typeof raw === "number" && Number.isFinite(raw)
      ? { value: raw, stale: false, reason: null }
      : NOTHING;
  }

  // CoStar. The submarket is picked by hand on the deal page, so most of the
  // book has none until someone does that, and that is what the pin says.
  const code = deal.costar_submarket_code;
  if (!code) return { value: null, stale: false, reason: "no submarket picked" };
  const row = signals?.get(code);
  if (!row) return { value: null, stale: false, reason: "submarket not in this import" };
  const raw = row[layer.id as keyof MapSignal];
  return typeof raw === "number" && Number.isFinite(raw)
    ? { value: raw, stale: false, reason: null }
    : { value: null, stale: false, reason: "not published for this submarket" };
}

const GROUP_ORDER: LayerGroup[] = ["Deal", "Demographics", "Supply & market"];

/** The popup line for the active layer: the number, or why there isn't one. */
function layerLine(
  deal: MapDeal,
  layer: GradedLayer,
  signals: Map<string, MapSignal> | undefined,
): string {
  const r = readLayer(deal, layer, signals);
  if (r.value != null) return escapeHtml(layer.format(r.value));
  return '<span style="opacity:.75">' + escapeHtml(r.reason ?? "no data") + "</span>";
}

/**
 * Jump to a deal by name.
 *
 * Searches every deal, not just the pins on screen. A deal hidden by the status
 * filter is still found — picking it turns its status back on — and a deal with
 * no coordinates is listed as such and opens its page, because a search that
 * silently misses a deal you know exists reads as "that deal is gone".
 */
function MapDealSearch({ deals, hidden, onPick, disabled }: {
  deals: MapDeal[];
  hidden: (d: MapDeal) => boolean;
  onPick: (d: MapDeal) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => searchDealsByName(deals, query), [deals, query]);
  useEffect(() => setActive(0), [query]);

  const pick = (d: MapDeal) => {
    onPick(d);
    setQuery(d.property_name ?? "");
    setOpen(false);
    input.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (results.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (e.key === "Enter") {
      const d = results[active];
      if (d) { e.preventDefault(); pick(d); }
    } else if (e.key === "Escape") {
      if (open && query) setOpen(false);
      else { setQuery(""); input.current?.blur(); }
    }
  };

  const showList = open && query.trim().length > 0;

  return (
    <div className="relative z-20 pointer-events-auto shrink-0">
      <div className={PANE + " flex items-center h-9 px-2.5 gap-2"}>
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label="Search deals by name"
          aria-expanded={showList}
          aria-controls="map-deal-search-results"
          aria-activedescendant={showList && results[active] ? "map-deal-result-" + results[active].id : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search deals…"
          value={query}
          disabled={disabled}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground disabled:opacity-50 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            // mousedown, not click: the input's blur fires first and would
            // close the list before a click could land.
            onMouseDown={(e) => { e.preventDefault(); setQuery(""); input.current?.focus(); }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showList && (
        <ul
          id="map-deal-search-results"
          role="listbox"
          className={PANE + " absolute left-0 right-0 top-full mt-1 py-1 max-h-72 overflow-y-auto"}
        >
          {results.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">No deals match “{query.trim()}”</li>
          )}
          {results.map((d, i) => {
            const located = isLocated(d);
            const place = [d.city, d.state].filter(Boolean).join(", ");
            const note = !located ? "No location — opens deal" : hidden(d) ? "Hidden by status filter" : null;
            return (
              <li
                key={d.id}
                id={"map-deal-result-" + d.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => { e.preventDefault(); pick(d); }}
                onMouseEnter={() => setActive(i)}
                className={
                  "flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs "
                  + (i === active ? "bg-muted" : "")
                }
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: DEAL_STATUS_HEX[getStatus(d)] }}
                />
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium">{d.property_name}</span>
                  {(place || note) && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[place, note].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function PipelineMapPage() {
  const navigate = useNavigate();
  const { data: deals, isPending: dealsPending, error: dealsError } = useMapDeals();
  const { data: crime, error: crimeError } = useDealCrime();
  const { data: signals, error: signalsError } = useMapSignals();
  const { prefs, setPrefs, loaded } = useMapPrefs();
  const isDark = useIsDark();

  const shell = useRef<HTMLDivElement | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MLMap | null>(null);
  const popup = useRef<Popup | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // The panel covers most of a phone screen, so it starts out of the way there
  // and stays open on a desktop, where there is room for it beside the pins.
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1024);

  const all = useMemo(() => deals ?? [], [deals]);
  const located = useMemo(() => all.filter(isLocated), [all]);
  const missing = useMemo(() => all.filter((d) => !isLocated(d)), [all]);

  const countsByStatus = useMemo(() => {
    const m = new Map<DealStatus, number>();
    for (const d of located) {
      const s = getStatus(d);
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [located]);

  const visible = useMemo(
    () => located.filter((d) => prefs.visible.includes(getStatus(d))),
    [located, prefs.visible],
  );

  /** The active layer, or undefined for the two categorical modes. */
  const layer = GRADED_BY_ID.get(prefs.colorMode);

  const colorOf = useCallback((d: Located): string => {
    if (prefs.colorMode === "status") return DEAL_STATUS_HEX[getStatus(d)];
    // A stale reading colours grey, like "never enriched". Its index is for
    // the old coordinate, so shading the pin by it would state something
    // confident and wrong about the neighbourhood the deal is actually in.
    if (prefs.colorMode === "crime") {
      return crimeBucket(crime?.get(d.id)?.index)?.hex ?? CRIME_UNKNOWN_HEX;
    }
    if (!layer) return NO_DATA_HEX;
    const r = readLayer(d, layer, signals);
    return r.value == null ? NO_DATA_HEX : bandHex(r.value, layer);
  }, [prefs.colorMode, crime, layer, signals]);

  const geojson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: visible.map((d) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [d.longitude, d.latitude] },
      properties: { id: d.id, color: colorOf(d) },
    })),
  }), [visible, colorOf]);

  /**
   * How many of the pins on screen actually carry a value for this layer.
   *
   * Shown next to the legend because a map where most pins are grey and a map
   * where most are green look equally authoritative from across the room. The
   * previous scorer's whole failure was a number that did not say how much of
   * it was measured.
   */
  const coverage = useMemo(() => {
    if (!layer) return null;
    let withValue = 0;
    for (const d of visible) if (readLayer(d, layer, signals).value != null) withValue++;
    return { withValue, total: visible.length };
  }, [layer, visible, signals]);

  useEffect(() => {
    if (!container.current || map.current) return;
    const m = new MLMap({
      container: container.current,
      style: isDark ? BASEMAP_DARK : BASEMAP_LIGHT,
      center: [-89, 39.5],
      zoom: 3.4,
    });
    // Top left. The top right is the filter panel, and the bottom right is
    // where AppLayout fixes the Ask Atlas and page-search buttons — they are
    // position:fixed and sit above the map, so zoom controls put there are
    // simply buried.
    m.addControl(new NavigationControl({ showCompass: false }), "top-left");
    m.on("load", () => setReady(true));
    map.current = m;
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The canvas is sized once, from the container, and does not follow it. Every
  // way this page changes shape — the sidebar collapsing, entering fullscreen,
  // the window resizing — moves the container without telling MapLibre, and the
  // result is a canvas that no longer covers its box or spills past it.
  useEffect(() => {
    const el = container.current;
    const m = map.current;
    if (!el || !m) return;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  // Fullscreen state is read from the browser's own event rather than from the
  // click, so Escape — which exits without going through our button — leaves
  // the icon telling the truth.
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = shell.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen().catch((e) => console.warn("[map] fullscreen refused:", e));
    }
  }, []);

  // Theme swap. The style reload drops our source and layers, so `ready` is
  // cleared and the data effect below rebuilds them once the new style lands.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    setReady(false);
    m.setStyle(isDark ? BASEMAP_DARK : BASEMAP_LIGHT);
    m.once("styledata", () => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  /** The popup a pin shows when clicked — and the one search opens on arrival. */
  const openPopup = useCallback((deal: Located) => {
    const m = map.current;
    if (!m) return;
    popup.current?.remove();
    const c = crime?.get(deal.id);
    const bucket = crimeBucket(c?.index);
    const status = getStatus(deal);
    // A stale reading never shows its number. The enrichment was measured
    // around a point the deal has since moved away from, so the honest line
    // is that it is pending, not a figure for the wrong neighbourhood.
    const crimeLine = c?.stale
      ? '<span style="opacity:.75">location corrected &mdash; enrichment pending</span>'
      : c?.index != null
        ? Math.round(c.index) + ' <span style="opacity:.7">(' + escapeHtml(bucket?.label ?? "") + ")</span>"
        : "not enriched";
    const el = document.createElement("div");
    el.innerHTML = [
      '<div style="font-weight:600;font-size:13px;margin-bottom:2px">' + escapeHtml(deal.property_name ?? "Untitled") + "</div>",
      '<div style="font-size:11px;opacity:.75;margin-bottom:6px">' + escapeHtml(addressOf(deal)) + "</div>",
      '<div style="font-size:11px;line-height:1.7">',
      "<div><strong>Units:</strong> " + ((deal as unknown as { unit_count: number | null }).unit_count ?? "&mdash;") + "</div>",
      "<div><strong>Year built:</strong> " + ((deal as unknown as { vintage_year: number | null }).vintage_year ?? "&mdash;") + "</div>",
      "<div><strong>Crime index:</strong> " + crimeLine + "</div>",
      // The active layer's own reading, so clicking a grey pin says why it
      // is grey rather than leaving the colour to be guessed at.
      layer ? "<div><strong>" + escapeHtml(layer.label) + ":</strong> " + layerLine(deal, layer, signals) + "</div>" : "",
      '<div style="margin-top:4px"><span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:10px;font-weight:600;color:#fff;background:'
        + DEAL_STATUS_HEX[status] + '">' + escapeHtml(status) + "</span></div>",
      "</div>",
      '<button type="button" data-open-deal style="display:inline-block;margin-top:8px;font-size:11px;font-weight:600;text-decoration:underline;background:none;border:0;padding:0;cursor:pointer;color:inherit">Open deal</button>',
    ].join("");
    // Router navigation, not a raw href: an <a> would reload the whole SPA,
    // losing the map, the fitted bounds and every cached query.
    el.querySelector("[data-open-deal]")?.addEventListener("click", () => {
      popup.current?.remove();
      navigate("/deals/" + deal.id);
    });
    popup.current = new Popup({ closeButton: true, maxWidth: "260px" })
      .setLngLat([deal.longitude, deal.latitude])
      .setDOMContent(el)
      .addTo(m);
  }, [crime, layer, signals, navigate]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    for (const id of ["clusters", "cluster-count", "points"]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource("deals")) m.removeSource("deals");

    m.addSource("deals", {
      type: "geojson",
      data: geojson,
      cluster: true,
      clusterRadius: 48,
      clusterMaxZoom: 12,
    });

    m.addLayer({
      id: "clusters", type: "circle", source: "deals", filter: ["has", "point_count"],
      paint: {
        "circle-color": isDark ? "#2A3442" : "#D7DEE8",
        "circle-stroke-color": isDark ? "#4C5A6E" : "#9AA8BC",
        "circle-stroke-width": 1,
        "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 30, 28],
      },
    });
    m.addLayer({
      id: "cluster-count", type: "symbol", source: "deals", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 },
      paint: { "text-color": isDark ? "#E6ECF5" : "#1B2838" },
    });
    m.addLayer({
      id: "points", type: "circle", source: "deals", filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": 7,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": isDark ? "#0B1016" : "#FFFFFF",
      },
    });

    const cursorOn = () => { m.getCanvas().style.cursor = "pointer"; };
    const cursorOff = () => { m.getCanvas().style.cursor = ""; };
    m.on("mouseenter", "points", cursorOn);
    m.on("mouseleave", "points", cursorOff);
    m.on("mouseenter", "clusters", cursorOn);
    m.on("mouseleave", "clusters", cursorOff);

    const onCluster = (e: MapMouseEvent) => {
      const f = m.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
      if (!f) return;
      const src = m.getSource("deals") as GeoJSONSource;
      void src.getClusterExpansionZoom(f.properties.cluster_id as number).then((z) => {
        m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z });
      });
    };
    m.on("click", "clusters", onCluster);

    const onPoint = (e: MapMouseEvent) => {
      const f = m.queryRenderedFeatures(e.point, { layers: ["points"] })[0];
      if (!f) return;
      const deal = visible.find((d) => d.id === f.properties.id);
      if (deal) openPopup(deal);
    };
    m.on("click", "points", onPoint);

    return () => {
      m.off("click", "clusters", onCluster);
      m.off("click", "points", onPoint);
      m.off("mouseenter", "points", cursorOn);
      m.off("mouseleave", "points", cursorOff);
      m.off("mouseenter", "clusters", cursorOn);
      m.off("mouseleave", "clusters", cursorOff);
    };
  }, [ready, geojson, isDark, visible, openPopup]);

  /**
   * Fly to a deal picked in the search box and open its popup.
   *
   * Zoom 14 is past clusterMaxZoom (12), so the deal lands as its own pin
   * rather than inside a cluster bubble. A deal the status filter is hiding
   * gets its status switched back on first — flying to an empty spot on the
   * map would read as "this deal is not here".
   */
  const goToDeal = useCallback((deal: Located) => {
    const m = map.current;
    if (!m) return;
    const status = getStatus(deal);
    if (!prefs.visible.includes(status)) setPrefs({ ...prefs, visible: [...prefs.visible, status] });
    m.flyTo({ center: [deal.longitude, deal.latitude], zoom: Math.max(m.getZoom(), 14), duration: 900 });
    openPopup(deal);
  }, [prefs, setPrefs, openPopup]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || fitted.current || visible.length === 0) return;
    const b = new LngLatBounds();
    for (const d of visible) b.extend([d.longitude, d.latitude]);
    // Right padding clears the filter panel, so the easternmost deal is not
    // fitted to a piece of the map the panel is sitting on top of.
    m.fitBounds(b, {
      padding: { top: 56, bottom: 56, left: 56, right: panelOpen ? 296 : 56 },
      maxZoom: 11,
      duration: 0,
    });
    fitted.current = true;
  }, [ready, visible, panelOpen]);

  const toggle = (s: DealStatus) => {
    const next = prefs.visible.includes(s)
      ? prefs.visible.filter((x) => x !== s)
      : [...prefs.visible, s];
    setPrefs({ ...prefs, visible: next });
  };

  // One line describing the data, with its three states kept visibly distinct.
  // A failed or pending query must never render as "0 of 0 located deals":
  // that is a sentence about the data, and it reads as "you have no deals"
  // when the truth is "we could not ask".
  /** The CoStar vintage the supply layers are reading, e.g. "2026 Q4". */
  const asOf = useMemo(() => {
    for (const row of signals?.values() ?? []) if (row.as_of) return row.as_of;
    return null;
  }, [signals]);

  const activeLabel = layer
    ? "coloured by " + layer.label.toLowerCase()
    : prefs.colorMode === "crime"
      ? "coloured by Esri crime index"
      : "coloured by status";

  const summary = dealsError
    ? "Deals could not be loaded"
    : dealsPending
      ? "Loading deals…"
      : all.length === 0
        ? "No deals are visible to you"
        : visible.length + " of " + located.length + " located "
          + (located.length === 1 ? "deal" : "deals")
          + " · " + activeLabel;

  return (
    <div ref={shell} className="flex flex-col h-full min-h-0 bg-background">
      {/* One toolbar row rather than a page header: the shell header above
          already says "Map View", and repeating it with a subtitle under it
          costs about a hundred pixels of map for nothing. */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-hairline shrink-0">
        <span
          className={
            "text-xs truncate " + (dealsError ? "text-destructive" : "text-muted-foreground")
          }
        >
          {summary}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant={panelOpen ? "default" : "outline"} size="sm" className="h-7 px-2.5 text-xs"
            onClick={() => setPanelOpen((v) => !v)}
            aria-pressed={panelOpen}
            title={panelOpen ? "Hide map layers" : "Show map layers"}
          >
            <Layers className="h-3.5 w-3.5 mr-1.5" /> Layers
          </Button>
          <Button
            variant="outline" size="sm" className="h-7 px-2"
            onClick={toggleFullscreen}
            title={fullscreen ? "Exit full screen" : "Full screen"}
          >
            {fullscreen
              ? <Minimize2 className="h-3.5 w-3.5" />
              : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        {/* h-full, not "absolute inset-0": maplibre-gl.css sets
            .maplibregl-map { position: relative }, which has the same
            specificity as Tailwind's .absolute and is loaded after it, so the
            container stays position:relative, inset-0 does nothing, and the box
            collapses to height 0 — a map that never draws. The old layout hid
            this behind an explicit h-[620px]. */}
        <div ref={container} className="h-full w-full" />

        {dealsPending && (
          <div className="absolute inset-0 grid place-items-center bg-background/60 text-sm text-muted-foreground">
            Loading deals…
          </div>
        )}

        {/* Alerts float over the map rather than pushing it down, so a warning
            costs no map height and still cannot be missed. */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 w-[min(560px,calc(100%-6rem))] space-y-2 pointer-events-none">
          {dealsError && (
            <div role="alert" className={PANE + " pointer-events-auto border-destructive/40 px-4 py-3 text-sm"}>
              <strong className="font-semibold">Deals could not be loaded.</strong>{" "}
              <span className="text-muted-foreground">
                {(dealsError as Error).message || "Unknown error"}
              </span>
            </div>
          )}
          {/* Zero rows is NOT an error, which is exactly what makes it dangerous.
              RLS on deals is `USING is_approved(auth.uid())`, so a profile that is
              still pending gets an empty array and a 200 — isPending false, error
              null — and the page would otherwise report "0 of 0 located deals",
              indistinguishable from an empty pipeline. With 97 deals in the table,
              seeing none means the account cannot read them, not that none exist. */}
          {!dealsPending && !dealsError && all.length === 0 && (
            <div role="alert" className={PANE + " pointer-events-auto border-amber-500/40 px-4 py-3 text-sm"}>
              <strong className="font-semibold">No deals are visible to this account.</strong>{" "}
              <span className="text-muted-foreground">
                The query succeeded and returned nothing. That usually means the account is still
                pending approval rather than that the pipeline is empty — an admin can approve it
                under Admin → Users.
              </span>
            </div>
          )}
          {crimeError && (
            <div role="alert" className={PANE + " pointer-events-auto border-amber-500/40 px-4 py-3 text-sm"}>
              <strong className="font-semibold">Crime data could not be loaded.</strong>{" "}
              <span className="text-muted-foreground">
                Pins still show, but &quot;Colour by crime&quot; will be grey for every deal.{" "}
                {(crimeError as Error).message || ""}
              </span>
            </div>
          )}
        </div>

        {/* The right-hand column: search on top, the layers panel under it.
            One flex column so the panel shrinks to whatever height the search
            box leaves, instead of each guessing at the other's size. The
            column itself ignores the pointer so the map under its empty
            lower half still pans and zooms. */}
        <div className="absolute top-3 right-3 bottom-3 z-10 w-[272px] max-w-[calc(100%-1.5rem)] flex flex-col gap-2 pointer-events-none">
          <MapDealSearch
            deals={all}
            hidden={(d) => isLocated(d) && !prefs.visible.includes(getStatus(d))}
            onPick={(d) => { const id = d.id; if (isLocated(d)) goToDeal(d); else navigate("/deals/" + id); }}
            disabled={!ready}
          />
          {panelOpen && (
            <aside className={PANE + " pointer-events-auto min-h-0 overflow-y-auto"}>
              <div className="flex items-center gap-2 px-3 h-9 border-b border-hairline sticky top-0 bg-card/95 backdrop-blur-sm z-10">
                <span className="text-xs font-semibold">Map layers</span>
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  aria-label="Hide map layers"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
  
              {/* One layer at a time, so a pin's colour always has a single
                  meaning. Radios rather than checkboxes for exactly that reason. */}
              <div className="p-3 space-y-3 border-b border-hairline">
                {GROUP_ORDER.map((group) => {
                  const rows = group === "Deal"
                    ? [{ id: "status" as LayerId, label: "Status" }, { id: "crime" as LayerId, label: "Crime index" }]
                    : GRADED_LAYERS.filter((l) => l.group === group).map((l) => ({ id: l.id, label: l.label }));
                  if (rows.length === 0) return null;
                  return (
                    <div key={group} className="space-y-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-medium">
                          {group}
                        </span>
                        {group === "Supply & market" && asOf && (
                          <span className="text-[10px] text-muted-foreground tabular-nums">{asOf}</span>
                        )}
                      </div>
                      {rows.map((r) => (
                        <label
                          key={r.id}
                          htmlFor={"map-layer-" + r.id}
                          title={GRADED_BY_ID.get(r.id)?.help}
                          className="flex items-center gap-2 text-xs cursor-pointer py-0.5"
                        >
                          <input
                            type="radio"
                            id={"map-layer-" + r.id}
                            name="map-layer"
                            className="accent-primary h-3 w-3 shrink-0"
                            checked={prefs.colorMode === r.id}
                            onChange={() => setPrefs({ ...prefs, colorMode: r.id })}
                            disabled={!loaded}
                          />
                          <span className="flex-1">{r.label}</span>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
  
              {/* Legend for whichever layer is active. */}
              <div className="p-3 space-y-1.5 border-b border-hairline">
                {prefs.colorMode === "crime" && (
                  <>
                    {CRIME_BUCKETS.map((b) => (
                      <div key={b.label} className="flex items-center gap-2 text-xs">
                        <span className="h-3 w-3 rounded-full shrink-0" style={{ background: b.hex }} />
                        <span className="text-muted-foreground">{b.label}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="h-3 w-3 rounded-full shrink-0" style={{ background: CRIME_UNKNOWN_HEX }} />
                      <span className="text-muted-foreground">Not enriched</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground pt-1">100 is the US average.</p>
                  </>
                )}
  
                {layer && (
                  <>
                    {legendBands(layer).map((b) => (
                      <div key={b.label} className="flex items-center gap-2 text-xs">
                        <span className="h-3 w-3 rounded-full shrink-0" style={{ background: b.hex }} />
                        <span className="text-muted-foreground tabular-nums">{b.label}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="h-3 w-3 rounded-full shrink-0" style={{ background: NO_DATA_HEX }} />
                      <span className="text-muted-foreground">No value</span>
                    </div>
                    {/* The one line that stops a mostly-grey map from reading as
                        a finding. Without it, "no data" and "nothing to worry
                        about" look the same from across the room. */}
                    {coverage && (
                      <p className="text-[11px] text-muted-foreground pt-1 tabular-nums">
                        {coverage.withValue} of {coverage.total} shown {coverage.total === 1 ? "deal has" : "deals have"} a value
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">{layer.help}</p>
                    {layer.source === "costar" && signalsError && (
                      <p className="text-[11px] text-destructive">
                        CoStar signals could not be loaded, so every pin is grey.
                      </p>
                    )}
                  </>
                )}
  
                {prefs.colorMode === "status" && (
                  <p className="text-[11px] text-muted-foreground">
                    Pins take their pipeline status colour. The filters below control which appear.
                  </p>
                )}
              </div>
  
              <div className="p-3 space-y-3">
                <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-medium">
                  Status filter
                </div>
  
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 text-xs h-7"
                    onClick={() => setPrefs({ ...prefs, visible: [...DEAL_STATUSES] })}>
                    Show all
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 text-xs h-7"
                    onClick={() => setPrefs({ ...prefs, visible: [...ACTIVE_STATUSES] })}>
                    Active only
                  </Button>
                </div>
  
                <div className="space-y-1.5">
                  {DEAL_STATUSES.map((s) => (
                    <label key={s} htmlFor={"map-st-" + s}
                      className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                      <Checkbox id={"map-st-" + s} checked={prefs.visible.includes(s)}
                        onCheckedChange={() => toggle(s)} disabled={!loaded} />
                      <span className="h-3 w-3 rounded-full shrink-0" style={{ background: DEAL_STATUS_HEX[s] }} />
                      <span className="flex-1">{s}</span>
                      <span className="tabular-nums text-muted-foreground">{countsByStatus.get(s) ?? 0}</span>
                    </label>
                  ))}
                </div>
              </div>
            </aside>
          )}
        </div>

        {/* A deal with no coordinates is invisible on a map by definition, so
            the count stays on screen; the list opens over the map rather than
            holding a column beside it. */}
        {missing.length > 0 && (
          <div className="absolute bottom-3 left-3 z-10 w-[240px] max-w-[calc(100%-1.5rem)]">
            {showMissing && (
              <div className={PANE + " mb-2 max-h-64 overflow-y-auto p-3"}>
                <ul className="space-y-1">
                  {missing.map((d) => (
                    <li key={d.id} className="text-xs">
                      <Link to={"/deals/" + d.id} className="hover:underline">
                        {d.property_name ?? "Untitled"}
                      </Link>
                      <span className="text-muted-foreground"> {"·"} {getStatus(d)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowMissing((v) => !v)}
              aria-expanded={showMissing}
              className={PANE + " px-3 h-8 text-xs text-muted-foreground hover:text-foreground"}
            >
              {missing.length} {missing.length === 1 ? "deal has" : "deals have"} no location
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

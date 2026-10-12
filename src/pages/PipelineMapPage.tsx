import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Map as MLMap, Popup, NavigationControl, LngLatBounds,
  type GeoJSONSource, type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// Side-effect import: sets the worker URL before any Map is constructed.
import "@/lib/maplibreWorker";
import { Layers, Maximize2, Minimize2, SlidersHorizontal, X } from "lucide-react";
import { useMapDeals, type MapDeal } from "@/hooks/useMapDeals";
import { useDealCrime } from "@/hooks/useDealCrime";
import { useMapPrefs } from "@/hooks/useMapPrefs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ACTIVE_STATUSES, DEAL_STATUSES, DEAL_STATUS_HEX, getStatus, type DealStatus,
} from "@/lib/dealStatus";
import {
  BASEMAP_DARK, BASEMAP_LIGHT, CRIME_BUCKETS, CRIME_UNKNOWN_HEX, crimeBucket,
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

export default function PipelineMapPage() {
  const navigate = useNavigate();
  const { data: deals, isPending: dealsPending, error: dealsError } = useMapDeals();
  const { data: crime, error: crimeError } = useDealCrime();
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

  const geojson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: visible.map((d) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [d.longitude, d.latitude] },
      properties: {
        id: d.id,
        // A stale reading colours grey, like "never enriched". Its index is for
        // the old coordinate, so shading the pin by it would state something
        // confident and wrong about the neighbourhood the deal is actually in.
        color: prefs.colorMode === "crime"
          ? (crimeBucket(crime?.get(d.id)?.index)?.hex ?? CRIME_UNKNOWN_HEX)
          : DEAL_STATUS_HEX[getStatus(d)],
      },
    })),
  }), [visible, prefs.colorMode, crime]);

  useEffect(() => {
    if (!container.current || map.current) return;
    const m = new MLMap({
      container: container.current,
      style: isDark ? BASEMAP_DARK : BASEMAP_LIGHT,
      center: [-89, 39.5],
      zoom: 3.4,
    });
    // Bottom right, because the top right is now where the filter panel sits.
    m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
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
      if (!deal) return;
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
        .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
        .setDOMContent(el)
        .addTo(m);
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
  }, [ready, geojson, isDark, visible, crime, navigate]);

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
  const summary = dealsError
    ? "Deals could not be loaded"
    : dealsPending
      ? "Loading deals…"
      : all.length === 0
        ? "No deals are visible to you"
        : visible.length + " of " + located.length + " located "
          + (located.length === 1 ? "deal" : "deals")
          + (prefs.colorMode === "crime" ? " · coloured by Esri crime index" : "");

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
          <div className="flex rounded-md border border-hairline overflow-hidden">
            <button
              type="button"
              onClick={() => setPrefs({ ...prefs, colorMode: "status" })}
              className={
                "px-2.5 h-7 text-xs font-medium transition-colors "
                + (prefs.colorMode === "status"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground")
              }
            >
              Status
            </button>
            <button
              type="button"
              onClick={() => setPrefs({ ...prefs, colorMode: "crime" })}
              className={
                "px-2.5 h-7 text-xs font-medium transition-colors flex items-center gap-1 "
                + (prefs.colorMode === "crime"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground")
              }
            >
              <Layers className="h-3 w-3" /> Crime
            </button>
          </div>
          <Button
            variant="outline" size="sm" className="h-7 px-2"
            onClick={() => setPanelOpen((v) => !v)}
            aria-pressed={panelOpen}
            title={panelOpen ? "Hide filters" : "Show filters"}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
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
        <div ref={container} className="absolute inset-0" />

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

        {panelOpen && (
          <aside
            className={
              PANE + " absolute top-3 right-3 z-10 w-[248px] max-w-[calc(100%-1.5rem)] "
              + "max-h-[calc(100%-1.5rem)] overflow-y-auto"
            }
          >
            <div className="flex items-center gap-2 px-3 h-9 border-b border-hairline">
              <span className="text-xs font-semibold">
                {prefs.colorMode === "crime" ? "Crime index" : "Status"}
              </span>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="ml-auto text-muted-foreground hover:text-foreground"
                aria-label="Hide filters"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="p-3 space-y-3">
              {prefs.colorMode === "crime" && (
                <div className="space-y-1.5 pb-2 border-b border-hairline">
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
                  <p className="text-[11px] text-muted-foreground pt-1">
                    100 is the US average. The checkboxes below still control which deals appear.
                  </p>
                </div>
              )}

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

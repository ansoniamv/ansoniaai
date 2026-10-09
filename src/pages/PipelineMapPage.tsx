import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Map as MLMap, Popup, NavigationControl, LngLatBounds,
  type GeoJSONSource, type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin, Layers } from "lucide-react";
import { useDeals, type Deal } from "@/hooks/useDeals";
import { useDealCrime } from "@/hooks/useDealCrime";
import { useMapPrefs } from "@/hooks/useMapPrefs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ACTIVE_STATUSES, DEAL_STATUSES, DEAL_STATUS_HEX, getStatus, type DealStatus,
} from "@/lib/dealStatus";
import {
  BASEMAP_DARK, BASEMAP_LIGHT, CRIME_BUCKETS, CRIME_UNKNOWN_HEX, crimeBucket,
} from "@/lib/mapLayers";

type Located = Deal & { latitude: number; longitude: number };

/** A deal is mappable only with BOTH coordinates; one alone is meaningless. */
function isLocated(d: Deal): d is Located {
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

function addressOf(d: Deal): string {
  const a = d as unknown as Record<string, string | null>;
  return [a.address ?? a.property_address, a.city, a.state].filter(Boolean).join(", ") || "No address";
}

export default function PipelineMapPage() {
  const { data: deals } = useDeals();
  const { data: crime } = useDealCrime();
  const { prefs, setPrefs, loaded } = useMapPrefs();
  const isDark = useIsDark();

  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MLMap | null>(null);
  const popup = useRef<Popup | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [showMissing, setShowMissing] = useState(false);

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
        color: prefs.colorMode === "crime"
          ? (crimeBucket(crime?.get(d.id))?.hex ?? CRIME_UNKNOWN_HEX)
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
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => setReady(true));
    map.current = m;
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const idx = crime?.get(deal.id);
      const bucket = crimeBucket(idx);
      const el = document.createElement("div");
      el.innerHTML = [
        '<div style="font-weight:600;font-size:13px;margin-bottom:2px">' + escapeHtml(deal.property_name ?? "Untitled") + "</div>",
        '<div style="font-size:11px;opacity:.75;margin-bottom:6px">' + escapeHtml(addressOf(deal)) + "</div>",
        '<div style="font-size:11px;line-height:1.7">',
        "<div><strong>Units:</strong> " + ((deal as unknown as { unit_count: number | null }).unit_count ?? "&mdash;") + "</div>",
        "<div><strong>Year built:</strong> " + ((deal as unknown as { vintage_year: number | null }).vintage_year ?? "&mdash;") + "</div>",
        "<div><strong>Crime index:</strong> " + (idx != null
          ? Math.round(idx) + ' <span style="opacity:.7">(' + escapeHtml(bucket?.label ?? "") + ")</span>"
          : "not enriched") + "</div>",
        "<div><strong>Status:</strong> " + escapeHtml(getStatus(deal)) + "</div>",
        "</div>",
        '<a href="/deals/' + deal.id + '" style="display:inline-block;margin-top:8px;font-size:11px;font-weight:600;text-decoration:underline">Open deal</a>',
      ].join("");
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
  }, [ready, geojson, isDark, visible, crime]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || fitted.current || visible.length === 0) return;
    const b = new LngLatBounds();
    for (const d of visible) b.extend([d.longitude, d.latitude]);
    m.fitBounds(b, { padding: 64, maxZoom: 11, duration: 0 });
    fitted.current = true;
  }, [ready, visible]);

  const toggle = (s: DealStatus) => {
    const next = prefs.visible.includes(s)
      ? prefs.visible.filter((x) => x !== s)
      : [...prefs.visible, s];
    setPrefs({ ...prefs, visible: next });
  };

  return (
    <div className="space-y-6 max-w-[1600px]">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold font-display">Map View</h1>
          <p className="text-muted-foreground">
            {visible.length} of {located.length} located {located.length === 1 ? "deal" : "deals"} shown
            {prefs.colorMode === "crime" ? " · coloured by Esri crime index" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={prefs.colorMode === "status" ? "default" : "outline"} size="sm"
            onClick={() => setPrefs({ ...prefs, colorMode: "status" })}>
            Colour by status
          </Button>
          <Button variant={prefs.colorMode === "crime" ? "default" : "outline"} size="sm"
            onClick={() => setPrefs({ ...prefs, colorMode: "crime" })}>
            <Layers className="h-3.5 w-3.5 mr-1.5" /> Colour by crime
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Card className="overflow-hidden">
          <div ref={container} className="h-[480px] sm:h-[620px] w-full" />
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <MapPin className="h-4 w-4" /> {prefs.colorMode === "crime" ? "Crime index" : "Status"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {prefs.colorMode === "crime" && (
                <div className="space-y-2">
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

              <div className="space-y-1.5 pt-1">
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
            </CardContent>
          </Card>

          {missing.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <button type="button" onClick={() => setShowMissing((v) => !v)}
                  className="text-xs text-left underline underline-offset-2">
                  {missing.length} {missing.length === 1 ? "deal has" : "deals have"} no location
                </button>
                {showMissing && (
                  <ul className="mt-2 space-y-1 max-h-56 overflow-y-auto">
                    {missing.map((d) => (
                      <li key={d.id} className="text-xs">
                        <Link to={"/deals/" + d.id} className="hover:underline">
                          {d.property_name ?? "Untitled"}
                        </Link>
                        <span className="text-muted-foreground"> {"·"} {getStatus(d)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

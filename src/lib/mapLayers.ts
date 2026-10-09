/**
 * Shared pieces for the pipeline map.
 *
 * Basemaps are keyless by design — no Mapbox token, no paid Esri basemap. Both
 * styles were confirmed to return 200 without any signup. CARTO is used rather
 * than OpenFreeMap only because it offers a matched light/dark pair, which the
 * app needs for theme parity.
 */
export const BASEMAP_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
export const BASEMAP_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** Key under which legend state is stored in user_preferences. */
export const MAP_PREF_KEY = "pipeline_map_filters";

export type ColorMode = "status" | "crime";

/**
 * Esri crime index buckets.
 *
 * 100 is the US average by Esri's definition, so the bands are set around it
 * rather than around the observed spread. Measured on our own enrichment rows:
 * min 0, mean 169, max 857 — so most of the book sits above the national
 * average and a naive quantile split would have hidden that.
 *
 * Only CRMCYTOTC is used. CRMCYVIOL is requested from Esri but comes back empty
 * on every one of our 145 enriched deals, so a "violent crime" mode would be a
 * control that silently showed nothing.
 */
export const CRIME_BUCKETS: Array<{ max: number; label: string; hex: string }> = [
  { max: 50, label: "Well below average (<50)", hex: "#1A7F5A" },
  { max: 100, label: "Below average (50–100)", hex: "#6FA85F" },
  { max: 200, label: "Above average (100–200)", hex: "#D8A336" },
  { max: 400, label: "High (200–400)", hex: "#D4722C" },
  { max: Infinity, label: "Very high (400+)", hex: "#A8322B" },
];

export function crimeBucket(index: number | null | undefined) {
  if (index == null || Number.isNaN(index)) return null;
  return CRIME_BUCKETS.find((b) => index < b.max) ?? CRIME_BUCKETS[CRIME_BUCKETS.length - 1];
}

/** Grey for a deal with no crime reading, so "unknown" never reads as "good". */
export const CRIME_UNKNOWN_HEX = "#8A8F98";

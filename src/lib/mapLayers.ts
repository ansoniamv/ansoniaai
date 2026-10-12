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

/** Grey for a deal with no reading, so "unknown" never reads as "good". */
export const CRIME_UNKNOWN_HEX = "#8A8F98";
export const NO_DATA_HEX = CRIME_UNKNOWN_HEX;

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

// --------------------------------------------------------------- data layers

/**
 * The layers the map can colour pins by.
 *
 * CoStar's own map shades submarket polygons. We cannot: the CoStar export
 * ships metrics per submarket and no boundary for any of them, which is why a
 * deal is tied to its submarket by an explicit pick rather than a spatial join.
 * Shading an area we had to invent would be a confident statement about ground
 * we have no data for, so the colour goes on the pins, where each value is
 * attached to the one property it was measured for.
 *
 * Every layer is a reading of a real stored column. None is derived, averaged
 * across a gap, or defaulted. A deal with no value for the active layer draws
 * grey and is counted in the legend, because the failure that keeps recurring
 * here is a number that renders identically whether it was measured or made up.
 */
export type LayerId =
  | "status"
  | "crime"
  | "median_income"
  | "population_growth"
  | "uc_pct"
  | "fwd_deliveries_2y_pct"
  | "demand_gap_t12_pct"
  | "occupancy_gap"
  | "concession_change"
  | "rent_forecast_3y_cagr"
  | "cyclical_score";

/** Kept so existing saved preferences still parse. */
export type ColorMode = LayerId;

export type LayerGroup = "Deal" | "Demographics" | "Supply & market";

/** Where a layer's number comes from, which decides what can invalidate it. */
export type LayerSource =
  /** A column on deals, true regardless of coordinates. */
  | "deal"
  /** Esri enrichment, measured around the deal's point — void if the point moved. */
  | "esri"
  /** The CoStar import, via the submarket picked for the deal. */
  | "costar";

export type GradedLayer = {
  id: LayerId;
  group: LayerGroup;
  label: string;
  help: string;
  source: LayerSource;
  /** Which direction is good news. The ramp is flipped so green is always good. */
  better: "higher" | "lower";
  /** Four ascending thresholds, giving five bands. */
  breaks: [number, number, number, number];
  format: (v: number) => string;
};

/** Favourable → unfavourable. Same family as CRIME_BUCKETS, so the map reads consistently. */
export const RAMP = ["#1A7F5A", "#6FA85F", "#D8A336", "#D4722C", "#A8322B"] as const;

const pctOfStock = (v: number) => (v * 100).toFixed(1) + "%";
const signedPct = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(1) + "%";
const signedPp = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(1) + " pp";
const money0 = (v: number) => "$" + Math.round(v).toLocaleString("en-US");
const plainPct = (v: number) => v.toFixed(1) + "%";

/**
 * Breaks are absolute and chosen for what the number means, not from the
 * observed spread. A quantile split would always produce a full rainbow —
 * twenty percent of the book red by construction — and would redraw itself
 * every time a deal was added, so two screenshots a week apart could not be
 * compared. Fixed bands mean "amber" means the same thing next quarter.
 */
export const GRADED_LAYERS: GradedLayer[] = [
  {
    id: "median_income",
    group: "Demographics",
    label: "Median household income",
    help: "Esri's median household income for the deal's census tract. Bands follow the national distribution, not ours.",
    source: "esri",
    better: "higher",
    breaks: [45000, 60000, 75000, 95000],
    format: money0,
  },
  {
    id: "population_growth",
    group: "Demographics",
    label: "Population growth",
    help: "Esri's projected annual population growth around the deal. Below zero is a shrinking renter base.",
    source: "esri",
    better: "higher",
    breaks: [0, 0.5, 1, 1.5],
    format: plainPct,
  },
  {
    id: "uc_pct",
    group: "Supply & market",
    label: "Under construction",
    help: "CoStar units under construction ÷ existing units in the deal's submarket. The only measured forward supply: it delivers in 12–24 months.",
    source: "costar",
    better: "lower",
    breaks: [0.02, 0.04, 0.06, 0.08],
    format: pctOfStock,
  },
  {
    id: "fwd_deliveries_2y_pct",
    group: "Supply & market",
    label: "Deliveries, next 2 yrs",
    help: "CoStar's forecast net deliveries over the next two calendar years ÷ existing units. Includes projects not yet started.",
    source: "costar",
    better: "lower",
    breaks: [0.02, 0.04, 0.06, 0.08],
    format: pctOfStock,
  },
  {
    id: "demand_gap_t12_pct",
    group: "Supply & market",
    label: "Absorption − deliveries",
    help: "Trailing-12-month absorption minus deliveries, ÷ existing units. Positive means demand is outrunning new supply.",
    source: "costar",
    better: "higher",
    breaks: [-0.02, -0.005, 0.005, 0.02],
    format: signedPct,
  },
  {
    id: "occupancy_gap",
    group: "Supply & market",
    label: "Occupancy vs 10-yr mean",
    help: "Current occupancy minus the submarket's own average since 2016. Below its norm, landlords lose pricing power regardless of demand.",
    source: "costar",
    better: "higher",
    breaks: [-0.02, -0.01, 0, 0.01],
    format: signedPp,
  },
  {
    id: "concession_change",
    group: "Supply & market",
    label: "Concession change, 1 yr",
    help: "Change in (asking − effective) ÷ asking rent over the past year. Concessions burning off lead headline rent recovery.",
    source: "costar",
    better: "lower",
    breaks: [-0.01, -0.0025, 0.0025, 0.01],
    format: signedPp,
  },
  {
    id: "rent_forecast_3y_cagr",
    group: "Supply & market",
    label: "Rent forecast, 3-yr CAGR",
    help: "CoStar's base-case effective rent growth, annualised over the next three years. Their benchmark, not ours.",
    source: "costar",
    better: "higher",
    breaks: [0.01, 0.02, 0.03, 0.04],
    format: signedPct,
  },
  {
    id: "cyclical_score",
    group: "Supply & market",
    label: "Cyclical score",
    help: "The six signals above as favourability percentiles, averaged. 100 is the best-placed submarket in the export. Blank where fewer than four signals could be computed.",
    source: "costar",
    better: "higher",
    breaks: [20, 40, 60, 80],
    format: (v) => String(Math.round(v)),
  },
];

export const GRADED_BY_ID = new Map(GRADED_LAYERS.map((l) => [l.id, l]));

/** 0–4, ascending in raw value. */
export function bandIndex(value: number, breaks: readonly number[]): number {
  let i = 0;
  while (i < breaks.length && value >= breaks[i]) i++;
  return i;
}

/** The ramp is flipped for "higher is better", so green always means good news. */
export function bandHex(value: number, layer: GradedLayer): string {
  const i = bandIndex(value, layer.breaks);
  return layer.better === "lower" ? RAMP[i] : RAMP[RAMP.length - 1 - i];
}

/** Legend rows, ascending in raw value, each with the colour that band draws. */
export function legendBands(layer: GradedLayer): Array<{ label: string; hex: string }> {
  const f = layer.format;
  const [a, b, c, d] = layer.breaks;
  const labels = [
    `< ${f(a)}`,
    `${f(a)} – ${f(b)}`,
    `${f(b)} – ${f(c)}`,
    `${f(c)} – ${f(d)}`,
    `${f(d)} +`,
  ];
  return labels.map((label, i) => ({
    label,
    hex: layer.better === "lower" ? RAMP[i] : RAMP[RAMP.length - 1 - i],
  }));
}

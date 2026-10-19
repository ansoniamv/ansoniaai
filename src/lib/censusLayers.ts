/**
 * Census area layers for the pipeline map: whole-map shading by county or
 * tract, as opposed to the pin layers in mapLayers.ts, which colour each deal
 * by its own enrichment.
 *
 * Source: Esri's Living Atlas republication of the Census Bureau's ACS 5-year
 * estimates ("ACS Population and Housing Basics"). It is a public hosted
 * feature layer — no key, no token, no credits — so panning the map costs
 * nothing, unlike the GeoEnrichment calls behind esri-enrich. Checked by hand
 * 2026-10-19: 85,034 tracts, 3,222 counties, CORS open, nulls (not Census's
 * -666666666 sentinels) where a value is suppressed.
 *
 * Esri's own tract-level projections (2025–2030 growth and so on) live in the
 * subscriber layer Esri_Updated_Demographics_Variables, which answers "Token
 * Required for subscription content" without an org login. Using it would
 * mean proxying a token through an edge function, so growth here is measured
 * Census change instead — see POP_GROWTH.
 */
import { NO_DATA_HEX, RAMP, bandIndex } from "@/lib/mapLayers";

export type AreaLevel = "county" | "tract";

export type AreaLayerId =
  | "acs_median_income"
  | "acs_pop_growth"
  | "acs_vacancy"
  | "acs_renter_share"
  | "acs_median_rent"
  | "acs_median_home_value"
  | "acs_median_age"
  | "acs_pop_density";

/** The raw ACS attributes one area carries, as the service returns them. */
export type AcsAttrs = {
  GEOID: string;
  NAME: string | null;
  State: string | null;
  County?: string | null;
  ALAND: number | null;
  B01001_001E: number | null; // total population
  B01002_001E: number | null; // median age
  B19049_001E: number | null; // median household income
  B19049_001M: number | null; //   … its margin of error
  B25002_001E: number | null; // housing units
  B25002_003E: number | null; //   … vacant
  B25003_001E: number | null; // occupied units
  B25003_003E: number | null; //   … renter-occupied
  B25058_001E: number | null; // median contract rent
  B25077_001E: number | null; // median home value
};

/** Every field any layer reads, so one tile fetch serves every layer. */
export const ACS_FIELDS: Array<keyof AcsAttrs> = [
  "GEOID", "NAME", "State", "ALAND",
  "B01001_001E", "B01002_001E", "B19049_001E", "B19049_001M",
  "B25002_001E", "B25002_003E", "B25003_001E", "B25003_003E",
  "B25058_001E", "B25077_001E",
];

/** What a layer needs beyond the area's own attributes. */
export type AreaContext = {
  /** County population in the baseline vintage, by GEOID. Growth only. */
  baseline?: Map<string, number>;
  /** Years between the baseline's end year and the current one's. */
  growthYears?: number;
};

export type AreaLayer = {
  id: AreaLayerId;
  label: string;
  help: string;
  /**
   * Which direction is good news for a multifamily buyer. "neutral" is for
   * context a reader should weigh themselves — a high median rent is neither
   * good nor bad on its own — and draws a single-hue ramp, not red-to-green.
   */
  better: "higher" | "lower" | "neutral";
  breaks: [number, number, number, number];
  format: (v: number) => string;
  /**
   * ACS top-codes some medians (250,001 means "$250,000 or more"). A value at
   * or above this is printed as a floor, not as a measurement.
   */
  topCode?: number;
  /** Growth is only measurable for counties; it draws counties at every zoom. */
  countyOnly?: boolean;
  value: (a: AcsAttrs, ctx: AreaContext) => number | null;
  /** Margin of error (90%), printed beside the value where ACS publishes one. */
  moe?: (a: AcsAttrs) => number | null;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** A share of a whole, or null when the whole is zero or missing. */
function ratio(part: unknown, whole: unknown): number | null {
  const p = num(part);
  const w = num(whole);
  // A tract with no housing units (a park, an airport, open water) has no
  // vacancy rate. 0/0 must not become 0%, which would shade it as the
  // tightest market on the map.
  if (p == null || w == null || w <= 0) return null;
  return (p / w) * 100;
}

const money0 = (v: number) => "$" + Math.round(v).toLocaleString("en-US");
const moneyK = (v: number) => "$" + Math.round(v / 1000).toLocaleString("en-US") + "k";
const pct1 = (v: number) => v.toFixed(1) + "%";
const pct0 = (v: number) => Math.round(v) + "%";
const signedPct = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "%";

export const POP_GROWTH: AreaLayer = {
  id: "acs_pop_growth",
  label: "Population growth",
  help: "Annualised change in county population between two ACS 5-year vintages. Measured, not projected, and county only: tracts were redrawn for 2020, so older tract counts do not line up with current ones.",
  better: "higher",
  breaks: [0, 0.5, 1, 1.5],
  format: (v) => signedPct(v) + "/yr",
  countyOnly: true,
  value: (a, ctx) => {
    const now = num(a.B01001_001E);
    const then = ctx.baseline?.get(a.GEOID);
    const years = ctx.growthYears;
    // A county missing from the baseline is not a county that did not grow.
    // The 13 that miss are boundary changes (Connecticut's planning regions,
    // a few Alaska boroughs), and they stay grey.
    if (now == null || then == null || then <= 0 || now <= 0 || !years || years <= 0) return null;
    return (Math.pow(now / then, 1 / years) - 1) * 100;
  },
};

/**
 * Breaks are absolute, for the same reason as the pin layers: a quantile split
 * redraws itself whenever the viewport moves, so the colour of Dallas would
 * depend on whether Austin happened to be on screen.
 */
export const AREA_LAYERS: AreaLayer[] = [
  {
    id: "acs_median_income",
    label: "Median household income",
    help: "ACS median household income. Bands are the same as the pin layer, set against the national distribution.",
    better: "higher",
    breaks: [45000, 60000, 75000, 95000],
    format: money0,
    topCode: 250001,
    value: (a) => num(a.B19049_001E),
    moe: (a) => num(a.B19049_001M),
  },
  POP_GROWTH,
  {
    id: "acs_vacancy",
    label: "Housing vacancy",
    help: "Vacant ÷ all housing units, owner and rental. Includes seasonal and vacation homes, so resort areas read high.",
    better: "lower",
    breaks: [5, 8, 12, 18],
    format: pct1,
    value: (a) => ratio(a.B25002_003E, a.B25002_001E),
  },
  {
    id: "acs_renter_share",
    label: "Renter-occupied share",
    help: "Renter-occupied ÷ occupied housing units. A measure of how deep the renter pool is.",
    better: "neutral",
    breaks: [25, 35, 45, 60],
    format: pct0,
    value: (a) => ratio(a.B25003_003E, a.B25003_001E),
  },
  {
    id: "acs_median_rent",
    label: "Median contract rent",
    help: "ACS median contract rent across all renter-occupied units, every age and type. Lags asking rents by the length of the survey window.",
    better: "neutral",
    breaks: [900, 1200, 1500, 1900],
    format: money0,
    topCode: 3501,
    value: (a) => num(a.B25058_001E),
  },
  {
    id: "acs_median_home_value",
    label: "Median home value",
    help: "Owner-estimated median value of owner-occupied homes. Where ownership is expensive, renters stay renters longer.",
    better: "neutral",
    breaks: [150000, 250000, 350000, 500000],
    format: moneyK,
    topCode: 2000001,
    value: (a) => num(a.B25077_001E),
  },
  {
    id: "acs_median_age",
    label: "Median age",
    help: "Median age of all residents.",
    better: "neutral",
    breaks: [32, 37, 41, 45],
    format: (v) => v.toFixed(1),
    value: (a) => num(a.B01002_001E),
  },
  {
    id: "acs_pop_density",
    label: "Population density",
    help: "Residents per square mile of land.",
    better: "neutral",
    breaks: [500, 2000, 5000, 10000],
    format: (v) => Math.round(v).toLocaleString("en-US") + "/mi²",
    value: (a) => {
      const pop = num(a.B01001_001E);
      const land = num(a.ALAND);
      if (pop == null || land == null || land <= 0) return null;
      return pop / (land / 2_589_988.11);
    },
  },
];

export const AREA_BY_ID = new Map(AREA_LAYERS.map((l) => [l.id, l]));

/** Light → dark, for layers that have no good direction. */
export const SEQ_RAMP = ["#DCE8F4", "#A8C8E6", "#6FA2D3", "#3B78B8", "#1D4F8C"] as const;

/** Colours ascend in raw value; flipped where higher is better, so green is good. */
function rampFor(layer: AreaLayer): readonly string[] {
  if (layer.better === "neutral") return SEQ_RAMP;
  return layer.better === "lower" ? RAMP : [...RAMP].reverse();
}

export function areaHex(value: number | null, layer: AreaLayer): string {
  if (value == null) return NO_DATA_HEX;
  return rampFor(layer)[bandIndex(value, layer.breaks)];
}

export function formatArea(value: number, layer: AreaLayer): string {
  if (layer.topCode != null && value >= layer.topCode) {
    return layer.format(layer.topCode - 1) + "+";
  }
  return layer.format(value);
}

export function areaLegend(layer: AreaLayer): Array<{ label: string; hex: string }> {
  const f = layer.format;
  const [a, b, c, d] = layer.breaks;
  const ramp = rampFor(layer);
  return [
    `< ${f(a)}`,
    `${f(a)} – ${f(b)}`,
    `${f(b)} – ${f(c)}`,
    `${f(c)} – ${f(d)}`,
    `${f(d)} +`,
  ].map((label, i) => ({ label, hex: ramp[i] }));
}

/**
 * How each buybox signal's value and scoring range read on the AI Score tab.
 * Keyed by buy_box_signals.field_source; a signal added on the Buy Box page
 * without an entry here falls back to a plain number.
 *
 * Units match what supabase/functions/_shared/pipelineScoreEngine.ts resolves:
 * asking price and equity in $M, price per unit in dollars, rates in percent
 * except CoStar's, which are fractions.
 */

type Kind =
  | "usd" | "usdK" | "usdM" | "pct" | "pctSigned" | "fraction" | "gap"
  | "year" | "units" | "days" | "years" | "miles" | "rating" | "of100" | "perSqMi" | "level" | "bool";

const KINDS: Record<string, Kind> = {
  "deals.median_income_tract": "usd",
  "deals.bachelors_pct_tract": "pct",
  "deals.median_age_tract": "years",
  "derived.population_density_sqmi": "perSqMi",
  "deals.population_growth_pct": "pctSigned",
  "costar.uc_pct": "fraction",
  "deals.vacancy_rate_tract": "pct",
  "derived.avg_price_change_pct": "pctSigned",
  "deals.avg_time_on_market": "days",
  "deals.median_rent_tract": "usd",
  "deals.owner_occupied_pct_tract": "pct",
  "deal_enrichment.schools.high.distance_mi": "miles",
  "deals.review_avg_rating": "rating",
  "deals.vintage_year": "year",
  "deals.unit_count": "units",
  "deals.building_quality_score": "of100",
  "derived.not_lease_up": "bool",
  "deals.value_add_potential": "level",
  "derived.rent_gap_pct": "gap",
  "derived.loss_to_lease_pct": "pct",
  "derived.no_rev_management": "bool",
  "deals.estimated_equity": "usdM",
  "derived.price_per_unit": "usdK",
  "derived.going_in_yield_pct": "pct",
  "derived.expense_ratio_pct": "pct",
  "derived.affordable_bonus": "bool",
  "deals.affordable": "bool",
  "derived.occupancy_pct": "pct",
  "derived.delinquency_pct": "pct",
};

const n0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const n1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
const signed = (v: number, s: string) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}`;

function fmt(kind: Kind | undefined, v: number): string {
  switch (kind) {
    case "usd": return `$${n0(v)}`;
    case "usdK": return v >= 1000 ? `$${n0(v / 1000)}K` : `$${n0(v)}`;
    case "usdM": return `$${n1(v)}M`;
    case "pct": return `${n1(v)}%`;
    case "pctSigned": return signed(v, `${n1(Math.abs(v))}%`);
    case "fraction": return `${n1(v * 100)}%`;
    case "gap":
      if (Math.abs(v) < 0.05) return "at market";
      return v > 0 ? `${n1(v)}% below market` : `${n1(-v)}% above market`;
    case "year": return String(Math.round(v));
    case "units": return `${n0(v)} units`;
    case "days": return `${n0(v)} days`;
    case "years": return `${n1(v)} yrs`;
    case "miles": return `${n1(v)} mi`;
    case "rating": return `${v.toFixed(1)} ★`;
    case "of100": return `${n0(v)} / 100`;
    case "perSqMi": return `${n0(v)} / sq mi`;
    case "level": return ["", "Low", "Medium", "High"][Math.round(v)] ?? n1(v);
    default: return n1(v);
  }
}

/** The signal's value as a person reads it: "$247K", "3.9% above market", "Yes". */
export function formatSignalValue(fieldSource: string, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  const v = Number(raw);
  if (!Number.isFinite(v)) return String(raw).slice(0, 40);
  return fmt(KINDS[fieldSource], v);
}

export type SignalRange = {
  method: "higher_better" | "lower_better" | "range_optimal" | "boolean";
  min_value: number | null;
  max_value: number | null;
  optimal_min: number | null;
  optimal_max: number | null;
};

/** One line on how the value turns into 0-100, in the signal's own units. */
export function describeRange(fieldSource: string, r: SignalRange): string | null {
  const kind = KINDS[fieldSource];
  const f = (v: number) => fmt(kind, v);
  const { min_value: lo, max_value: hi, optimal_min: omin, optimal_max: omax } = r;
  // "−10% or less" is backwards for a gap; say it in market terms.
  if (kind === "gap" && r.method === "higher_better" && lo != null && hi != null)
    return `${f(hi)} or further scores 100; ${f(lo)} or further scores 0.`;
  switch (r.method) {
    case "boolean":
      return "Scores 100 when true, 0 when false.";
    case "higher_better":
      return lo != null && hi != null ? `Higher is better: ${f(hi)} or more scores 100, ${f(lo)} or less scores 0.` : null;
    case "lower_better":
      return lo != null && hi != null ? `Lower is better: ${f(lo)} or less scores 100, ${f(hi)} or more scores 0.` : null;
    case "range_optimal":
      if (omin == null || omax == null) return null;
      return `Best between ${f(omin)} and ${f(omax)}${lo != null && hi != null ? `, falling to 0 at ${f(lo)} and ${f(hi)}` : ""}.`;
    default:
      return null;
  }
}

/** What fills a signal that has no value, when the deal page can fix it. */
export function missingHint(fieldSource: string): string | null {
  if (["derived.loss_to_lease_pct", "derived.delinquency_pct", "derived.occupancy_pct"].includes(fieldSource))
    return "Upload a rent roll on the Overview tab";
  if (fieldSource === "derived.going_in_yield_pct") return "Upload a T12 and set the asking price";
  if (fieldSource === "derived.expense_ratio_pct") return "Upload a T12 on the Overview tab";
  if (fieldSource.startsWith("costar.")) return "Pick a CoStar submarket above";
  if (fieldSource === "deals.value_add_potential") return "Set value-add potential when editing the deal";
  if (fieldSource === "derived.rent_gap_pct") return "Needs the in-place rent";
  if (fieldSource === "derived.price_per_unit") return "Needs the asking price and unit count";
  if (fieldSource === "derived.affordable_bonus") return "Only scores when the deal has an affordable component";
  return null;
}

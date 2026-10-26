/**
 * The pipeline buybox score (deal-score): derived values, signal scoring and
 * the weighted pillar roll-up.
 *
 * Extracted from deal-score/index.ts so the arithmetic can be unit tested
 * without a Deno runtime. deal-score keeps the IO (loading the deal, its
 * documents and CoStar rows, the thesis adjustment, the write) and calls
 * scorePipelineDeal for the maths.
 *
 * Scores `deals` rows. The inbox fit score is a separate engine
 * (dealScoreEngine.ts) over the same buy_box_signals config: it resolves only
 * the fields an inbox_deal has, so signals added here for documents drop out of
 * the inbox score rather than scoring there.
 *
 * Free of Deno APIs: src/test and the frontend import it directly.
 */

import { sourceOf } from "./fieldSources.ts";

function clamp(n: number, min = 0, max = 100) { return Math.max(min, Math.min(max, n)); }
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type ScoringMethod = "higher_better" | "lower_better" | "range_optimal" | "boolean";

export type SignalConfig = {
  pillar_id: string;
  name: string;
  description?: string | null;
  field_source: string;
  scoring_method: ScoringMethod;
  min_value: number | string | null;
  max_value: number | string | null;
  optimal_min: number | string | null;
  optimal_max: number | string | null;
  weight_within_pillar: number;
};

export type PillarConfig = { id: string; key: string; name: string; description?: string | null; weight: number | string };

export function scoreSignal(value: unknown, signal: Pick<SignalConfig, "scoring_method" | "min_value" | "max_value" | "optimal_min" | "optimal_max">): number | null {
  if (value === null || value === undefined || value === "") return null;
  const min_value = num(signal.min_value);
  const max_value = num(signal.max_value);
  const optimal_min = num(signal.optimal_min);
  const optimal_max = num(signal.optimal_max);

  if (signal.scoring_method === "boolean") {
    const truthy = value === true || (typeof value === "string" && value.length > 0 && value !== "false") || (typeof value === "number" && value > 0);
    return truthy ? 100 : 0;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  if (signal.scoring_method === "higher_better") {
    if (min_value == null || max_value == null || max_value === min_value) return 50;
    return Math.round(clamp(((n - min_value) / (max_value - min_value)) * 100));
  }
  if (signal.scoring_method === "lower_better") {
    if (min_value == null || max_value == null || max_value === min_value) return 50;
    return Math.round(clamp(((max_value - n) / (max_value - min_value)) * 100));
  }
  if (signal.scoring_method === "range_optimal") {
    if (optimal_min == null || optimal_max == null) return 50;
    if (n >= optimal_min && n <= optimal_max) return 100;
    if (min_value != null && n < optimal_min) {
      return Math.round(clamp(((n - min_value) / Math.max(1, optimal_min - min_value)) * 100));
    }
    if (max_value != null && n > optimal_max) {
      return Math.round(clamp(((max_value - n) / Math.max(1, max_value - optimal_max)) * 100));
    }
    return 50;
  }
  return null;
}

// ---------------------------------------------------------------- inputs

/** The parts of a parsed rent roll summary (dealDocumentDetail.RentRollSummary) the score reads. */
export type RentRollFacts = {
  occupied: number;
  notice: number;
  physical_occupancy_pct: number | null;
  avg_lease_rent: number | null;
  loss_to_lease_pct: number | null;
  delinquent_total: number;
};
/** The parts of a parsed T12 summary (dealDocumentDetail.T12Summary) the score reads. */
export type T12Facts = { total_income: number | null; total_expenses: number | null; noi: number | null };
export type DocFacts<T> = { facts: T; label: string };

export type PipelineInputs = {
  deal: Record<string, unknown>;
  enrichment?: Record<string, unknown> | null;
  /** costar_submarket_signals, scope 'Combined', for the deal's submarket. */
  costar?: Record<string, unknown> | null;
  /** costar_submarket_signals for the deal's class slice (inferSlice). */
  costarClass?: Record<string, unknown> | null;
  rentRoll?: DocFacts<RentRollFacts> | null;
  t12?: DocFacts<T12Facts> | null;
};

/** CoStar star slice for a vintage. Mirrors src/lib/rentGrowthScore.ts inferSlice. */
export function inferSlice(vintage: number | null | undefined): "1 & 2 Star" | "3 Star" | "4 & 5 Star" {
  if (vintage == null) return "3 Star";
  if (vintage >= 2015) return "4 & 5 Star";
  if (vintage < 1985) return "1 & 2 Star";
  return "3 Star";
}

type Derived = { value: unknown; source: string | null };

/**
 * Values the signals read under `derived.*`, each with where it came from.
 *
 * deals.asking_price and deals.estimated_equity are stored in $M (74 = $74M;
 * every row is between 12.8 and 280). Price per unit and yield are worked out
 * in dollars, so the signal thresholds read as dollars.
 */
export function deriveValues(inp: PipelineInputs): Record<string, Derived> {
  const d = inp.deal;
  const src = (col: string, fallback: string) => sourceOf(d.field_sources, col)?.provider ?? fallback;
  const out: Record<string, Derived> = {};

  const askingUsd = num(d.asking_price) != null ? num(d.asking_price)! * 1_000_000 : null;
  const units = num(d.unit_count);
  out.price_per_unit = {
    value: askingUsd && units ? Math.round(askingUsd / units) : null,
    source: "Asking price ÷ units",
  };

  // Rent gap: how far in-place rent sits below the market for its class. CoStar
  // class-slice effective rent when a submarket is picked, as the Rent Growth
  // score does; the Census tract median otherwise, which counts every rental in
  // the tract and so sits below most Class-B assets.
  const inPlace = num(d.in_place_avg_rent);
  const classRent = num(inp.costarClass?.eff_now);
  const tract = num(d.median_rent_tract);
  if (inPlace && inPlace > 0 && classRent && classRent > 0) {
    out.rent_gap_pct = {
      value: Math.round(((classRent - inPlace) / classRent) * 1000) / 10,
      source: `CoStar ${inferSlice(num(d.vintage_year))} effective rent, submarket ($${Math.round(classRent).toLocaleString("en-US")})`,
    };
  } else if (inPlace && inPlace > 0 && tract && tract > 0) {
    out.rent_gap_pct = {
      value: Math.round(((tract - inPlace) / tract) * 1000) / 10,
      source: `Census tract median rent ($${Math.round(tract).toLocaleString("en-US")}); pick a CoStar submarket for a class benchmark`,
    };
  } else {
    out.rent_gap_pct = { value: null, source: null };
  }

  // Going-in yield: T12 NOI over asking price. The applied deal figure wins
  // over the parsed T12, because a person reviewed it.
  const dealNoi = num(d.t12_noi);
  const t12Noi = inp.t12?.facts.noi ?? null;
  const noi = dealNoi ?? t12Noi;
  out.going_in_yield_pct = {
    value: noi != null && askingUsd ? Math.round((noi / askingUsd) * 1000) / 10 : null,
    source: dealNoi != null ? `T12 NOI (${src("t12_noi", "deal")}) ÷ asking price` : t12Noi != null ? `${inp.t12!.label} NOI ÷ asking price` : null,
  };

  const dealEr = num(d.expense_ratio);
  const t = inp.t12?.facts;
  const t12Er = t && isNum(t.total_expenses) && isNum(t.total_income) && t.total_income > 0
    ? Math.round((t.total_expenses / t.total_income) * 1000) / 10
    : null;
  out.expense_ratio_pct = {
    value: dealEr ?? t12Er,
    source: dealEr != null ? src("expense_ratio", "Deal") : t12Er != null ? inp.t12!.label : null,
  };

  // deals.occupancy_pct is 0-100, but three older rows hold a fraction (0.91).
  // No deal is 1% occupied, so a value at or under 1 is read as a fraction.
  const rawOcc = num(d.occupancy_pct);
  const dealOcc = rawOcc != null && rawOcc > 0 && rawOcc <= 1 ? Math.round(rawOcc * 1000) / 10 : rawOcc;
  const rrOcc = inp.rentRoll?.facts.physical_occupancy_pct ?? null;
  out.occupancy_pct = {
    value: dealOcc ?? rrOcc,
    source: dealOcc != null ? src("occupancy_pct", "Deal") : rrOcc != null ? inp.rentRoll!.label : null,
  };

  const rr = inp.rentRoll?.facts;
  out.loss_to_lease_pct = { value: rr?.loss_to_lease_pct ?? null, source: rr ? inp.rentRoll!.label : null };

  // Delinquency as a share of one month's occupied rent roll.
  const occupied = rr ? rr.occupied + rr.notice : 0;
  const monthly = rr && isNum(rr.avg_lease_rent) ? occupied * rr.avg_lease_rent : 0;
  out.delinquency_pct = {
    value: rr && monthly > 0 ? Math.round((rr.delinquent_total / monthly) * 1000) / 10 : null,
    source: rr ? inp.rentRoll!.label : null,
  };

  // HelloData's tract density is people per square metre (pipeline median
  // 0.0014 ≈ 3,600 per sq mi) and its listing price change is a fraction
  // (-0.0067 = -0.67%). Both are put in the units the signals read.
  const density = num(d.population_density_tract);
  out.population_density_sqmi = {
    value: density != null ? Math.round(density * 2_589_988) : null,
    source: src("population_density_tract", "HelloData"),
  };
  const priceChange = num(d.avg_price_change);
  out.avg_price_change_pct = {
    value: priceChange != null ? Math.round(priceChange * 1000) / 10 : null,
    source: src("avg_price_change", "HelloData"),
  };

  // The "Not in lease-up" and "No revenue management" signals are booleans
  // where the GOOD answer is false; these flip the flag. Unknown stays null so
  // the signal drops out.
  const negate = (v: unknown): boolean | null => (typeof v === "boolean" ? !v : null);
  out.not_lease_up = { value: negate(d.is_lease_up), source: src("is_lease_up", "Deal") };
  out.no_rev_management = { value: negate(d.uses_rev_management), source: src("uses_rev_management", "Deal") };

  // The thesis calls any affordability component a green flag. A market-rate
  // deal is not a red one, so absence drops out instead of scoring 0.
  out.affordable_bonus = {
    value: d.affordable === true || d.is_affordable_housing === true ? true : null,
    source: "Deal",
  };

  return out;
}

// ---------------------------------------------------------------- roll-up

export type SignalResult = {
  name: string;
  description: string | null;
  field_source: string;
  raw_value: unknown;
  score: number | null;
  weight: number;
  method: ScoringMethod;
  min_value: number | null;
  max_value: number | null;
  optimal_min: number | null;
  optimal_max: number | null;
  source: string | null;
};

export type PillarResult = {
  key: string;
  name: string;
  description: string | null;
  weight: number;
  score: number | null;
  /** Points this pillar adds to the base score (score × weight ÷ covered weight). */
  points: number | null;
  signals: SignalResult[];
};

export type Coverage = {
  pillars_covered: number;
  pillars_total: number;
  signals_covered: number;
  signals_total: number;
  weight_covered_pct: number;
};

export type Confidence = "high" | "medium" | "low" | "insufficient";

export type PipelineScore = {
  version: 2;
  base_score: number;
  pillars: PillarResult[];
  confidence: Confidence;
  coverage: Coverage;
};

const VAP: Record<string, number> = { low: 1, medium: 2, high: 3 };

const DEFAULT_SOURCE: Record<string, string> = {
  deals: "Deal",
  deal_enrichment: "Esri",
  costar: "CoStar",
};

function resolve(path: string, inp: PipelineInputs, derived: Record<string, Derived>): { value: unknown; source: string | null } {
  const [root, ...rest] = path.split(".");
  if (root === "derived") return derived[rest[0]] ?? { value: undefined, source: null };

  let obj: unknown;
  if (root === "deals") {
    obj = { ...inp.deal, value_add_potential: inp.deal.value_add_potential ? VAP[String(inp.deal.value_add_potential).toLowerCase()] ?? null : null };
  } else if (root === "deal_enrichment") obj = inp.enrichment ?? {};
  else if (root === "costar") obj = inp.costar;
  else return { value: undefined, source: null };

  for (const p of rest) {
    if (obj == null) break;
    obj = (obj as Record<string, unknown>)[p];
  }
  const source = root === "deals"
    ? sourceOf(inp.deal.field_sources, rest[0])?.provider ?? DEFAULT_SOURCE.deals
    : DEFAULT_SOURCE[root];
  return { value: obj, source: obj == null ? null : source };
}

/**
 * Weighted roll-up. A signal with no value drops out of its pillar's average,
 * and a pillar with no scored signal drops out of the total, so missing data
 * never scores as a midpoint. Base is 50 when nothing scores at all.
 */
export function scorePipelineDeal(inp: PipelineInputs, pillars: PillarConfig[], signals: SignalConfig[]): PipelineScore {
  const derived = deriveValues(inp);
  const rows: Omit<PillarResult, "points">[] = [];
  let signalsCovered = 0;
  let signalsTotal = 0;

  for (const pillar of pillars) {
    const sigResults: SignalResult[] = [];
    let pSum = 0;
    let pWeight = 0;
    for (const sig of signals.filter((s) => s.pillar_id === pillar.id)) {
      const { value, source } = resolve(sig.field_source, inp, derived);
      const score = scoreSignal(value, sig);
      signalsTotal += 1;
      sigResults.push({
        name: sig.name,
        description: sig.description ?? null,
        field_source: sig.field_source,
        raw_value: value ?? null,
        score,
        weight: sig.weight_within_pillar,
        method: sig.scoring_method,
        min_value: num(sig.min_value),
        max_value: num(sig.max_value),
        optimal_min: num(sig.optimal_min),
        optimal_max: num(sig.optimal_max),
        source: score == null ? null : source,
      });
      if (score != null) {
        signalsCovered += 1;
        pSum += score * sig.weight_within_pillar;
        pWeight += sig.weight_within_pillar;
      }
    }
    rows.push({
      key: pillar.key,
      name: pillar.name,
      description: pillar.description ?? null,
      weight: Number(pillar.weight) || 0,
      score: pWeight > 0 ? Math.round(pSum / pWeight) : null,
      signals: sigResults,
    });
  }

  const covered = rows.filter((p) => p.score != null);
  const weightAll = rows.reduce((a, p) => a + p.weight, 0);
  const weightCovered = covered.reduce((a, p) => a + p.weight, 0);
  const base = weightCovered > 0
    ? Math.round(covered.reduce((a, p) => a + p.score! * p.weight, 0) / weightCovered)
    : 50;
  const weightCoveredPct = weightAll > 0 ? weightCovered / weightAll : 0;

  let confidence: Confidence;
  if (covered.length === 0) confidence = "insufficient";
  else if (weightCoveredPct >= 0.7 && covered.length >= Math.ceil(rows.length / 2)) confidence = "high";
  else if (weightCoveredPct >= 0.4) confidence = "medium";
  else confidence = "low";

  return {
    version: 2,
    base_score: base,
    pillars: rows.map((p) => ({
      ...p,
      points: p.score != null && weightCovered > 0 ? Math.round((p.score * p.weight) / weightCovered * 10) / 10 : null,
    })),
    confidence,
    coverage: {
      pillars_covered: covered.length,
      pillars_total: rows.length,
      signals_covered: signalsCovered,
      signals_total: signalsTotal,
      weight_covered_pct: Math.round(weightCoveredPct * 100) / 100,
    },
  };
}

/** The label a parsed document's facts are cited by: "Rent roll · Sugar Run RR.xlsx · As of 9/30/2026". */
export function docLabel(kind: "Rent roll" | "T12", fileName: string, asOf: string | null | undefined): string {
  return [kind, fileName, asOf?.trim() || null].filter(Boolean).join(" · ");
}

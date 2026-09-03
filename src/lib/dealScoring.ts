/**
 * Pure deal scoring engine for Ansonia value-add multifamily buybox.
 *
 * Reads cached HelloData payload + manual fields. Makes NO network calls.
 * Safe to re-run any time inputs change.
 */

export type RegulatoryRisk = "green" | "yellow" | "red";

export interface ScoreableDeal {
  // Asset basics
  unit_count?: number | null;
  vintage_year?: number | null;
  year_built?: number | null;
  in_place_avg_rent?: number | null;
  classic_units_remaining?: number | null;
  total_renovated_units?: number | null;

  // Deal economics
  asking_price?: number | null;
  t12_noi?: number | null;
  t12_opex?: number | null;

  // Free / manual market data
  area_median_income_1mi?: number | null;
  population_growth_pct?: number | null;
  job_growth_pct?: number | null;
  new_supply_pct_of_stock?: number | null;
  school_rating?: number | null;
  nearest_employment_node_min?: number | null;
  market_cap_rate?: number | null;
  regulatory_risk?: RegulatoryRisk | string | null;

  // HelloData cache
  hellodata_payload?: HelloDataPayload | null;
}

export interface HelloDataPayload {
  market_rent?: number | null;
  market_rent_per_unit?: number | null;
  avg_market_rent?: number | null;
  market_occupancy_pct?: number | null;
  property_occupancy_pct?: number | null;
  occupancy_pct?: number | null;
  concessions_pct?: number | null;
  renovation_rent_premium?: number | null;
  renovation_premium_per_unit?: number | null;
  quality_score?: number | null;
  expense_per_unit?: number | null;
  expense_ratio?: number | null;
  egr?: number | null;
  unit_mix?: Array<{ beds?: number | null; count?: number | null }> | null;
  [key: string]: unknown;
}

export interface ScoreBenchmarks {
  population_growth_floor_pct: number; // national avg
  job_growth_floor_pct: number; // national avg
  min_units: number;
  vintage_min: number;
  vintage_max: number;
  income_floor: number;
  supply_ceiling_pct: number;
}

export const DEFAULT_BENCHMARKS: ScoreBenchmarks = {
  population_growth_floor_pct: 0.5,
  job_growth_floor_pct: 1.2,
  min_units: 150,
  vintage_min: 1990,
  vintage_max: 2019,
  income_floor: 55000,
  supply_ceiling_pct: 5,
};

export interface FactorScores {
  rent_lag: number | null;
  value_add_opportunity: number | null;
  occupancy_concessions: number | null;
  property_fundamentals: number | null;
  opex_benchmark: number | null;
  submarket_quality: number | null;
  regulatory_tax: number | null;
  capital_markets_exit: number | null;
}

export const FACTOR_WEIGHTS: Record<keyof FactorScores, number> = {
  rent_lag: 0.22,
  value_add_opportunity: 0.18,
  occupancy_concessions: 0.1,
  property_fundamentals: 0.1,
  opex_benchmark: 0.1,
  submarket_quality: 0.15,
  regulatory_tax: 0.07,
  capital_markets_exit: 0.08,
};

/**
 * Egregious-miss cutoffs. Only deals outside these are Disqualified;
 * near-misses of DEFAULT_BENCHMARKS just score lower via the factor curves.
 */
export const HARD_LIMITS = {
  min_units: 100,
  vintage_min: 1980,
  vintage_max: 2023,
  income_floor: 40000,
  supply_ceiling_pct: 8,
} as const;

export interface ScoreResult {
  passes_hard_filters: boolean;
  hard_filter_failures: Array<{ rule: string; detail: string }>;
  factor_scores: FactorScores;
  total_score: number | null;
  deal_tier:
    | "Tier 1 – Strong Fit"
    | "Tier 2 – Fit"
    | "Tier 3 – Marginal"
    | "Tier 4 – Weak"
    | "Disqualified";
  value_add_upside: number | null;
  scored_at: string;
}

// ---------- helpers ----------

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) =>
  y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);

function vintageOf(deal: ScoreableDeal): number | null {
  return isNum(deal.year_built) ? deal.year_built : isNum(deal.vintage_year) ? deal.vintage_year : null;
}

function marketRentFrom(payload: HelloDataPayload | null | undefined): number | null {
  if (!payload) return null;
  const candidates = [payload.market_rent_per_unit, payload.avg_market_rent, payload.market_rent];
  for (const c of candidates) if (isNum(c) && c > 0) return c;
  return null;
}

function marketOccupancyFrom(payload: HelloDataPayload | null | undefined): number | null {
  if (!payload) return null;
  return isNum(payload.market_occupancy_pct) ? payload.market_occupancy_pct : null;
}

function propertyOccupancyFrom(payload: HelloDataPayload | null | undefined): number | null {
  if (!payload) return null;
  if (isNum(payload.property_occupancy_pct)) return payload.property_occupancy_pct;
  if (isNum(payload.occupancy_pct)) return payload.occupancy_pct;
  return null;
}

// ---------- income diminishing-returns sub-score ----------

export function incomeSubScore(ami: number | null | undefined, floor = 55000): number {
  if (!isNum(ami)) return 0;
  if (ami < 35000) return 12;
  if (ami < floor) return clamp(lerp(ami, 35000, floor, 35, 62));
  return clamp(100 - 40 * Math.exp(-(ami - floor) / 40000));
}

// ---------- factor scorers ----------

function scoreRentLag(deal: ScoreableDeal): number | null {
  const market = marketRentFrom(deal.hellodata_payload);
  const inPlace = deal.in_place_avg_rent;
  if (!isNum(market) || !isNum(inPlace) || market <= 0) return null;
  const lagPct = ((market - inPlace) / market) * 100;
  if (lagPct < 5) return clamp(lerp(Math.max(lagPct, -5), -5, 5, 20, 45));
  if (lagPct < 10) return clamp(lerp(lagPct, 5, 10, 45, 68));
  if (lagPct <= 20) return clamp(lerp(lagPct, 10, 20, 68, 90));
  return clamp(lerp(Math.min(lagPct, 30), 20, 30, 90, 100));
}

function scoreValueAdd(deal: ScoreableDeal): number | null {
  if (!isNum(deal.classic_units_remaining) || !isNum(deal.unit_count) || deal.unit_count <= 0) {
    return null;
  }
  const pct = deal.classic_units_remaining / deal.unit_count;
  if (pct < 0.25) return clamp(lerp(pct, 0, 0.25, 35, 55));
  if (pct < 0.6) return clamp(lerp(pct, 0.25, 0.6, 55, 80));
  return clamp(lerp(Math.min(pct, 1), 0.6, 1, 80, 100));
}

function scoreOccupancyConcessions(deal: ScoreableDeal): number | null {
  const propOcc = propertyOccupancyFrom(deal.hellodata_payload);
  const mktOcc = marketOccupancyFrom(deal.hellodata_payload);
  if (!isNum(propOcc) || !isNum(mktOcc)) return null;
  // Healthy market = mkt occ > 92. Reward property below market (operational upside).
  if (mktOcc < 92) {
    // soft submarket — penalize
    return clamp(lerp(mktOcc, 85, 92, 20, 55));
  }
  const gap = mktOcc - propOcc; // positive = property underperforms market = upside
  if (gap <= 0) return 55;
  return clamp(60 + gap * 6); // every pt of upside ≈ +6
}

function scorePropertyFundamentals(deal: ScoreableDeal): number | null {
  const v = vintageOf(deal);
  if (!isNum(v)) return null;
  let base: number;
  if (v >= 1995 && v <= 2012) base = 95;
  else if ((v >= 1990 && v < 1995) || (v > 2012 && v <= 2019)) base = 82;
  else if ((v >= 1980 && v < 1990) || (v > 2019 && v <= 2023)) base = 62;
  else base = 40;

  // Unit-scale adjustment
  if (isNum(deal.unit_count)) {
    if (deal.unit_count >= 150) base += 3;
    else if (deal.unit_count >= 100) base += lerp(deal.unit_count, 100, 150, -8, 0);
    else base -= 12;
  }

  const qs = deal.hellodata_payload?.quality_score;
  if (isNum(qs)) {
    // QualityScore typically 1–10; treat as a mild ±5 modifier (higher = better)
    const qsBoost = clamp(lerp(qs, 1, 10, -5, 5), -5, 5);
    base += qsBoost;
  }
  return clamp(base);
}

function scoreOpex(deal: ScoreableDeal): number | null {
  const payloadRatio = deal.hellodata_payload?.expense_ratio;
  let ratio: number | null = null;
  if (isNum(payloadRatio)) ratio = payloadRatio > 1 ? payloadRatio : payloadRatio * 100;
  else if (isNum(deal.t12_opex) && isNum(deal.hellodata_payload?.egr) && (deal.hellodata_payload!.egr as number) > 0) {
    ratio = (deal.t12_opex / (deal.hellodata_payload!.egr as number)) * 100;
  }
  if (ratio == null) return null;
  if (ratio < 45) return clamp(lerp(Math.max(ratio, 30), 30, 45, 100, 90));
  if (ratio < 55) return clamp(lerp(ratio, 45, 55, 90, 60));
  return clamp(lerp(Math.min(ratio, 70), 55, 70, 60, 30));
}

function scoreSubmarketQuality(deal: ScoreableDeal, b: ScoreBenchmarks = DEFAULT_BENCHMARKS): number | null {
  const parts: number[] = [];
  if (isNum(deal.school_rating)) parts.push(clamp(deal.school_rating * 10));
  if (isNum(deal.nearest_employment_node_min)) {
    parts.push(clamp(lerp(Math.min(deal.nearest_employment_node_min, 45), 0, 45, 100, 30)));
  }
  const income = incomeSubScore(deal.area_median_income_1mi, b.income_floor);
  if (income > 0) parts.push(income);

  // Population growth vs floor
  if (isNum(deal.population_growth_pct)) {
    const p = deal.population_growth_pct;
    if (p <= 0) parts.push(clamp(lerp(Math.max(p, -2), -2, 0, 20, 45)));
    else if (p <= b.population_growth_floor_pct) parts.push(clamp(lerp(p, 0, b.population_growth_floor_pct, 45, 65)));
    else parts.push(clamp(lerp(Math.min(p, b.population_growth_floor_pct + 2), b.population_growth_floor_pct, b.population_growth_floor_pct + 2, 70, 100)));
  }
  // Job growth vs floor
  if (isNum(deal.job_growth_pct)) {
    const j = deal.job_growth_pct;
    if (j <= 0) parts.push(clamp(lerp(Math.max(j, -2), -2, 0, 20, 45)));
    else if (j <= b.job_growth_floor_pct) parts.push(clamp(lerp(j, 0, b.job_growth_floor_pct, 45, 65)));
    else parts.push(clamp(lerp(Math.min(j, b.job_growth_floor_pct + 2), b.job_growth_floor_pct, b.job_growth_floor_pct + 2, 70, 100)));
  }
  // New supply pressure
  if (isNum(deal.new_supply_pct_of_stock)) {
    const s = deal.new_supply_pct_of_stock;
    if (s <= b.supply_ceiling_pct) parts.push(clamp(lerp(s, 0, b.supply_ceiling_pct, 95, 55)));
    else parts.push(clamp(lerp(Math.min(s, 8), b.supply_ceiling_pct, 8, 55, 25)));
  }

  if (!parts.length) return null;
  return clamp(parts.reduce((a, b) => a + b, 0) / parts.length);
}

function scoreRegulatory(deal: ScoreableDeal): number | null {
  switch ((deal.regulatory_risk || "").toLowerCase()) {
    case "green":
      return 100;
    case "yellow":
      return 60;
    case "red":
      return 30;
    default:
      return null;
  }
}

function scoreCapitalMarkets(deal: ScoreableDeal): number | null {
  if (!isNum(deal.market_cap_rate)) return null;
  // 4.5% → 40, 5.5% → 65, 6.5%+ → 90+
  return clamp(lerp(Math.min(Math.max(deal.market_cap_rate, 3), 8), 3, 8, 20, 100));
}

// ---------- hard filters ----------

function evaluateHardFilters(deal: ScoreableDeal, _b: ScoreBenchmarks) {
  const failures: Array<{ rule: string; detail: string }> = [];

  if (isNum(deal.new_supply_pct_of_stock) && deal.new_supply_pct_of_stock >= HARD_LIMITS.supply_ceiling_pct) {
    failures.push({
      rule: "new_supply",
      detail: `New supply ${deal.new_supply_pct_of_stock.toFixed(1)}% ≥ ${HARD_LIMITS.supply_ceiling_pct}%`,
    });
  }
  // Only disqualify on outright decline in BOTH population and jobs
  if (
    isNum(deal.population_growth_pct) &&
    isNum(deal.job_growth_pct) &&
    deal.population_growth_pct <= 0 &&
    deal.job_growth_pct <= 0
  ) {
    failures.push({
      rule: "growth",
      detail: `Pop ${deal.population_growth_pct}% & Job ${deal.job_growth_pct}% both declining`,
    });
  }
  if (isNum(deal.area_median_income_1mi) && deal.area_median_income_1mi < HARD_LIMITS.income_floor) {
    failures.push({
      rule: "income_floor",
      detail: `AMI $${deal.area_median_income_1mi.toLocaleString()} below floor $${HARD_LIMITS.income_floor.toLocaleString()}`,
    });
  }
  if (isNum(deal.unit_count) && deal.unit_count < HARD_LIMITS.min_units) {
    failures.push({ rule: "unit_count", detail: `${deal.unit_count} units < ${HARD_LIMITS.min_units}` });
  }
  const v = vintageOf(deal);
  if (isNum(v) && (v < HARD_LIMITS.vintage_min || v > HARD_LIMITS.vintage_max)) {
    failures.push({ rule: "vintage", detail: `Vintage ${v} outside ${HARD_LIMITS.vintage_min}–${HARD_LIMITS.vintage_max}` });
  }

  return { passes: failures.length === 0, failures };
}

// ---------- aggregation ----------

function weightedTotal(scores: FactorScores): number | null {
  let weighted = 0;
  let usedWeight = 0;
  (Object.keys(FACTOR_WEIGHTS) as Array<keyof FactorScores>).forEach((k) => {
    const v = scores[k];
    if (isNum(v)) {
      weighted += v * FACTOR_WEIGHTS[k];
      usedWeight += FACTOR_WEIGHTS[k];
    }
  });
  if (usedWeight === 0) return null;
  return clamp(weighted / usedWeight);
}

function tierFor(total: number | null): ScoreResult["deal_tier"] {
  if (total == null) return "Tier 4 – Weak";
  if (total >= 80) return "Tier 1 – Strong Fit";
  if (total >= 65) return "Tier 2 – Fit";
  if (total >= 50) return "Tier 3 – Marginal";
  return "Tier 4 – Weak";
}

function computeUpside(deal: ScoreableDeal): number | null {
  const premium =
    deal.hellodata_payload?.renovation_premium_per_unit ?? deal.hellodata_payload?.renovation_rent_premium ?? null;
  if (!isNum(premium) || !isNum(deal.classic_units_remaining) || !isNum(deal.market_cap_rate) || deal.market_cap_rate <= 0) {
    return null;
  }
  const noiLift = premium * deal.classic_units_remaining * 12;
  return noiLift / (deal.market_cap_rate / 100);
}

// ---------- public entrypoint ----------

export function scoreDeal(deal: ScoreableDeal, benchmarks: ScoreBenchmarks = DEFAULT_BENCHMARKS): ScoreResult {
  const scored_at = new Date().toISOString();
  const { passes, failures } = evaluateHardFilters(deal, benchmarks);

  const emptyFactors: FactorScores = {
    rent_lag: null,
    value_add_opportunity: null,
    occupancy_concessions: null,
    property_fundamentals: null,
    opex_benchmark: null,
    submarket_quality: null,
    regulatory_tax: null,
    capital_markets_exit: null,
  };

  if (!passes) {
    return {
      passes_hard_filters: false,
      hard_filter_failures: failures,
      factor_scores: emptyFactors,
      total_score: null,
      deal_tier: "Disqualified",
      value_add_upside: null,
      scored_at,
    };
  }

  const factor_scores: FactorScores = {
    rent_lag: scoreRentLag(deal),
    value_add_opportunity: scoreValueAdd(deal),
    occupancy_concessions: scoreOccupancyConcessions(deal),
    property_fundamentals: scorePropertyFundamentals(deal),
    opex_benchmark: scoreOpex(deal),
    submarket_quality: scoreSubmarketQuality(deal),
    regulatory_tax: scoreRegulatory(deal),
    capital_markets_exit: scoreCapitalMarkets(deal),
  };

  const total_score = weightedTotal(factor_scores);

  return {
    passes_hard_filters: true,
    hard_filter_failures: [],
    factor_scores,
    total_score,
    deal_tier: tierFor(total_score),
    value_add_upside: computeUpside(deal),
    scored_at,
  };
}

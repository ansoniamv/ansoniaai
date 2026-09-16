/**
 * The inbox fit-score engine: signal scoring, field resolution, and the weighted
 * roll-up.
 *
 * Extracted from score-deals/index.ts so the arithmetic can be unit tested
 * without a Deno runtime. score-deals keeps the IO — loading config, writing
 * fit_score/fit_tier, generating the rationale — and calls computeDealScore for
 * the maths.
 *
 * Scores `inbox_deals` rows (top-of-funnel FIT), which is a different system
 * from the client-side scorer in src/lib/dealScoring.ts (total_score /
 * deal_tier) used by the Pipeline Dashboard.
 */

function clamp(n: number, min = 0, max = 100) { return Math.max(min, Math.min(max, n)); }

function scoreSignal(value: unknown, sig: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const { scoring_method, min_value, max_value, optimal_min, optimal_max } = sig;

  if (scoring_method === "boolean") {
    const truthy = value === true || (typeof value === "string" && value.length > 0 && value !== "false") || (typeof value === "number" && value > 0);
    return truthy ? 100 : 0;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return null;

  if (scoring_method === "higher_better") {
    if (min_value == null || max_value == null || max_value === min_value) return 50;
    return Math.round(clamp(((num - min_value) / (max_value - min_value)) * 100));
  }
  if (scoring_method === "lower_better") {
    if (min_value == null || max_value == null || max_value === min_value) return 50;
    return Math.round(clamp(((max_value - num) / (max_value - min_value)) * 100));
  }
  if (scoring_method === "range_optimal") {
    if (optimal_min == null || optimal_max == null) return 50;
    if (num >= optimal_min && num <= optimal_max) return 100;
    if (min_value != null && num < optimal_min) {
      const span = Math.max(1, optimal_min - min_value);
      return Math.round(clamp(((num - min_value) / span) * 100));
    }
    if (max_value != null && num > optimal_max) {
      const span = Math.max(1, max_value - optimal_max);
      return Math.round(clamp(((max_value - num) / span) * 100));
    }
    return 50;
  }
  return null;
}

// Parse loose asking-price text like "$12.5M", "12,500,000"
function parsePriceText(t: string | null | undefined): number | null {
  if (!t) return null;
  const s = String(t).toLowerCase().replace(/[$,\s]/g, "");
  const m = s.match(/^(-?\d+(?:\.\d+)?)([mk]?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === "m") return n * 1_000_000;
  if (m[2] === "k") return n * 1_000;
  return n;
}

// Map signal field_source paths against an inbox_deal + derived values.
function resolve(path: string, ctx: any): unknown {
  const parts = path.split(".");
  const root = parts[0];
  let obj: any;
  if (root === "deals") {
    // Map legacy deals.* fields onto the inbox_deal schema where possible.
    const d = ctx.deal;
    const aliasMap: Record<string, any> = {
      unit_count: d.units,
      vintage_year: d.year_built,
      city: d.location_city,
      state: d.location_state,
      msa: d.msa,
      property_name: d.property_name,
      asking_price: ctx.derived.asking_price_num,
      // Both of these are DERIVED FROM strategy. When strategy is null there is
      // no evidence either way, so they must resolve to undefined and be
      // excluded from the weighted average — not to a midpoint.
      //
      // value_add_potential previously fell through to a hardcoded 2 on a null
      // strategy. On a higher_better 1..3 signal that is exactly 50, which
      // pinned the whole value_add pillar at 50 and made 100 unreachable: a deal
      // with a perfect asset_quality (100, weight 15) still landed at
      // (100*15 + 50*20) / 35 = 71. That is the uniform 71 ceiling.
      affordable: d.strategy == null ? undefined : /afford/i.test(d.strategy),
      value_add_potential:
        d.strategy == null
          ? undefined
          : /value[\s-]?add/i.test(d.strategy)
          ? 3
          : /core/i.test(d.strategy)
          ? 1
          : 2,
    };
    const key = parts[1];
    if (key in aliasMap) return aliasMap[key];
    // Unknown deals.* field — not present on inbox_deal
    return undefined;
  }
  if (root === "derived") obj = ctx.derived;
  else if (root === "deal_enrichment" || root === "permits") return undefined; // not available for inbox deals
  else return undefined;

  for (let i = 1; i < parts.length; i++) {
    if (obj == null) return undefined;
    obj = obj[parts[i]];
  }
  return obj;
}

function tierFromScore(score: number): "strong" | "medium" | "maybe" | "skip" {
  if (score >= 75) return "strong";
  if (score >= 55) return "medium";
  if (score >= 35) return "maybe";
  return "skip";
}

// Exclude pillars that represent deal-economics / pricing / returns / underwriting.
// Inbox scoring is a top-of-funnel FIT signal — economics are assessed later in the
// Pipeline scorer (deal-score). Match generously on pillar key + name.
const ECONOMICS_RE = /econ|pric|return|yield|cap[\s_-]?rate|irr|underwrit/i;
function isEconomicsPillar(p: any): boolean {
  return ECONOMICS_RE.test(String(p?.key ?? "")) || ECONOMICS_RE.test(String(p?.name ?? ""));
}

export type PillarBreakdown = {
  key: string;
  name: string;
  weight: number;
  score: number | null;
  contribution: number | null;
  signals: Array<{
    name: string;
    field_source: string;
    raw_value: unknown;
    score: number | null;
    weight: number;
  }>;
};

export type DealScore = {
  breakdown: PillarBreakdown[];
  finalScore: number | null;
  tier: "strong" | "medium" | "maybe" | "skip" | null;
  scoredPillarCount: number;
  totalWeight: number;
};

/** Too few real subscores to call it: leave unscored rather than bury it as "skip". */
export const MIN_SCORED_PILLARS = 2;

/**
 * Weighted roll-up with renormalisation at BOTH levels: a signal that resolves
 * to null is excluded from its pillar's denominator, and a pillar with no
 * scorable signal is excluded from the total's denominator. Nothing null is ever
 * scored as a neutral midpoint — that would silently cap the achievable total.
 */
export function computeDealScore(deal: any, pillars: any[], signals: any[]): DealScore {
  const asking_price_num = parsePriceText(deal.asking_price);
  const price_per_unit = asking_price_num && deal.units ? asking_price_num / deal.units : null;
  const ctx = { deal, derived: { asking_price_num, price_per_unit, rent_gap_pct: null } };

  const breakdown: PillarBreakdown[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  const fitPillars = (pillars ?? []).filter((p) => !isEconomicsPillar(p));

  for (const pillar of fitPillars) {
    const pSignals = signals.filter((s) => s.pillar_id === pillar.id && s.is_active);
    const sigResults: PillarBreakdown["signals"] = [];
    let pSum = 0;
    let pWeight = 0;
    for (const sig of pSignals) {
      const raw = resolve(sig.field_source, ctx);
      const score = scoreSignal(raw, sig);
      sigResults.push({
        name: sig.name,
        field_source: sig.field_source,
        raw_value: raw ?? null,
        score,
        weight: sig.weight_within_pillar,
      });
      if (score != null) {
        pSum += score * sig.weight_within_pillar;
        pWeight += sig.weight_within_pillar;
      }
    }
    const pillarSubscore = pWeight > 0 ? Math.round(pSum / pWeight) : null;
    const contribution = pillarSubscore != null ? (pillarSubscore * pillar.weight) / 100 : null;
    breakdown.push({
      key: pillar.key,
      name: pillar.name,
      weight: pillar.weight,
      score: pillarSubscore,
      contribution,
      signals: sigResults,
    });
    if (pillarSubscore != null) {
      weightedSum += pillarSubscore * pillar.weight;
      totalWeight += pillar.weight;
    }
  }

  const scoredPillarCount = breakdown.filter((p) => p.score != null).length;
  const hasEnoughSignal = totalWeight > 0 && scoredPillarCount >= MIN_SCORED_PILLARS;
  const finalScore = hasEnoughSignal ? Math.round(weightedSum / totalWeight) : null;
  const tier = hasEnoughSignal ? tierFromScore(finalScore as number) : null;

  return { breakdown, finalScore, tier, scoredPillarCount, totalWeight };
}

export { scoreSignal, resolve, tierFromScore, isEconomicsPillar, parsePriceText };

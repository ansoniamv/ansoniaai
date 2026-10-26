import { DEAL_SCORING_COLUMNS } from "@/lib/dealColumns";

/**
 * Bridges the pure buybox scoring engine (src/lib/dealScoring.ts) to the
 * `deals` table. Nothing else calls scoreDeal(), so without this file every
 * deal ends up as "Tier 4 – Weak" in the Pipeline dashboard.
 *
 * NOTE: This is completely separate from the deal-score edge function /
 * ai_score column. Do not conflate the two.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  costarSliceFor,
  scoreDeal,
  type ScoreableDeal,
  type HelloDataPayload,
  type RegulatoryRisk,
  type SubmarketMarket,
} from "./dealScoring";
import type { Tables } from "@/integrations/supabase/types";

type DealRow = Tables<"deals">;

export interface PersistedScoreFields {
  passes_hard_filters: boolean;
  hard_filter_failures: Array<{ rule: string; detail: string }>;
  factor_scores: Record<string, number | null>;
  total_score: number | null;
  deal_tier: string;
  value_add_upside: number | null;
  scored_at: string;
}

/** Submarket code -> slice -> that slice's latest figures. */
export type SubmarketFigures = Map<string, Map<string, SubmarketMarket>>;

/**
 * The latest actual quarter (year-to-date or history, never a forecast) of
 * each slice of each submarket, from the current CoStar import — the same
 * import the Market panel reads.
 */
export async function loadSubmarketFigures(codes: string[]): Promise<SubmarketFigures> {
  const out: SubmarketFigures = new Map();
  if (!codes.length) return out;
  const { data: imp, error: impErr } = await supabase
    .from("market_data_imports")
    .select("id")
    .eq("status", "complete")
    .contains("geography_types", ["Submarket"])
    .order("as_of_date", { ascending: false })
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (impErr) throw impErr;
  if (!imp) return out;

  const best = new Map<string, { rank: number; row: SubmarketMarket }>();
  for (let i = 0; i < codes.length; i += 100) {
    const { data, error } = await supabase
      .from("costar_series")
      .select("geography_code, slice, period_year, period_quarter, occupancy_rate, asking_rent_unit, market_cap_rate")
      .eq("import_id", imp.id)
      .in("geography_code", codes.slice(i, i + 100))
      .in("period_kind", ["ytd", "history"]);
    if (error) throw error;
    for (const r of data ?? []) {
      const key = `${r.geography_code}|${r.slice}`;
      const rank = r.period_year * 10 + r.period_quarter;
      if ((best.get(key)?.rank ?? -1) >= rank) continue;
      best.set(key, {
        rank,
        row: {
          slice: r.slice,
          // CoStar stores rates as fractions; deals store percentages.
          occupancy_pct: r.occupancy_rate == null ? null : r.occupancy_rate * 100,
          asking_rent: r.asking_rent_unit ?? null,
          cap_rate_pct: r.market_cap_rate == null ? null : r.market_cap_rate * 100,
        },
      });
    }
  }
  for (const [key, { row }] of best) {
    const code = key.slice(0, key.indexOf("|"));
    if (!out.has(code)) out.set(code, new Map());
    out.get(code)!.set(row.slice, row);
  }
  return out;
}

function submarketFor(deal: Partial<DealRow>, figures: SubmarketFigures): SubmarketMarket | null {
  const anyDeal = deal as Record<string, unknown>;
  const code = anyDeal.costar_submarket_code as string | null | undefined;
  if (!code) return null;
  const vintage = (anyDeal.year_built as number | null) ?? (deal.vintage_year as number | null) ?? null;
  return figures.get(code)?.get(costarSliceFor(vintage)) ?? null;
}

function toScoreable(deal: Partial<DealRow> & { id: string }, submarket: SubmarketMarket | null = null): ScoreableDeal {
  const anyDeal = deal as Record<string, unknown>;
  const payload = (anyDeal.hellodata_payload ?? null) as HelloDataPayload | null;
  return {
    unit_count: (deal.unit_count as number | null) ?? null,
    vintage_year: (deal.vintage_year as number | null) ?? null,
    year_built: (anyDeal.year_built as number | null) ?? (deal.vintage_year as number | null) ?? null,
    in_place_avg_rent: (anyDeal.in_place_avg_rent as number | null) ?? null,
    classic_units_remaining: (anyDeal.classic_units_remaining as number | null) ?? null,
    total_renovated_units: (anyDeal.total_renovated_units as number | null) ?? null,
    asking_price: (deal.asking_price as number | null) ?? null,
    t12_noi: (anyDeal.t12_noi as number | null) ?? null,
    t12_opex: (anyDeal.t12_opex as number | null) ?? null,
    occupancy_pct: (anyDeal.occupancy_pct as number | null) ?? null,
    expense_ratio: (anyDeal.expense_ratio as number | null) ?? null,
    area_median_income_1mi: (anyDeal.area_median_income_1mi as number | null) ?? null,
    population_growth_pct: (anyDeal.population_growth_pct as number | null) ?? null,
    job_growth_pct: (anyDeal.job_growth_pct as number | null) ?? null,
    new_supply_pct_of_stock: (anyDeal.new_supply_pct_of_stock as number | null) ?? null,
    school_rating: (anyDeal.school_rating as number | null) ?? null,
    nearest_employment_node_min: (anyDeal.nearest_employment_node_min as number | null) ?? null,
    market_cap_rate: (anyDeal.market_cap_rate as number | null) ?? null,
    regulatory_risk: (anyDeal.regulatory_risk as RegulatoryRisk | null) ?? null,
    hellodata_payload: payload,
    submarket,
  };
}

export async function persistDealScore(
  deal: Partial<DealRow> & { id: string },
  // Passed by rescoreAllDeals, which loads every submarket in one go.
  figures?: SubmarketFigures,
): Promise<PersistedScoreFields> {
  if (!figures) {
    const code = (deal as Record<string, unknown>).costar_submarket_code as string | null | undefined;
    figures = await loadSubmarketFigures(code ? [code] : []);
  }
  const result = scoreDeal(toScoreable(deal, submarketFor(deal, figures)));

  const fields: PersistedScoreFields = {
    passes_hard_filters: result.passes_hard_filters,
    hard_filter_failures: result.hard_filter_failures,
    factor_scores: result.factor_scores as unknown as Record<string, number | null>,
    total_score: result.total_score,
    deal_tier: result.deal_tier,
    value_add_upside: result.value_add_upside,
    scored_at: result.scored_at,
  };

  const { error } = await supabase
    .from("deals")
    .update(fields as never)
    .eq("id", deal.id);
  if (error) throw error;

  return fields;
}

export async function rescoreAllDeals(): Promise<{
  scored: number;
  tierCounts: Record<string, number>;
}> {
  // The list columns PLUS hellodata_payload: scoreDeal() reads market rent,
  // occupancy, quality_score, expense_ratio, egr and the renovation premium out
  // of it. This is the one query that genuinely needs the blob, and it runs on
  // an explicit rescore action rather than on page load.
  const { data, error } = await supabase.from("deals").select(DEAL_SCORING_COLUMNS);

  if (error) throw error;

  const tierCounts: Record<string, number> = {};
  let scored = 0;
  const CHUNK = 8;
  // A concatenated select string defeats supabase-js's row typing.
  const rows = (data ?? []) as unknown as Array<Partial<DealRow> & { id: string }>;
  const codes = [...new Set(rows.map((d) => d.costar_submarket_code).filter((c): c is string => !!c))];
  const figures = await loadSubmarketFigures(codes);

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const results = await Promise.allSettled(chunk.map((d) => persistDealScore(d, figures)));
    results.forEach((r) => {
      if (r.status === "fulfilled") {
        scored += 1;
        const tier = r.value.deal_tier;
        tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
      } else {
        console.error("[persistDealScore] chunk error", r.reason);
      }
    });
  }

  return { scored, tierCounts };
}

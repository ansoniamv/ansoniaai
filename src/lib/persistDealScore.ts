import { DEAL_LIST_COLUMNS } from "@/lib/dealColumns";

/**
 * Bridges the pure buybox scoring engine (src/lib/dealScoring.ts) to the
 * `deals` table. Nothing else calls scoreDeal(), so without this file every
 * deal ends up as "Tier 4 – Weak" in the Pipeline dashboard.
 *
 * NOTE: This is completely separate from the deal-score edge function /
 * ai_score column. Do not conflate the two.
 */
import { supabase } from "@/integrations/supabase/client";
import { scoreDeal, type ScoreableDeal, type HelloDataPayload, type RegulatoryRisk } from "./dealScoring";
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

function toScoreable(deal: Partial<DealRow> & { id: string }): ScoreableDeal {
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
    area_median_income_1mi: (anyDeal.area_median_income_1mi as number | null) ?? null,
    population_growth_pct: (anyDeal.population_growth_pct as number | null) ?? null,
    job_growth_pct: (anyDeal.job_growth_pct as number | null) ?? null,
    new_supply_pct_of_stock: (anyDeal.new_supply_pct_of_stock as number | null) ?? null,
    school_rating: (anyDeal.school_rating as number | null) ?? null,
    nearest_employment_node_min: (anyDeal.nearest_employment_node_min as number | null) ?? null,
    market_cap_rate: (anyDeal.market_cap_rate as number | null) ?? null,
    regulatory_risk: (anyDeal.regulatory_risk as RegulatoryRisk | null) ?? null,
    hellodata_payload: payload,
  };
}

export async function persistDealScore(
  deal: Partial<DealRow> & { id: string }
): Promise<PersistedScoreFields> {
  const result = scoreDeal(toScoreable(deal));

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
  // Only the columns scoring actually reads — avoids pulling ~2 MB of unused
  // jsonb (hellodata_raw, comps, floor plans, photos) across every deal.
  const { data, error } = await supabase.from("deals").select(DEAL_LIST_COLUMNS);

  if (error) throw error;

  const tierCounts: Record<string, number> = {};
  let scored = 0;
  const CHUNK = 8;
  const rows = data ?? [];

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const results = await Promise.allSettled(chunk.map((d) => persistDealScore(d)));
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

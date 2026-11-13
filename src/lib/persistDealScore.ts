import { DEAL_SCORING_COLUMNS } from "@/lib/dealColumns";

/**
 * Bridges the pure buybox scoring engine (dealScoring) to the `deals` table
 * from the browser. Without it every deal ends up as "Tier 4 – Weak" in the
 * Pipeline dashboard.
 *
 * The reading and shaping live in supabase/functions/_shared/buyboxScore.ts so
 * the server scores a new deal the same way (onboard-deal).
 *
 * NOTE: This is completely separate from the deal-score edge function /
 * ai_score column. Do not conflate the two.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import {
  loadSubmarketFigures as loadFigures,
  persistBuyboxScore,
  type PersistedScoreFields,
  type SubmarketFigures,
} from "../../supabase/functions/_shared/buyboxScore.ts";

export type { PersistedScoreFields, SubmarketFigures };

type DealRow = Tables<"deals">;

export function loadSubmarketFigures(codes: string[]): Promise<SubmarketFigures> {
  return loadFigures(supabase, codes);
}

export async function persistDealScore(
  deal: Partial<DealRow> & { id: string },
  // Passed by rescoreAllDeals, which loads every submarket in one go.
  figures?: SubmarketFigures,
): Promise<PersistedScoreFields> {
  return persistBuyboxScore(supabase, deal as Record<string, unknown> & { id: string }, figures);
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

/**
 * Shared pipeline-stage + score labelling used by BOTH List View (Index.tsx)
 * and Dashboard View (PipelineDashboardPage.tsx).
 *
 * IMPORTANT — the two scores are DIFFERENT measures and must never be merged:
 *   ai_score    -> "AI Score"      LLM-adjusted, pillar weights + buy-box thesis adjustment (0-100)
 *   total_score -> "Buy Box Score" deterministic rules-based score
 *   deal_tier   -> "Buy Box Tier"  bucket derived from the rules-based score
 */

export const TIERS = ["Strong Fit", "Possible", "Pass"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_HEX: Record<Tier, string> = {
  "Strong Fit": "#002752",
  Possible: "#B7791F",
  Pass: "#5B6472",
};

/** Buy Box Tier — rules-based (deal_tier, falling back to total_score buckets). */
export function getTier(d: { deal_tier?: string | null; total_score?: number | null }): Tier {
  const t = (d.deal_tier ?? "").toLowerCase();
  if (t.includes("1") || t.includes("strong")) return "Strong Fit";
  if (t.includes("2") || t.includes("fit") || t.includes("3") || t.includes("marginal")) return "Possible";
  if (t.includes("disqual") || t.includes("4") || t.includes("weak")) return "Pass";
  const s = d.total_score ?? null;
  if (s == null) return "Possible";
  if (s >= 70) return "Strong Fit";
  if (s >= 50) return "Possible";
  return "Pass";
}

/** Canonical column labels shared across views. */
export const COLUMN_LABELS = {
  property_name: "Property",
  status: "Status",
  ai_score: "AI Score",
  total_score: "Buy Box Score",
  deal_tier: "Buy Box Tier",
  area_median_income: "Avg HH Income",
  area_median_income_1mi: "1-mi Median Income",
  annual_population_growth: "Pop Growth",
} as const;

export const SCORE_HELP = {
  ai_score:
    "AI Score (0-100): LLM-adjusted score using buy-box pillar weights plus the buy-box thesis adjustment. Not the same number as the Buy Box Score.",
  total_score:
    "Buy Box Score: deterministic, rules-based score from the buy-box factor model. Not the same number as the AI Score.",
  deal_tier: "Buy Box Tier: bucket derived from the rules-based Buy Box Score.",
} as const;

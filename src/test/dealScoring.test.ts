import { describe, expect, it } from "vitest";
import { scoreDeal, type ScoreableDeal } from "@/lib/dealScoring";

const base: ScoreableDeal = {
  unit_count: 200,
  vintage_year: 2000,
  in_place_avg_rent: 1200,
  area_median_income_1mi: 60000,
  population_growth_pct: 1,
  job_growth_pct: 1,
  new_supply_pct_of_stock: 3,
  school_rating: 7,
  market_cap_rate: 5.5,
  regulatory_risk: "low",
};

describe("scoreDeal", () => {
  it("still scores factors for a disqualified deal, but withholds the total and tier", () => {
    const passing = scoreDeal(base);
    const failing = scoreDeal({ ...base, population_growth_pct: -0.47, job_growth_pct: -0.08 });

    expect(passing.passes_hard_filters).toBe(true);
    expect(failing.passes_hard_filters).toBe(false);
    expect(failing.hard_filter_failures.map((f) => f.rule)).toContain("growth");
    expect(failing.total_score).toBeNull();
    expect(failing.deal_tier).toBe("Disqualified");
    // The factors are scored, not blanked.
    expect(Object.values(failing.factor_scores).some((v) => v != null)).toBe(true);
    expect(failing.factor_scores.regulatory_tax).toBe(passing.factor_scores.regulatory_tax);
  });
});

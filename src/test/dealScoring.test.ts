import { describe, expect, it } from "vitest";
import { costarSliceFor, scoreDeal, type ScoreableDeal } from "@/lib/dealScoring";

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

describe("scoreDeal: document and CoStar inputs", () => {
  // 1900 at Canterfield: 2018, T12 47.7% opex, rent roll 96.5% / $2,028,
  // Elgin/Dundee 4 & 5 Star at 94.6% occupied, $2,180 asking, 6.1% cap.
  const deal: ScoreableDeal = {
    ...base,
    vintage_year: 2018,
    in_place_avg_rent: 2028,
    occupancy_pct: 96.5,
    expense_ratio: 47.7,
    market_cap_rate: null,
    submarket: { slice: "4 & 5 Star", occupancy_pct: 94.6, asking_rent: 2180, cap_rate_pct: 6.1 },
  };
  const f = scoreDeal(deal).factor_scores;

  it("scores opex from the deal's own expense ratio", () => expect(f.opex_benchmark).toBeCloseTo(81.9, 1));
  it("scores occupancy against the submarket", () => expect(f.occupancy_concessions).toBe(55));
  it("scores capital markets from the submarket cap rate", () => expect(f.capital_markets_exit).toBeCloseTo(69.6, 1));
  it("scores rent lag against the submarket asking rent", () => expect(f.rent_lag).toBeCloseTo(54.1, 0));
  it("lets a typed-in cap rate beat the submarket's", () => {
    expect(scoreDeal({ ...deal, market_cap_rate: 5 }).factor_scores.capital_markets_exit).toBeCloseTo(52, 1);
  });
  it("leaves them blank with no submarket", () => {
    const g = scoreDeal({ ...deal, submarket: null }).factor_scores;
    expect(g.rent_lag).toBeNull();
    expect(g.occupancy_concessions).toBeNull();
    expect(g.capital_markets_exit).toBeNull();
  });
});

describe("costarSliceFor", () => {
  it("compares newer buildings with 4 & 5 Star stock", () => {
    expect(costarSliceFor(2018)).toBe("4 & 5 Star");
    expect(costarSliceFor(2000)).toBe("4 & 5 Star");
    expect(costarSliceFor(1999)).toBe("3 Star");
    expect(costarSliceFor(null)).toBe("3 Star");
  });
});

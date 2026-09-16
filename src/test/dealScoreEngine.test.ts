import { describe, it, expect } from "vitest";
import {
  computeDealScore,
  scoreSignal,
  resolve,
} from "../../supabase/functions/_shared/dealScoreEngine";

/**
 * The real buy-box config, as captured into version control by
 * 20260915160000_capture_buy_box_config.sql. Only the pillars and signals that
 * an inbox_deal can actually resolve are reproduced in full; the tract- and
 * permit-sourced signals are included because their exclusion is the point.
 */
const PILLARS = [
  { id: "p-demand", key: "market_demand", name: "Market Demand & Demographics", weight: 20 },
  { id: "p-supply", key: "market_supply", name: "Market Supply & Rent Dynamics", weight: 25 },
  { id: "p-location", key: "location", name: "Location & Accessibility", weight: 10 },
  { id: "p-asset", key: "asset_quality", name: "Asset Quality & Vintage", weight: 15 },
  { id: "p-va", key: "value_add", name: "Value-Add Opportunity", weight: 20 },
  // Filtered out of the inbox fit score by isEconomicsPillar.
  { id: "p-econ", key: "deal_economics", name: "Deal Economics", weight: 10 },
];

const sig = (o: Record<string, unknown>) => ({ is_active: true, ...o });

const SIGNALS = [
  // market_demand — every source is tract enrichment, unavailable for inbox deals
  sig({ pillar_id: "p-demand", name: "Median household income (tract)", field_source: "deals.median_income_tract", scoring_method: "higher_better", min_value: 35000, max_value: 120000, weight_within_pillar: 25 }),
  sig({ pillar_id: "p-demand", name: "Population growth (5yr, tract)", field_source: "deal_enrichment.rings.5mi.pop_growth_5yr", scoring_method: "higher_better", min_value: -5, max_value: 20, weight_within_pillar: 30 }),
  // market_supply
  sig({ pillar_id: "p-supply", name: "Tract vacancy rate", field_source: "deals.vacancy_rate_tract", scoring_method: "lower_better", min_value: 2, max_value: 15, weight_within_pillar: 25 }),
  sig({ pillar_id: "p-supply", name: "New supply pressure", field_source: "permits.permits_per_1k_units", scoring_method: "lower_better", min_value: 0, max_value: 50, weight_within_pillar: 30 }),
  // location
  sig({ pillar_id: "p-location", name: "Owner-occupied %", field_source: "deals.owner_occupied_pct_tract", scoring_method: "range_optimal", min_value: 0, max_value: 100, optimal_min: 30, optimal_max: 70, weight_within_pillar: 40 }),
  // asset_quality — unit_count and vintage_year DO resolve from an inbox_deal
  sig({ pillar_id: "p-asset", name: "Vintage year", field_source: "deals.vintage_year", scoring_method: "range_optimal", min_value: 1960, max_value: 2025, optimal_min: 1990, optimal_max: 2021, weight_within_pillar: 35 }),
  sig({ pillar_id: "p-asset", name: "Unit count", field_source: "deals.unit_count", scoring_method: "higher_better", min_value: 50, max_value: 400, weight_within_pillar: 30 }),
  sig({ pillar_id: "p-asset", name: "Building quality score", field_source: "deals.building_quality_score", scoring_method: "higher_better", min_value: 1, max_value: 10, weight_within_pillar: 25 }),
  sig({ pillar_id: "p-asset", name: "Not in lease-up", field_source: "deals.is_lease_up", scoring_method: "boolean", weight_within_pillar: 10 }),
  // value_add
  sig({ pillar_id: "p-va", name: "Value-add potential rating", field_source: "deals.value_add_potential", scoring_method: "higher_better", min_value: 1, max_value: 3, weight_within_pillar: 50 }),
  sig({ pillar_id: "p-va", name: "In-place rent gap", field_source: "derived.rent_gap_pct", scoring_method: "higher_better", min_value: 0, max_value: 30, weight_within_pillar: 30 }),
  sig({ pillar_id: "p-va", name: "No revenue management", field_source: "deals.uses_rev_management", scoring_method: "boolean", weight_within_pillar: 20 }),
  // deal_economics — must never appear in the breakdown
  sig({ pillar_id: "p-econ", name: "Price per unit", field_source: "derived.price_per_unit", scoring_method: "lower_better", min_value: 50000, max_value: 400000, weight_within_pillar: 40 }),
];

const COFFEY_CREEK = {
  property_name: "Coffey Creek Apartments",
  units: 420,
  year_built: 1990,
  location_city: "Charlotte",
  location_state: "NC",
  msa: "Charlotte-Concord-Gastonia, NC-SC",
  asset_class: "Multifamily",
  strategy: "Value-Add",
  asking_price: null,
};

describe("Coffey Creek — complete data reaches STRONG", () => {
  const result = computeDealScore(COFFEY_CREEK, PILLARS, SIGNALS);

  it("prints the per-pillar breakdown", () => {
    const lines = result.breakdown.map((p) => {
      const sigs = p.signals
        .map((s) => `      ${s.score == null ? "  —" : String(s.score).padStart(3)}  ${s.name} (w${s.weight}, raw=${JSON.stringify(s.raw_value)})`)
        .join("\n");
      return `  ${p.key.padEnd(15)} weight ${String(p.weight).padStart(2)}  subscore ${p.score == null ? "— (excluded)" : p.score}\n${sigs}`;
    });
    // eslint-disable-next-line no-console
    console.log(
      `\nCoffey Creek — 420 units, built 1990, Charlotte NC, value-add MF\n\n${lines.join("\n")}\n` +
        `\n  scored pillars: ${result.scoredPillarCount}   renormalised weight: ${result.totalWeight}` +
        `\n  FINAL: ${result.finalScore}  TIER: ${result.tier}\n`,
    );
    expect(result.breakdown.length).toBeGreaterThan(0);
  });

  it("reaches 100 / strong", () => {
    expect(result.finalScore).toBe(100);
    expect(result.tier).toBe("strong");
  });

  it("scores asset_quality at 100 from units + vintage alone", () => {
    const asset = result.breakdown.find((p) => p.key === "asset_quality")!;
    expect(asset.score).toBe(100);
    // The two unresolvable signals are excluded, not scored as a midpoint.
    expect(asset.signals.find((s) => s.name === "Building quality score")!.score).toBeNull();
    expect(asset.signals.find((s) => s.name === "Not in lease-up")!.score).toBeNull();
  });

  it("scores value_add at 100 from the strategy-derived rating", () => {
    const va = result.breakdown.find((p) => p.key === "value_add")!;
    expect(va.score).toBe(100);
  });

  it("excludes every pillar whose signals cannot resolve", () => {
    for (const key of ["market_demand", "market_supply", "location"]) {
      expect(result.breakdown.find((p) => p.key === key)!.score).toBeNull();
    }
  });

  it("excludes the economics pillar from the inbox fit score entirely", () => {
    expect(result.breakdown.find((p) => p.key === "deal_economics")).toBeUndefined();
  });

  it("renormalises to only the pillars that scored", () => {
    // asset_quality 15 + value_add 20, not the full 100.
    expect(result.totalWeight).toBe(35);
    expect(result.scoredPillarCount).toBe(2);
  });
});

describe("the 71 ceiling — a null strategy must not pin value_add at 50", () => {
  // Same deal, strategy unknown because extraction never ran.
  const noStrategy = { ...COFFEY_CREEK, strategy: null };
  const result = computeDealScore(noStrategy, PILLARS, SIGNALS);

  it("excludes value_add rather than scoring it at the midpoint", () => {
    const va = result.breakdown.find((p) => p.key === "value_add")!;
    expect(va.score).toBeNull();
    expect(va.signals.find((s) => s.name === "Value-add potential rating")!.score).toBeNull();
  });

  it("does not produce the old 71", () => {
    // Before: value_add_potential fell through to a hardcoded 2, which on a
    // higher_better 1..3 signal is exactly 50, giving
    // (100*15 + 50*20) / 35 = 71 for a deal with perfect asset quality.
    expect(result.finalScore).not.toBe(71);
  });

  it("leaves the deal unscored when only one pillar survives", () => {
    // asset_quality alone is below MIN_SCORED_PILLARS, so it stays unscored and
    // surfaces on the board rather than being buried with a fake number.
    expect(result.scoredPillarCount).toBe(1);
    expect(result.finalScore).toBeNull();
    expect(result.tier).toBeNull();
  });
});

describe("resolver and signal-level exclusion", () => {
  it("maps legacy deals.* names onto the inbox_deal schema", () => {
    const ctx = { deal: COFFEY_CREEK, derived: { asking_price_num: null, price_per_unit: null, rent_gap_pct: null } };
    expect(resolve("deals.unit_count", ctx)).toBe(420);
    expect(resolve("deals.vintage_year", ctx)).toBe(1990);
    expect(resolve("deals.state", ctx)).toBe("NC");
  });

  it("returns undefined for enrichment sources an inbox deal cannot have", () => {
    const ctx = { deal: COFFEY_CREEK, derived: { asking_price_num: null, price_per_unit: null, rent_gap_pct: null } };
    expect(resolve("deal_enrichment.rings.5mi.pop_growth_5yr", ctx)).toBeUndefined();
    expect(resolve("permits.permits_per_1k_units", ctx)).toBeUndefined();
    expect(resolve("deals.building_quality_score", ctx)).toBeUndefined();
  });

  it("scoreSignal returns null for absent input rather than a midpoint", () => {
    const s = { scoring_method: "higher_better", min_value: 0, max_value: 100 };
    expect(scoreSignal(null, s)).toBeNull();
    expect(scoreSignal(undefined, s)).toBeNull();
    expect(scoreSignal("", s)).toBeNull();
  });
});

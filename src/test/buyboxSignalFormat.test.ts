import { describe, it, expect } from "vitest";
import { describeRange, formatSignalValue, missingHint } from "@/lib/buyboxSignalFormat";

describe("formatSignalValue", () => {
  it("reads each signal in its own units", () => {
    expect(formatSignalValue("derived.price_per_unit", 284615)).toBe("$285K");
    expect(formatSignalValue("deals.estimated_equity", 25.9)).toBe("$25.9M");
    expect(formatSignalValue("derived.rent_gap_pct", 5.6)).toBe("5.6% below market");
    expect(formatSignalValue("derived.rent_gap_pct", -3.9)).toBe("3.9% above market");
    expect(formatSignalValue("costar.uc_pct", 0.0599)).toBe("6%");
  });

  it("falls back to a plain number for a signal it has no entry for", () => {
    expect(formatSignalValue("deals.something_new", 1234.567)).toBe("1,234.6");
  });

  it("shows booleans as Yes / No and missing as a dash", () => {
    expect(formatSignalValue("derived.no_rev_management", false)).toBe("No");
    expect(formatSignalValue("derived.loss_to_lease_pct", null)).toBe("—");
  });
});

describe("describeRange", () => {
  it("says which end scores 100, in the signal's units", () => {
    const r = { min_value: 50000, max_value: 300000, optimal_min: null, optimal_max: null };
    expect(describeRange("derived.price_per_unit", { method: "lower_better", ...r })).toBe(
      "Lower is better: $50K or less scores 100, $300K or more scores 0.",
    );
  });

  it("puts a rent gap's range in market terms", () => {
    expect(
      describeRange("derived.rent_gap_pct", { method: "higher_better", min_value: -10, max_value: 20, optimal_min: null, optimal_max: null }),
    ).toBe("20% below market or further scores 100; 10% above market or further scores 0.");
  });
});

describe("missingHint", () => {
  it("points document signals at the upload", () => {
    expect(missingHint("derived.loss_to_lease_pct")).toMatch(/rent roll/);
    expect(missingHint("costar.uc_pct")).toMatch(/submarket/);
    expect(missingHint("deals.median_age_tract")).toBeNull();
  });
});

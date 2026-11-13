import { describe, it, expect } from "vitest";
import { bedKey, rentsByBed, rentVsMarket } from "../../supabase/functions/_shared/hellodataRentComps.ts";

const NOW = new Date("2026-11-13T00:00:00Z");
const unit = (bed: number, price: number, over: Record<string, unknown> = {}) => ({
  bed, price, effective_price: null, enter_market: "2026-10-01", exit_market: null, ...over,
});

describe("rentsByBed", () => {
  it("averages listed rents per bedroom count, effective rent first", () => {
    const r = rentsByBed({ building_availability: [unit(1, 1000), unit(1, 1200, { effective_price: 1100 }), unit(2, 1500)] }, NOW);
    expect(r).toEqual({ "1": { avg: 1050, n: 2 }, "2": { avg: 1500, n: 1 } });
  });
  it("drops stale listings and nonsense rents", () => {
    const r = rentsByBed({ building_availability: [unit(1, 1000, { exit_market: "2024-01-01" }), unit(1, 50), unit(1, 1300)] }, NOW);
    expect(r).toEqual({ "1": { avg: 1300, n: 1 } });
  });
  it("folds 3+ bedrooms together and skips units with no bed count", () => {
    expect(bedKey(4)).toBe("3");
    expect(bedKey(null)).toBeNull();
    expect(rentsByBed({ building_availability: [unit(4, 2000), { price: 900 }] }, NOW)).toEqual({ "3": { avg: 2000, n: 1 } });
  });
  it("returns nothing for a payload with no listings", () => expect(rentsByBed({}, NOW)).toEqual({}));
});

describe("rentVsMarket", () => {
  it("compares bedroom for bedroom, weighted by the property's own listings", () => {
    const r = rentVsMarket(
      { "1": { avg: 900, n: 3 }, "2": { avg: 1200, n: 1 } },
      [{ "1": { avg: 1000, n: 5 }, "2": { avg: 1400, n: 2 } }, { "1": { avg: 1000, n: 1 } }],
    )!;
    expect(r.market_rent).toBe(1100); // (1000*3 + 1400*1) / 4
    expect(r.subject_rent).toBe(975); // (900*3 + 1200*1) / 4
    expect(r.pct).toBeCloseTo(-11.4, 1);
    expect(r.beds.map((b) => b.comps)).toEqual([2, 1]);
  });
  it("ignores bedroom counts the comps don't have", () => {
    const r = rentVsMarket({ "0": { avg: 800, n: 10 }, "1": { avg: 1000, n: 1 } }, [{ "1": { avg: 1000, n: 1 } }])!;
    expect(r.pct).toBe(0);
    expect(r.beds).toHaveLength(1);
  });
  it("gives nothing when no bedroom count overlaps", () => {
    expect(rentVsMarket({ "0": { avg: 800, n: 1 } }, [{ "2": { avg: 1500, n: 1 } }])).toBeNull();
  });
});

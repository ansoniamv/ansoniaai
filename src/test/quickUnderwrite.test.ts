import { describe, it, expect } from "vitest";
import { DEFAULT_QUICK_CAP_RATE, quickUnderwrite } from "@/lib/quickUnderwrite";

const base = { t12Noi: 1_200_000, adjustment: null, capRate: null, askingPriceM: 18, unitCount: 200 };

describe("quickUnderwrite", () => {
  it("caps T-12 NOI at the 6% house rate when the deal has none", () => {
    const q = quickUnderwrite(base);
    expect(DEFAULT_QUICK_CAP_RATE).toBe(6);
    expect(q.capIsDefault).toBe(true);
    expect(q.noi).toBe(1_200_000);
    expect(q.value).toBeCloseTo(20_000_000);
    expect(q.valuePerUnit).toBeCloseTo(100_000);
    expect(q.vsAsk).toBeCloseTo(2_000_000);
    expect(q.vsAskPct).toBeCloseTo(11.11, 2);
    expect(q.missing).toBeNull();
  });

  it("uses the deal's own cap rate and adjustment", () => {
    const q = quickUnderwrite({ ...base, capRate: 5.5, adjustment: -100_000 });
    expect(q.capIsDefault).toBe(false);
    expect(q.noi).toBe(1_100_000);
    expect(q.value).toBeCloseTo(20_000_000);
  });

  it.each([0, -1, null, Number.NaN])("falls back to the default for a cap of %s", (cap) => {
    expect(quickUnderwrite({ ...base, capRate: cap }).capRate).toBe(6);
  });

  it("says what is missing instead of valuing", () => {
    expect(quickUnderwrite({ ...base, t12Noi: null }).missing).toBe("Needs T-12 NOI");
    const negative = quickUnderwrite({ ...base, adjustment: -1_300_000 });
    expect(negative.value).toBeNull();
    expect(negative.missing).toBe("NOI is not positive");
  });

  it("leaves the ask comparison and per-unit blank without their inputs", () => {
    const q = quickUnderwrite({ ...base, askingPriceM: null, unitCount: 0 });
    expect(q.value).toBeCloseTo(20_000_000);
    expect(q.vsAsk).toBeNull();
    expect(q.vsAskPct).toBeNull();
    expect(q.valuePerUnit).toBeNull();
  });
});

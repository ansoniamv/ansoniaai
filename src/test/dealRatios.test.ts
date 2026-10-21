import { describe, it, expect } from "vitest";
import { grossRentMultiplier, inPlaceCapRate } from "@/lib/dealRatios";

describe("inPlaceCapRate", () => {
  it("divides annual NOI by the price, which deals stores in $M", () => {
    // Summerlin: $1,393,673 NOI on a $24.0M ask.
    const r = inPlaceCapRate(1_393_673, 24);
    expect(r.value).toBeCloseTo(5.807, 3);
    expect(r.hint).toBe("T-12 NOI ÷ asking price");
  });
  it("keeps a negative NOI negative", () => {
    expect(inPlaceCapRate(-120_000, 12).value).toBeCloseTo(-1, 6);
  });
  it.each([
    [null, 24, "Needs T-12 NOI"],
    [1_000_000, null, "Needs asking price"],
    [1_000_000, 0, "Needs asking price"],
    [undefined, undefined, "Needs T-12 NOI and asking price"],
  ])("noi=%s price=%s -> %s", (noi, price, hint) => {
    expect(inPlaceCapRate(noi, price)).toEqual({ value: null, hint });
  });
});

describe("grossRentMultiplier", () => {
  it("divides the price in dollars by annual gross scheduled rent", () => {
    // Summerlin: $24.0M on $2,589,200 a year.
    expect(grossRentMultiplier(2_589_200, 24).value).toBeCloseTo(9.269, 3);
  });
  it.each([
    [null, 24, "Needs gross sched. rent"],
    [0, 24, "Needs gross sched. rent"],
    [2_589_200, null, "Needs asking price"],
    [null, null, "Needs gross sched. rent and asking price"],
  ])("gsr=%s price=%s -> %s", (gsr, price, hint) => {
    expect(grossRentMultiplier(gsr, price)).toEqual({ value: null, hint });
  });
});

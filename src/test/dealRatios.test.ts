import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { capRateHint, equityCheck, grmHint, latestT3Noi, monthlyGrm, pricePerSqft } from "@/lib/dealRatios";

describe("capRateHint", () => {
  it.each([
    [1_393_673, 24, "T-12 NOI ÷ asking price"],
    [-120_000, 12, "T-12 NOI ÷ asking price"],
    [null, 24, "Needs T-12 NOI"],
    [1_000_000, null, "Needs asking price"],
    [1_000_000, 0, "Needs asking price"],
    [undefined, undefined, "Needs T-12 NOI and asking price"],
  ])("noi=%s price=%s -> %s", (noi, price, out) => {
    expect(capRateHint(noi, price)).toBe(out);
  });
});

describe("grmHint", () => {
  it.each([
    [2_589_200, 24, "Asking price ÷ annual gross sched. rent"],
    [null, 24, "Needs gross sched. rent"],
    [0, 24, "Needs gross sched. rent"],
    [2_589_200, null, "Needs asking price"],
    [null, null, "Needs gross sched. rent and asking price"],
  ])("gsr=%s price=%s -> %s", (gsr, price, out) => {
    expect(grmHint(gsr, price)).toBe(out);
  });
  it("describes the monthly multiple", () => {
    expect(grmHint(2_589_200, 24, "monthly")).toBe("Asking price ÷ monthly rent (annual × 12)");
    expect(grmHint(null, 24, "monthly")).toBe("Needs gross sched. rent");
  });
});

describe("monthlyGrm", () => {
  it("is the annual multiple × 12", () => {
    expect(monthlyGrm(11.22)).toBeCloseTo(134.64);
  });
  it.each([null, undefined, NaN])("is null for annual=%s", (g) => {
    expect(monthlyGrm(g)).toBeNull();
  });
});

/**
 * The hints promise a value exactly when the generated column produces one.
 * Pin the column's conditions so the two cannot drift apart.
 */
describe("generated columns", () => {
  const sql = readFileSync(
    path.resolve(__dirname, "../../supabase/migrations/20261021190000_deal_cap_rate_grm_generated.sql"),
    "utf8",
  );
  it("computes cap rate when NOI exists and price is positive, in percent", () => {
    expect(sql).toContain("WHEN t12_noi IS NOT NULL AND asking_price > 0");
    expect(sql).toContain("t12_noi / (asking_price * 1000000) * 100");
  });
  it("computes GRM when rent and price are both positive", () => {
    expect(sql).toContain("WHEN gross_scheduled_rent > 0 AND asking_price > 0");
    expect(sql).toContain("asking_price * 1000000 / gross_scheduled_rent");
  });
});

describe("equityCheck", () => {
  it("is 35% of asking, in dollars", () => {
    expect(equityCheck(24)).toBeCloseTo(8_400_000);
  });
  it.each([null, 0, -5, undefined])("is null for asking=%s", (p) => {
    expect(equityCheck(p)).toBeNull();
  });
});

describe("pricePerSqft", () => {
  it("prefers the stored figure", () => {
    expect(pricePerSqft(210, 24, 100_000)).toEqual({ value: 210 });
  });
  it("derives from asking and rentable SF when nothing is stored", () => {
    expect(pricePerSqft(null, 24, 120_000)).toEqual({ value: 200, hint: "Asking price ÷ rentable SF" });
  });
  it("names what is missing", () => {
    expect(pricePerSqft(null, 24, null)).toEqual({ value: null, hint: "Needs rentable SF" });
    expect(pricePerSqft(null, null, null)).toEqual({ value: null, hint: "Needs asking price and rentable SF" });
  });
});

describe("latestT3Noi", () => {
  const t12 = (over: Record<string, unknown>) => ({
    doc_type: "t12",
    parse_status: "parsed",
    doc_as_of: null,
    created_at: "2026-10-01T00:00:00Z",
    summary: { t12: { period: "Sep 2026", t3_noi: 1_000_000 } },
    ...over,
  });
  it("is null with no parsed T12", () => {
    expect(latestT3Noi([])).toBeNull();
    expect(latestT3Noi([t12({ parse_status: "parsing" })])).toBeNull();
    expect(latestT3Noi([t12({ doc_type: "om" })])).toBeNull();
    expect(latestT3Noi([t12({ summary: { t12: { period: null, t3_noi: null } } })])).toBeNull();
  });
  it("takes the newest statement, then the newest upload", () => {
    const old = t12({ doc_as_of: "2026-06-30", summary: { t12: { period: "Jun 2026", t3_noi: 900_000 } } });
    const recent = t12({ doc_as_of: "2026-09-30", created_at: "2026-01-01T00:00:00Z" });
    expect(latestT3Noi([old, recent])).toEqual({ value: 1_000_000, period: "Sep 2026" });
    const a = t12({ created_at: "2026-10-02T00:00:00Z", summary: { t12: { period: "x", t3_noi: 5 } } });
    expect(latestT3Noi([t12({}), a])?.value).toBe(5);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { capRateHint, grmHint } from "@/lib/dealRatios";

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
    [2_589_200, 24, "Asking price ÷ gross sched. rent"],
    [null, 24, "Needs gross sched. rent"],
    [0, 24, "Needs gross sched. rent"],
    [2_589_200, null, "Needs asking price"],
    [null, null, "Needs gross sched. rent and asking price"],
  ])("gsr=%s price=%s -> %s", (gsr, price, out) => {
    expect(grmHint(gsr, price)).toBe(out);
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

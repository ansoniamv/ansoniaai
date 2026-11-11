import { describe, expect, it } from "vitest";
import type { Deal } from "@/hooks/useDeals";
import { groupByStage, internalTotals, scoreLabel } from "@/lib/internalTearsheet";

const deal = (p: Partial<Deal>) =>
  ({ id: Math.random().toString(36), property_name: "X", status: "New", ...p }) as Deal;

describe("internal tearsheet", () => {
  it("groups by board stage order and sorts by AI score within a stage", () => {
    const groups = groupByStage([
      deal({ property_name: "A", status: "Underwriting", ai_score: 40 }),
      deal({ property_name: "B", status: "New", ai_score: 10 }),
      deal({ property_name: "C", status: "Underwriting", ai_score: 90 }),
      deal({ property_name: "D", status: "Underwriting", ai_score: null }),
    ]);
    expect(groups.map((g) => g.stage)).toEqual(["New", "Underwriting"]);
    expect(groups[1].deals.map((d) => d.property_name)).toEqual(["C", "A", "D"]);
  });

  it("totals units, cap and equity, counting unsized and off-market deals", () => {
    const t = internalTotals([
      deal({ unit_count: 100, asking_price: 20, estimated_equity: 6, marketed: false }),
      deal({ unit_count: 50, asking_price: 10, estimated_equity: null }),
    ]);
    expect(t).toMatchObject({ count: 2, units: 150, totalCap: 30, equity: 6, unsized: 1, offMarket: 1 });
  });

  it("hides scores flagged insufficient", () => {
    expect(scoreLabel(deal({ ai_score: 72, score_confidence: "insufficient" }))).toBe("—");
    expect(scoreLabel(deal({ ai_score: 72, score_confidence: "high" }))).toBe("72");
  });
});

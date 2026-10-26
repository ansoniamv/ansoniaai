import { describe, expect, it } from "vitest";
import {
  rankPartnerMatches,
  scoreCapitalStatus,
  scorePartnerMatch,
  type MatchablePartner,
  type StrategyKey,
} from "@/lib/partnerMatching";

const deal = { state: "IL", city: "Chicago", estimated_equity: 10 };
const strategies = new Set<StrategyKey>(["value_add"]);

const partner = (over: Partial<MatchablePartner>): MatchablePartner => ({
  id: over.name ?? "p",
  name: "Partner",
  min_equity_m: 5,
  max_equity_m: 20,
  geography: ["Illinois"],
  strategy_value_add: true,
  ...over,
});

describe("scoreCapitalStatus", () => {
  const now = new Date("2026-10-26T12:00:00");

  it("is neutral when no status is set", () => {
    expect(scoreCapitalStatus(partner({}), now)).toEqual({ status: null, adjustment: 0, needsReconfirmation: false });
  });

  it("orders the four statuses from deploying to out of capital", () => {
    const pts = ["Actively Deploying", "Selective", "Constrained", "Out of Capital"].map(
      (s) => scoreCapitalStatus(partner({ capital_status: s }), now).adjustment,
    );
    expect(pts).toEqual([...pts].sort((a, b) => b - a));
    expect(pts[0]).toBeGreaterThan(0);
    expect(pts[3]).toBeLessThan(pts[2]);
  });

  it("keeps the penalty while the stated window is still ahead", () => {
    const r = scoreCapitalStatus(partner({ capital_status: "Out of Capital", capital_available_from: "2027-01-01" }), now);
    expect(r.adjustment).toBeLessThan(0);
    expect(r.needsReconfirmation).toBe(false);
  });

  it("drops the penalty and asks for re-confirmation once the window has passed", () => {
    const r = scoreCapitalStatus(partner({ capital_status: "Constrained", capital_available_from: "2026-10-01" }), now);
    expect(r).toEqual({ status: "Constrained", adjustment: 0, needsReconfirmation: true });
  });

  it("treats the available-from date as local, not UTC midnight", () => {
    const r = scoreCapitalStatus(
      partner({ capital_status: "Out of Capital", capital_available_from: "2026-10-27" }),
      new Date("2026-10-26T23:30:00"),
    );
    expect(r.needsReconfirmation).toBe(false);
  });
});

describe("capital status in the ranking", () => {
  it("never changes the fit score or tier", () => {
    const base = scorePartnerMatch(deal, partner({}), "", strategies);
    const out = scorePartnerMatch(deal, partner({ capital_status: "Out of Capital" }), "", strategies);
    expect(out.score).toBe(base.score);
    expect(out.tier).toBe(base.tier);
    expect(out.rankScore).toBeLessThan(out.score);
  });

  it("ranks an out-of-capital perfect fit below a deploying near fit", () => {
    const { matches } = rankPartnerMatches(
      deal,
      [
        partner({ id: "a", name: "Alpha", capital_status: "Out of Capital" }),
        partner({ id: "b", name: "Beta", capital_status: "Actively Deploying", geography: ["Midwest"] }),
      ],
      "",
      strategies,
    );
    expect(matches[0].score).toBeLessThan(matches[1].score);
    expect(matches.map((m) => m.partner.name)).toEqual(["Beta", "Alpha"]);
  });

  it("orders equal fits by capital status before warmth", () => {
    const { matches } = rankPartnerMatches(
      deal,
      [
        partner({ id: "a", name: "Alpha", capital_status: "Selective", relationship_strength: "Existing Partner" }),
        partner({ id: "b", name: "Beta", relationship_strength: "Cold" }),
      ],
      "",
      strategies,
    );
    expect(matches.map((m) => m.partner.name)).toEqual(["Beta", "Alpha"]);
  });
});

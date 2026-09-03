import { describe, expect, it } from "vitest";
import {
  buildWhyLine,
  rankDealsForPartner,
  businessPlanLabel,
  marketLabel,
} from "@/lib/partnerPipelineFit";
import { scorePartnerMatch, defaultDealStrategies, type MatchablePartner } from "@/lib/partnerMatching";
import type { Deal } from "@/hooks/useDeals";

const partner = (over: Partial<MatchablePartner> = {}): MatchablePartner => ({
  id: "p1",
  name: "Grandview Partners",
  min_equity_m: 10,
  max_equity_m: 25,
  geography: ["Ohio", "Midwest"],
  geography_avoid: [],
  strategy_value_add: true,
  strategy_core_plus: false,
  strategy_workforce: false,
  strategy_affordable: false,
  ...over,
});

const deal = (over: Partial<Deal> = {}): Deal =>
  ({
    id: "d1",
    property_name: "Maple Court",
    city: "Columbus",
    state: "OH",
    msa: "Columbus, OH",
    estimated_equity: 18,
    unit_count: 220,
    vintage_year: 1998,
    asking_price: 42,
    value_add_potential: "High",
    affordable: false,
    status: "Screening",
    notes: null,
    ...over,
  }) as unknown as Deal;

function why(d: Deal, p: MatchablePartner, notes = "") {
  const match = scorePartnerMatch(
    { state: d.state, city: d.city, msa: d.msa, estimated_equity: d.estimated_equity as number },
    p,
    notes,
    defaultDealStrategies(d),
  );
  return buildWhyLine(match, d, p);
}

describe("buildWhyLine", () => {
  it("states an in-band check size", () => {
    expect(why(deal(), partner())).toContain("$18M equity fits your $10M–$25M range");
  });

  it("states an above-band check size", () => {
    expect(why(deal({ estimated_equity: 42 } as Partial<Deal>), partner())).toContain(
      "above your stated $10M–$25M range",
    );
  });

  it("states a below-band check size", () => {
    expect(why(deal({ estimated_equity: 6 } as Partial<Deal>), partner())).toContain(
      "below your stated $10M–$25M range",
    );
  });

  it("says an unpriced deal is not yet sized", () => {
    expect(why(deal({ estimated_equity: null } as Partial<Deal>), partner())).toMatch(
      /not yet sized/i,
    );
  });

  it("recognises a national mandate", () => {
    expect(why(deal(), partner({ geography: ["National"] }))).toContain("national mandate");
  });

  it("never echoes the avoid term or the word avoid", () => {
    const line = why(deal(), partner({ geography_avoid: ["Chicago", "Ohio"] }));
    expect(line).toBe("Outside your stated target markets.");
    expect(line.toLowerCase()).not.toContain("avoid");
    expect(line.toLowerCase()).not.toContain("ohio");
  });

  it("leaks nothing on a negative notes adjustment", () => {
    const p = partner({ additional_notes: "We are not interested in Columbus at all." });
    const line = why(deal(), p);
    expect(line.toLowerCase()).not.toContain("not interested");
    expect(line.toLowerCase()).not.toContain("lines up with preferences");
  });

  it("never nudges about missing partner data in the row copy", () => {
    const p = partner({
      min_equity_m: null,
      max_equity_m: null,
      geography: [],
      strategy_value_add: false,
    });
    const line = why(deal(), p);
    expect(line).not.toContain("page 2");
    expect(line).not.toContain("on file");
  });

  it("renders a single figure when min equals max", () => {
    expect(why(deal({ estimated_equity: 66 } as Partial<Deal>), partner({ min_equity_m: 66, max_equity_m: 66 }))).toContain("$66M");
  });

  it("keeps why-lines to at most two clauses", () => {
    const line = why(deal(), partner());
    expect(line.split(";").length).toBeLessThanOrEqual(2);
  });
});

describe("rankDealsForPartner", () => {
  it("puts unpriced deals in unrated, never weak", () => {
    const out = rankDealsForPartner(
      partner(),
      [deal({ id: "x", estimated_equity: null } as Partial<Deal>)],
      {},
    );
    expect(out.unrated).toHaveLength(1);
    expect(out.weak).toHaveLength(0);
  });

  it("hard-gates avoid-list deals into outside", () => {
    const out = rankDealsForPartner(partner({ geography_avoid: ["Ohio"] }), [deal()], {});
    expect(out.outside).toHaveLength(1);
  });

  it("never surfaces internal analyst strings", () => {
    const out = rankDealsForPartner(partner(), [deal()], {
      d1: [{ content: "Broker says seller is desperate; warmth is Cold." }],
    });
    const text = [...out.strong, ...out.moderate, ...out.weak].map((f) => f.why).join(" ");
    expect(text.toLowerCase()).not.toContain("broker");
    expect(text.toLowerCase()).not.toContain("cold");
    expect(text.toLowerCase()).not.toContain("desperate");
  });
});

describe("formatters", () => {
  it("labels markets and business plans", () => {
    expect(marketLabel(deal())).toBe("Columbus, OH");
    expect(businessPlanLabel(deal())).toBe("Value-Add");
    expect(businessPlanLabel(deal({ value_add_potential: "Low" } as Partial<Deal>))).toBe("Core-Plus");
  });
});

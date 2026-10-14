import { describe, expect, it } from "vitest";
import {
  canonicalName, canonicalNameLoose, matchPipelineDeal,
  type MatchCandidate,
} from "../../supabase/functions/_shared/dealMatch";

const deal = (id: string, property_name: string, city?: string, state?: string): MatchCandidate =>
  ({ id, property_name, city, state });

describe("canonicalName", () => {
  it("lowercases, strips punctuation and drops a leading 'the'", () => {
    expect(canonicalName("The Reserve at Brookfield")).toBe("reserve at brookfield");
    expect(canonicalName("  RESERVE  AT   BROOKFIELD ")).toBe("reserve at brookfield");
    expect(canonicalName("Reserve-at-Brookfield")).toBe("reserve at brookfield");
  });

  it("returns null for nothing, rather than an empty string", () => {
    // An empty-string key would match every other empty-string key, which is
    // how a "no name" deal ends up declared a duplicate of another "no name".
    expect(canonicalName(null)).toBeNull();
    expect(canonicalName("   ")).toBeNull();
    expect(canonicalName("!!!")).toBeNull();
  });

  it("does not drop a generic suffix", () => {
    expect(canonicalName("Reserve at Brookfield Apartments")).toBe("reserve at brookfield apartments");
  });
});

describe("canonicalNameLoose", () => {
  it("drops one trailing generic word", () => {
    expect(canonicalNameLoose("Reserve at Brookfield Apartments")).toBe("reserve at brookfield");
    expect(canonicalNameLoose("The Reserve at Brookfield")).toBe("reserve at brookfield");
  });

  it("keeps a generic word that is the whole name", () => {
    // "Apartments" alone must not reduce to nothing and then match everything.
    expect(canonicalNameLoose("Apartments")).toBe("apartments");
  });

  it("drops only one, so 'Townhomes Apartments' keeps an identifying word", () => {
    expect(canonicalNameLoose("Brookfield Townhomes Apartments")).toBe("brookfield townhomes");
  });
});

describe("matchPipelineDeal — exact", () => {
  const pipeline = [deal("d1", "The Reserve at Brookfield", "Austin", "TX")];

  it("matches ignoring case, punctuation and a leading 'the'", () => {
    const m = matchPipelineDeal({ property_name: "Reserve At Brookfield" }, pipeline);
    expect(m?.confidence).toBe("exact");
    expect(m?.dealId).toBe("d1");
  });

  it("needs no location at all", () => {
    // Inbox deals often arrive with no city or state; requiring one would miss
    // the duplicates this exists to catch.
    const m = matchPipelineDeal({ property_name: "the reserve at brookfield" }, pipeline);
    expect(m?.confidence).toBe("exact");
  });

  it("matches even when the locations disagree", () => {
    const m = matchPipelineDeal(
      { property_name: "Reserve at Brookfield", city: "Dallas", state: "TX" },
      pipeline,
    );
    expect(m?.confidence).toBe("exact");
  });
});

describe("matchPipelineDeal — strong needs the location to corroborate", () => {
  const pipeline = [deal("d1", "The Reserve at Brookfield", "Austin", "TX")];

  it("matches a generic suffix when the state agrees", () => {
    const m = matchPipelineDeal(
      { property_name: "Reserve at Brookfield Apartments", state: "TX" },
      pipeline,
    );
    expect(m?.confidence).toBe("strong");
    expect(m?.reason).toContain("same name and location");
  });

  it("does NOT match when the state differs", () => {
    // The whole point. Suffix-stripping without a location check collapses
    // every "Parkview Apartments" in the country into one deal.
    expect(matchPipelineDeal(
      { property_name: "Reserve at Brookfield Apartments", state: "OH" },
      pipeline,
    )).toBeNull();
  });

  it("does NOT match when the state is unknown", () => {
    // Unknown is not agreement. `strong` is for the case where the name alone
    // was not enough, so an uncorroborated location has to fail it.
    expect(matchPipelineDeal(
      { property_name: "Reserve at Brookfield Apartments" },
      pipeline,
    )).toBeNull();
  });

  it("does NOT match when both cities are known and differ", () => {
    expect(matchPipelineDeal(
      { property_name: "Reserve at Brookfield Apartments", city: "Dallas", state: "TX" },
      pipeline,
    )).toBeNull();
  });

  it("matches when the state agrees and only one side has a city", () => {
    const m = matchPipelineDeal(
      { property_name: "Reserve at Brookfield Apartments", city: "Austin", state: "TX" },
      [deal("d1", "Reserve at Brookfield", undefined, "TX")],
    );
    expect(m?.confidence).toBe("strong");
  });
});

describe("matchPipelineDeal — what it refuses to match", () => {
  it("ignores a one-word name", () => {
    // "Westview" matched across a whole pipeline is a guess, not a match.
    expect(matchPipelineDeal({ property_name: "Westview" }, [deal("d1", "Westview")])).toBeNull();
  });

  it("ignores an empty or missing name on either side", () => {
    expect(matchPipelineDeal({ property_name: null }, [deal("d1", "Reserve at Brookfield")])).toBeNull();
    expect(matchPipelineDeal({ property_name: "Reserve at Brookfield" }, [
      { id: "d1", property_name: null },
      { id: "d2", property_name: "   " },
    ])).toBeNull();
  });

  it("does not match on a shared word", () => {
    // Token overlap is what the existing inbox-to-inbox matcher does at a 0.6
    // threshold. This module deliberately does not.
    expect(matchPipelineDeal(
      { property_name: "Reserve at Brookfield", state: "TX" },
      [deal("d1", "Reserve at Southpark", "Austin", "TX")],
    )).toBeNull();
  });

  it("returns null against an empty pipeline", () => {
    expect(matchPipelineDeal({ property_name: "Reserve at Brookfield" }, [])).toBeNull();
  });
});

describe("matchPipelineDeal — precedence", () => {
  it("prefers an exact match over a strong one, whatever the order", () => {
    const candidates = [
      deal("loose", "Reserve at Brookfield Apartments", "Austin", "TX"),
      deal("exact", "Reserve at Brookfield", "Austin", "TX"),
    ];
    const m = matchPipelineDeal(
      { property_name: "Reserve at Brookfield", city: "Austin", state: "TX" },
      candidates,
    );
    expect(m?.dealId).toBe("exact");
    expect(m?.confidence).toBe("exact");
  });

  it("names the matched deal in the reason, so a hidden row explains itself", () => {
    const m = matchPipelineDeal({ property_name: "Reserve at Brookfield" }, [
      deal("d1", "The Reserve at Brookfield", "Austin", "TX"),
    ]);
    expect(m?.reason).toContain("The Reserve at Brookfield");
  });
});

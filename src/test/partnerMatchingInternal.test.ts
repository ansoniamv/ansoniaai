import { describe, expect, it } from "vitest";
import {
  rankPartnerMatches,
  defaultDealStrategies,
  type MatchableDeal,
  type MatchablePartner,
} from "@/lib/partnerMatching";

/**
 * An internal (Ansonia) record is not an outside capital source, so it must
 * never surface as a match candidate for a deal — not in `matches`, and not in
 * `gated` or `belowThreshold` either, both of which are shown in the UI with a
 * count. It has to be dropped before scoring, not disqualified by a gate.
 */

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

const deal: MatchableDeal = {
  state: "OH",
  city: "Columbus",
  msa: "Columbus, OH",
  estimated_equity: 18,
};

const strategies = defaultDealStrategies({ value_add_potential: "High", affordable: false });

const rank = (partners: MatchablePartner[]) =>
  rankPartnerMatches(deal, partners, "", strategies);

/** Every bucket rankPartnerMatches can put a partner in. */
const allReturned = (r: ReturnType<typeof rank>) =>
  [...r.matches, ...r.gated, ...r.belowThreshold].map((m) => m.partner.id);

describe("rankPartnerMatches — internal partners", () => {
  it("excludes an internal partner that would otherwise match well", () => {
    const external = partner({ id: "external", name: "Grandview Partners" });
    const internal = partner({ id: "internal", name: "Ansonia Properties", is_internal: true });

    const ranked = rank([external, internal]);

    expect(allReturned(ranked)).toEqual(["external"]);
  });

  it("still ranks the same external partner identically when no internal record is present", () => {
    const external = partner({ id: "external" });

    const withInternal = rank([external, partner({ id: "internal", is_internal: true })]);
    const withoutInternal = rank([external]);

    expect(withInternal.matches).toEqual(withoutInternal.matches);
  });

  it("returns nothing at all when every candidate is internal", () => {
    const ranked = rank([
      partner({ id: "i1", is_internal: true }),
      partner({ id: "i2", is_internal: true }),
    ]);

    expect(allReturned(ranked)).toEqual([]);
  });

  it("does not hide an internal partner in the gated bucket", () => {
    // geography_avoid is a hard gate. Without the internal filter this partner
    // would land in `gated`, which the UI surfaces with a count — so asserting
    // on `matches` alone would not catch the leak.
    const internal = partner({
      id: "internal",
      is_internal: true,
      geography_avoid: ["Ohio"],
    });

    expect(rank([internal]).gated).toEqual([]);
  });

  it("treats a missing or explicitly false is_internal as external", () => {
    // Existing partner rows predate the column; `undefined` must not be read as
    // internal or every legacy partner would vanish from matching.
    const legacy = partner({ id: "legacy" });
    const explicitlyExternal = partner({ id: "explicit", is_internal: false });
    const nulled = partner({ id: "nulled", is_internal: null });

    const ids = allReturned(rank([legacy, explicitlyExternal, nulled])).sort();

    expect(ids).toEqual(["explicit", "legacy", "nulled"]);
  });
});

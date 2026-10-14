import { describe, it, expect } from "vitest";
import {
  capTier,
  capNote,
  evaluateBuyBox,
  inboxBuyBoxDeal,
} from "../../supabase/functions/_shared/buyBoxRules";

// A deal that meets every rule the inbox can evaluate.
const clean = {
  units: 220,
  year_built: 1998,
  asset_class: "Multifamily",
  strategy: "Value-Add",
  location_city: "Plano",
  location_state: "TX",
  msa: "Dallas-Fort Worth-Arlington",
};

const tierFor = (score: "strong" | "medium" | "maybe" | "skip", deal: Record<string, unknown>) =>
  capTier(score, evaluateBuyBox(inboxBuyBoxDeal(deal)));

const location = (deal: Record<string, unknown>) =>
  evaluateBuyBox(inboxBuyBoxDeal(deal)).find((f) => f.rule === "Location");

describe("location against the target markets", () => {
  it("passes each target MSA in its own state", () => {
    for (const [msa, st] of [
      ["Chicago-Naperville-Elgin", "IL"],
      ["Columbus", "OH"],
      ["Madison", "WI"],
      ["Austin-Round Rock-San Marcos", "TX"],
      ["Dallas-Fort Worth-Arlington", "TX"],
      ["Denver-Aurora-Centennial", "CO"],
      ["Salt Lake City", "UT"],
    ]) {
      expect(location({ msa, location_state: st })?.verdict, msa).toBe("pass");
    }
  });

  it("passes the Carolinas statewide", () => {
    expect(location({ location_city: "Greenville", location_state: "SC" })?.verdict).toBe("pass");
    expect(location({ location_state: "NC" })?.verdict).toBe("pass");
  });

  it("does not let a same-named city in another state through", () => {
    // These read as target markets on name alone.
    for (const [msa, st] of [["Columbus", "GA"], ["Madison", "AL"], ["Arlington", "VA"], ["Aurora", "MO"]]) {
      const f = location({ msa, location_state: st });
      expect(f?.verdict, `${msa}, ${st}`).toBe("yellow");
      expect(f?.code).toBe("outside_market");
    }
  });

  it("matches on city when msa is missing", () => {
    expect(location({ location_city: "Dallas", location_state: "TX" })?.verdict).toBe("pass");
  });

  it("marks Kansas City, Atlanta and non-Salt-Lake Utah as outside or unconfirmed", () => {
    expect(location({ msa: "Kansas City", location_state: "MO" })?.code).toBe("outside_market");
    expect(location({ msa: "Kansas City", location_state: "KS" })?.code).toBe("outside_market");
    expect(location({ msa: "Atlanta-Sandy Springs-Roswell", location_state: "GA" })?.code).toBe("outside_market");
    expect(location({ msa: "Provo-Orem", location_state: "UT" })?.code).toBe("outside_market");
    // Target state, no msa and an unrecognised city: could be a suburb, so not confirmed rather than out.
    expect(location({ location_city: "Lehi", location_state: "UT" })?.code).toBe("market_unconfirmed");
  });

  it("reports no-data when there is no location at all", () => {
    expect(location({})?.verdict).toBe("no-data");
  });
});

describe("capTier", () => {
  it("leaves a deal that meets the buybox alone", () => {
    expect(tierFor("strong", clean)).toEqual({ tier: "strong", capped: false, reasons: [] });
  });

  it("drops an out-of-market deal to Maybe, never filters it", () => {
    const r = tierFor("strong", { ...clean, location_city: "Overland Park", location_state: "KS", msa: "Kansas City" });
    expect(r.tier).toBe("maybe");
    expect(r.capped).toBe(true);
    expect(r.reasons[0]).toMatch(/outside target markets/);
  });

  it("caps a target state with an unconfirmed market at Medium", () => {
    expect(tierFor("strong", { ...clean, location_city: "Lehi", location_state: "UT", msa: null }).tier).toBe("medium");
  });

  it("sends non-multifamily and development to Skip", () => {
    expect(tierFor("strong", { ...clean, asset_class: "Office" }).tier).toBe("skip");
    expect(tierFor("medium", { ...clean, strategy: "Development" }).tier).toBe("skip");
  });

  it("caps other red flags at Maybe", () => {
    expect(tierFor("strong", { ...clean, units: 80 }).tier).toBe("maybe");
    expect(tierFor("strong", { ...clean, year_built: 1972 }).tier).toBe("maybe");
  });

  it("caps yellow flags at Medium", () => {
    expect(tierFor("strong", { ...clean, units: 120 }).tier).toBe("medium");
    expect(tierFor("strong", { ...clean, year_built: 1985 }).tier).toBe("medium");
    expect(tierFor("strong", { ...clean, strategy: "Core-Plus" }).tier).toBe("medium");
  });

  it("never raises a tier", () => {
    expect(tierFor("skip", clean).tier).toBe("skip");
    expect(tierFor("maybe", { ...clean, units: 120 })).toEqual({ tier: "maybe", capped: false, reasons: [] });
  });

  it("does not cap on missing data", () => {
    expect(tierFor("strong", { units: null, year_built: null, asset_class: null, strategy: null, msa: "Denver", location_state: "CO" }).tier)
      .toBe("strong");
  });

  it("keeps an unscored deal unscored", () => {
    expect(capTier(null, evaluateBuyBox(inboxBuyBoxDeal({ ...clean, asset_class: "Office" }))).tier).toBeNull();
  });

  it("lists every reason at the binding level, and only those", () => {
    const r = tierFor("strong", { ...clean, units: 80, year_built: 1985, msa: "Kansas City", location_state: "MO" });
    expect(r.tier).toBe("maybe");
    expect(r.reasons).toHaveLength(2); // under-100 units + outside market; the 1980s yellow is not the reason
    expect(capNote("maybe", r.reasons)).toMatch(/^Buybox → Maybe: .*under 100.*outside target markets\.$/);
  });
});

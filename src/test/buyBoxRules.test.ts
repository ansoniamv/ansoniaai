import { describe, it, expect } from "vitest";
import {
  applyBuyBox,
  buyBoxCeiling,
  buyBoxNote,
  evaluateBuyBox,
  inboxBuyBoxDeal,
  TIER_CEILING,
} from "../../supabase/functions/_shared/buyBoxRules";
import { tierFromScore } from "../../supabase/functions/_shared/dealScoreEngine";

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

const flagsFor = (deal: Record<string, unknown>) => evaluateBuyBox(inboxBuyBoxDeal(deal));
const rule = (deal: Record<string, unknown>, name: string) => flagsFor(deal).find((f) => f.rule === name);
const location = (deal: Record<string, unknown>) => rule(deal, "Location");
const boxed = (raw: number | null, deal: Record<string, unknown>) => applyBuyBox(raw, flagsFor(deal));

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

  it("passes the suburbs around each MSA on city alone", () => {
    for (const [city, st] of [
      ["Schaumburg", "IL"], ["Crown Point", "IN"], ["Kenosha", "WI"], ["Westerville", "OH"],
      ["Sun Prairie", "WI"], ["Pflugerville", "TX"], ["Frisco", "TX"], ["Lakewood", "CO"],
      ["South Jordan", "UT"], ["Elgin", "TX"],
    ]) {
      expect(location({ location_city: city, location_state: st })?.verdict, `${city}, ${st}`).toBe("pass");
    }
  });

  it("passes the Carolinas statewide", () => {
    expect(location({ location_city: "Greenville", location_state: "SC" })?.verdict).toBe("pass");
    expect(location({ location_state: "NC" })?.verdict).toBe("pass");
    expect(location({ location_state: "North Carolina" })?.verdict).toBe("pass");
  });

  it("puts Georgia, Kentucky and Missouri outside the box", () => {
    for (const [city, st] of [["Atlanta", "GA"], ["Louisville", "KY"], ["Lexington", "KY"], ["St. Louis", "MO"], ["Kansas City", "MO"]]) {
      expect(location({ location_city: city, location_state: st })?.code, `${city}, ${st}`).toBe("outside_market");
    }
    expect(location({ location_state: "Georgia" })?.code).toBe("outside_market");
  });

  it("does not let a same-named city in another state through", () => {
    for (const [msa, st] of [["Columbus", "GA"], ["Madison", "AL"], ["Arlington", "VA"], ["Aurora", "MO"], ["Lake Geneva", "WI"]]) {
      expect(location({ msa, location_state: st })?.code, `${msa}, ${st}`).toBe("outside_market");
    }
  });

  it("treats a non-target city in a target state as outside, not unconfirmed", () => {
    for (const [city, st] of [["Houston", "TX"], ["San Antonio", "TX"], ["Milwaukee", "WI"], ["Peoria", "IL"], ["Cincinnati", "OH"], ["Provo", "UT"], ["Colorado Springs", "CO"]]) {
      expect(location({ location_city: city, location_state: st })?.code, `${city}, ${st}`).toBe("outside_market");
    }
  });

  it("reads the state off the msa when the state field is empty", () => {
    expect(location({ msa: "Dallas-Fort Worth-Arlington, TX" })?.verdict).toBe("pass");
    expect(location({ msa: "Atlanta-Sandy Springs-Roswell, GA" })?.code).toBe("outside_market");
  });

  it("calls a target-sounding place with no state unconfirmed, and anything else outside", () => {
    expect(location({ location_city: "Columbus" })?.code).toBe("market_unconfirmed");
    expect(location({ location_state: "TX" })?.code).toBe("market_unconfirmed");
    expect(location({ location_city: "Atlanta" })?.code).toBe("outside_market");
  });

  it("reports no-data when there is no location at all", () => {
    expect(location({})?.verdict).toBe("no-data");
  });
});

describe("asset type and always-avoid", () => {
  it("passes multifamily, yellows mixed-use, and reds everything else", () => {
    expect(rule(clean, "Asset type")?.verdict).toBe("pass");
    expect(rule({ ...clean, asset_class: "Mixed-Use" }, "Asset type")?.verdict).toBe("yellow");
    for (const ac of ["Office", "Retail", "Industrial", "Hospitality", "Self-Storage", "Other"]) {
      expect(rule({ ...clean, asset_class: ac }, "Asset type")?.verdict, ac).toBe("red");
    }
  });

  it("reds development, land and net lease wherever they appear", () => {
    expect(rule({ ...clean, strategy: "Development" }, "Always avoid")?.verdict).toBe("red");
    expect(rule({ ...clean, email_thread_summary: "Entitled land parcel for 300 units" }, "Always avoid")?.verdict).toBe("red");
    expect(rule({ ...clean, email_subject: "Single-tenant NNN offering" }, "Always avoid")?.verdict).toBe("red");
    expect(rule(clean, "Always avoid")).toBeUndefined();
  });
});

describe("building class, affordability, vintage, profile", () => {
  it("prefers Class B and caveats unimproved A and distressed C", () => {
    const cls = (summary: string, strategy = "Core") =>
      rule({ ...clean, strategy, email_thread_summary: summary }, "Building class")?.verdict;
    expect(cls("Class B garden community")).toBe("pass");
    expect(cls("Class A asset, stabilised")).toBe("yellow");
    expect(cls("Class A asset", "Value-Add")).toBe("pass");
    expect(cls("Class C property with significant deferred maintenance")).toBe("yellow");
    expect(cls("Class C property")).toBe("pass");
    expect(cls("world class amenities")).toBe("no-data");
  });

  it("flags any affordability component green", () => {
    for (const s of ["LIHTC compliance period expires 2027", "project-based Section 8 HAP contract", "60% AMI restricted units"]) {
      expect(rule({ ...clean, email_thread_summary: s }, "Affordable")?.verdict, s).toBe("green");
    }
    expect(rule(clean, "Affordable")).toBeUndefined();
  });

  it("applies the vintage band to garden-style and exempts mid/high-rise", () => {
    expect(rule({ ...clean, year_built: 1972 }, "Vintage")?.verdict).toBe("red");
    expect(rule({ ...clean, year_built: 1985 }, "Vintage")?.verdict).toBe("yellow");
    expect(rule({ ...clean, year_built: 1972, email_thread_summary: "22-story high-rise downtown" }, "Vintage")?.verdict).toBe("pass");
  });

  it("caveats core-plus and a renovated-out deal", () => {
    expect(rule({ ...clean, strategy: "Core-Plus" }, "Investment profile")?.verdict).toBe("yellow");
    expect(rule({ ...clean, email_thread_summary: "70% of units have been renovated" }, "Renovation upside")?.verdict).toBe("yellow");
    expect(rule({ ...clean, email_thread_summary: "65% of units remain classic" }, "Renovation upside")?.verdict).toBe("pass");
    expect(rule(clean, "Renovation upside")?.verdict).toBe("no-data");
  });
});

describe("applyBuyBox", () => {
  it("leaves a deal that meets the buybox alone", () => {
    expect(boxed(92, clean)).toMatchObject({ score: 92, tier: "strong", adjusted: false });
  });

  it("never lets an out-of-market deal read as a 100", () => {
    for (const [city, st] of [["Atlanta", "GA"], ["Louisville", "KY"], ["St. Louis", "MO"]]) {
      const r = boxed(100, { ...clean, location_city: city, location_state: st, msa: null });
      expect(r.score, city).toBeLessThanOrEqual(TIER_CEILING.maybe);
      expect(r.tier, city).toBe("maybe");
      expect(r.adjusted).toBe(true);
      expect(buyBoxNote(r)).toMatch(/^Buybox → Maybe \(\d+\): .*outside target markets\.$/);
    }
  });

  it("de-prioritises out-of-market deals but never screens them out", () => {
    const r = boxed(100, { ...clean, units: 80, year_built: 1970, location_city: "Atlanta", location_state: "GA", msa: null });
    expect(r.tier).toBe("maybe");
    expect(r.score).toBe(35);
  });

  it("ranks within a bucket by the number of misses", () => {
    const one = boxed(100, { ...clean, location_city: "Atlanta", location_state: "GA", msa: null });
    const three = boxed(100, { ...clean, units: 120, year_built: 1985, location_city: "Atlanta", location_state: "GA", msa: null });
    expect(one.score!).toBeGreaterThan(three.score!);
  });

  it("caps yellows at Medium and other reds at Maybe", () => {
    expect(boxed(100, { ...clean, units: 120 })).toMatchObject({ tier: "medium", score: 69 });
    expect(boxed(100, { ...clean, strategy: "Core-Plus" }).tier).toBe("medium");
    expect(boxed(100, { ...clean, units: 80 })).toMatchObject({ tier: "maybe", score: 44 });
    expect(boxed(100, { ...clean, year_built: 1972 }).tier).toBe("maybe");
  });

  it("sends non-multifamily and development to Skip", () => {
    expect(boxed(100, { ...clean, asset_class: "Office" }).tier).toBe("skip");
    expect(boxed(80, { ...clean, strategy: "Development" }).tier).toBe("skip");
  });

  it("will not call a deal Strong without a confirmed market and unit count", () => {
    expect(boxed(100, { ...clean, units: null }).tier).toBe("medium");
    expect(boxed(100, { ...clean, location_city: null, location_state: null, msa: null }).tier).toBe("medium");
    // Other missing fields are not evidence against the deal.
    expect(boxed(100, { ...clean, year_built: null, strategy: null }).tier).toBe("strong");
  });

  it("lifts an affordable deal within its cap", () => {
    expect(boxed(80, { ...clean, email_thread_summary: "LIHTC, expiring 2027" }).score).toBe(85);
    expect(boxed(100, { ...clean, units: 120, email_thread_summary: "LIHTC" }).score).toBe(TIER_CEILING.medium);
  });

  it("never raises a low pillar score past what it earned", () => {
    expect(boxed(30, clean)).toMatchObject({ score: 30, tier: "skip", adjusted: false });
    expect(boxed(30, { ...clean, location_city: "Atlanta", location_state: "GA", msa: null })).toMatchObject({ score: 30, tier: "skip" });
  });

  it("keeps an unscored deal unscored", () => {
    expect(boxed(null, { ...clean, asset_class: "Office" })).toMatchObject({ score: null, tier: null });
  });

  it("reports every reason at the binding level, and only those", () => {
    const { ceiling, reasons } = buyBoxCeiling(flagsFor({ ...clean, units: 80, year_built: 1985, msa: "Kansas City", location_city: null, location_state: "MO" }));
    expect(ceiling).toBe("maybe");
    expect(reasons).toHaveLength(2); // under-100 units + outside market; the 1980s yellow is not the reason
  });

  it("agrees with the engine's tier thresholds", () => {
    for (const s of [0, 34, 35, 54, 55, 74, 75, 100]) {
      expect(boxed(s, clean).tier, String(s)).toBe(tierFromScore(s));
    }
  });
});

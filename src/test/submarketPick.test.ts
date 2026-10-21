import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  candidatesFor,
  dealState,
  interpretPick,
  shouldAssign,
  type SubmarketRow,
} from "../../supabase/functions/_shared/submarketPick";

const row = (code: string, name: string): SubmarketRow => {
  // Same split the view does: 'Atlanta - GA USA - Barrow County'
  const [city, st, ...rest] = name.split(" - ");
  return {
    geography_code: code,
    geography_name: name,
    market_name: `${city} - ${st}`,
    submarket_name: rest.join(" - "),
    state: st.replace(" USA", ""),
  };
};

const ALL = [
  row("APT-1-1", "Atlanta - GA USA - Barrow County"),
  row("APT-1-2", "Atlanta - GA USA - Decatur"),
  row("APT-1-3", "Dallas-Fort Worth - TX USA - Uptown/Oak Lawn"),
  row("APT-1-4", "Austin - TX USA - East Austin"),
  row("APT-1-5", "Kansas City - MO USA - Wyandotte County"),
  row("APT-1-6", "Kansas City - MO USA - Downtown"),
  row("APT-1-7", "Wichita - KS USA - East Wichita"),
];

describe("dealState", () => {
  it("reads a code, a full name, or the tail of the msa", () => {
    expect(dealState({ state: "tx" })).toBe("TX");
    expect(dealState({ state: "Georgia" })).toBe("GA");
    expect(dealState({ state: null, msa: "Dallas-Fort Worth-Arlington, TX" })).toBe("TX");
    expect(dealState({ state: "Narnia" })).toBeNull();
  });
});

describe("candidatesFor", () => {
  it("keeps only the deal's state", () => {
    const codes = candidatesFor({ city: "Austin", state: "TX" }, ALL).map((r) => r.geography_code);
    expect(codes).toEqual(["APT-1-3", "APT-1-4"]);
  });

  it("includes a cross-state metro filed under its principal state", () => {
    // Kansas City, KS sits in the "Kansas City - MO USA" market.
    const codes = candidatesFor({ city: "Kansas City", state: "KS" }, ALL).map((r) => r.geography_code);
    expect(codes).toEqual(["APT-1-5", "APT-1-6", "APT-1-7"]);
  });

  it("returns nothing when there is no location to narrow by", () => {
    expect(candidatesFor({ property_name: "The Oaks" }, ALL)).toEqual([]);
  });
});

describe("interpretPick", () => {
  const offered = candidatesFor({ state: "GA" }, ALL);

  it("accepts a code that was offered", () => {
    const pick = interpretPick({ geography_code: "APT-1-2", confidence: "high", reason: "Decatur city limits." }, offered);
    expect(pick).toEqual({ code: "APT-1-2", confidence: "high", reason: "Decatur city limits." });
    expect(shouldAssign(pick)).toBe(true);
  });

  it("refuses a well-formed code that was never offered", () => {
    const pick = interpretPick({ geography_code: "APT-1-4", confidence: "high", reason: "x" }, offered);
    expect(pick.code).toBeNull();
    expect(shouldAssign(pick)).toBe(false);
    expect(pick.reason).toMatch(/not on the list/);
  });

  it("treats NONE, low confidence and garbage as no assignment", () => {
    expect(shouldAssign(interpretPick({ geography_code: "NONE", confidence: "low", reason: "vague" }, offered))).toBe(false);
    expect(shouldAssign(interpretPick({ geography_code: "APT-1-1", confidence: "low", reason: "guess" }, offered))).toBe(false);
    expect(shouldAssign(interpretPick(null, offered))).toBe(false);
    expect(shouldAssign(interpretPick({ geography_code: "APT-1-1", confidence: "certain" }, offered))).toBe(false);
  });
});

describe("buildPrompt", () => {
  it("lists every candidate and only the facts that are present", () => {
    const p = buildPrompt({ property_name: "Oak Lawn Flats", city: "Dallas", state: "TX", zip: "75219" }, [ALL[2]]);
    expect(p).toContain("APT-1-3 | Dallas-Fort Worth - TX USA | Uptown/Oak Lawn");
    expect(p).toContain("ZIP: 75219");
    expect(p).not.toContain("Coordinates");
  });
});

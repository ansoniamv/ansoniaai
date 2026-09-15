import { describe, it, expect } from "vitest";
import {
  buildAddressQuery,
  hasStreetAddress,
  scoreCandidate,
  pickBestMatch,
} from "../../supabase/functions/_shared/hellodataClient";

describe("buildAddressQuery — refuses to guess", () => {
  it("refuses a city-only deal (the 82/82 case)", () => {
    const r = buildAddressQuery({ city: "Columbus", state: "OH", zip: "43026", address: null, property_address: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/city-level search cannot identify a building/);
  });

  it("refuses to trust property_address on an already-enriched deal (circular)", () => {
    const r = buildAddressQuery({ hellodata_status: "fetched", property_address: "123 Main St, Columbus, OH", city: "Columbus" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/came from HelloData/);
  });

  it("accepts property_address on an un-enriched deal", () => {
    const r = buildAddressQuery({ hellodata_status: "pending", property_address: "4400 Main St", city: "Dallas", state: "TX" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.query).toContain("4400 Main St");
  });

  it("knows a street address from a city", () => {
    expect(hasStreetAddress("123 Main St")).toBe(true);
    expect(hasStreetAddress("Columbus, OH 43026")).toBe(false);
    expect(hasStreetAddress("")).toBe(false);
  });
});

describe("scoreCandidate — the observed mismatches must fail", () => {
  it("rejects One Superior 809 units vs a 4-unit record", () => {
    const e = scoreCandidate(
      { property_name: "One Superior", unit_count: 809 },
      { building_name: "23 West Chicago Ave.", number_units: 4, is_single_family: true },
    );
    expect(e.accepted).toBe(false);
  });

  it("rejects Hilliard 656 vs 123 matched to an extended-stay hotel", () => {
    const e = scoreCandidate(
      { property_name: "Hilliard Station Apartments", unit_count: 656 },
      { building_name: "Furnished Studio - Columbus", number_units: 123 },
    );
    expect(e.accepted).toBe(false);
  });

  it("hard-fails on a zip contradiction", () => {
    const e = scoreCandidate({ zip: "42340", property_name: "Northpark Place" }, { zip_code: "43231", building_name: "Northpark Place" });
    expect(e.accepted).toBe(false);
    expect(e.reason).toMatch(/zip mismatch/);
  });

  it("accepts Whitestone Crossing despite is_single_family (name + units agree)", () => {
    const e = scoreCandidate(
      { property_name: "Whitestone Crossing", unit_count: 120, zip: "78758" },
      { building_name: "Whitestone Crossing", number_units: 120, zip_code: "78758", is_single_family: true },
    );
    expect(e.accepted).toBe(true);
  });

  it("does not accept on too few comparable signals", () => {
    const e = scoreCandidate({ property_name: "Some Deal" }, { building_name: "Some Deal" });
    expect(e.accepted).toBe(false);
    expect(e.reason).toMatch(/too few comparable signals/);
  });
});

describe("pickBestMatch", () => {
  it("returns null rather than the best of a bad bunch", () => {
    const { candidate, evidence } = pickBestMatch(
      { property_name: "Allston Pointe", unit_count: 96, zip: "43026" },
      [{ building_name: "Furnished Studio - Columbus", number_units: 97, zip_code: "43026" }],
    );
    expect(candidate).toBeNull();
    expect(evidence.accepted).toBe(false);
  });
});

describe("stored hellodata_id still goes through the gate", () => {
  // Regression: the gate originally ran only inside `if (!hdId)`, so a deal that
  // already had an id refetched ungated. The Station at MacArthur was enriched
  // that way AFTER the gate deployed. fetch-hellodata now scores the fetched
  // payload on every path — cached, stored-id and freshly-searched.
  it("rejects a stored-id payload that describes a different building", () => {
    const deal = { property_name: "One Superior", unit_count: 809, zip: "60654", hellodata_id: "stale-id-pointing-elsewhere" };
    const storedIdPayload = { building_name: "23 West Chicago Ave.", number_units: 4, is_single_family: true };
    const v = scoreCandidate(deal, storedIdPayload);
    expect(v.accepted).toBe(false);
  });

  it("accepts a stored-id payload that genuinely matches", () => {
    // The Station at MacArthur, real production values: 100% confidence.
    const v = scoreCandidate(
      { property_name: "The Station at MacArthur", unit_count: 444, zip: "75038", hellodata_id: "known-good" },
      { building_name: "The Station at MacArthur", street_address: "1100 Hidden Ridge Drive", zip_code: "75038", number_units: 444, is_apartment: true },
    );
    expect(v.accepted).toBe(true);
    expect(v.confidence).toBe(100);
  });
});

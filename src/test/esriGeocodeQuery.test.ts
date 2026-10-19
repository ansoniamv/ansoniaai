import { describe, it, expect } from "vitest";
import {
  buildGeocodeQuery,
  candidateInDealState,
  hasStreet,
  normalizeState,
} from "../../supabase/functions/_shared/esriMatch";

describe("buildGeocodeQuery", () => {
  it("always carries city and state (the 1251 South Michigan case)", () => {
    const r = buildGeocodeQuery({ address: "1251 South Michigan", property_address: null, city: "Chicago", state: "IL", zip: null });
    expect(r).toEqual({ ok: true, query: "1251 South Michigan, Chicago, IL" });
  });

  it("prefers the human address over property_address", () => {
    const r = buildGeocodeQuery({ address: "1251 S Michigan Ave", property_address: "55 E 13th St", city: "Chicago", state: "IL", zip: "60605" });
    expect(r.ok && r.query).toBe("1251 S Michigan Ave, Chicago, IL, 60605");
  });

  it("never geocodes the property name", () => {
    const r = buildGeocodeQuery({ address: "Sky55 & Lofts", property_address: "Chicago, IL", city: "Chicago", state: "IL" });
    expect(r.ok).toBe(false);
  });

  it("refuses without city and state rather than geocoding a bare street", () => {
    expect(buildGeocodeQuery({ address: "1251 South Michigan", city: null, state: null }).ok).toBe(false);
  });
});

describe("hasStreet", () => {
  it("accepts a one-letter directional", () => {
    expect(hasStreet("1251 S Michigan Ave")).toBe(true);
    expect(hasStreet("555 Elm St")).toBe(true);
  });
  it("rejects names and city lines", () => {
    expect(hasStreet("Sky55 & 1251 S Michigan")).toBe(false);
    expect(hasStreet("Columbus, OH")).toBe(false);
  });
});

describe("candidateInDealState", () => {
  it("rejects the Columbiaville, MI match for an IL deal", () => {
    expect(candidateInDealState("MI", "IL")).toBe(false);
  });
  it("accepts abbreviations and full names alike", () => {
    expect(candidateInDealState("IL", "Illinois")).toBe(true);
    expect(candidateInDealState("il", "IL")).toBe(true);
  });
  it("treats an unknown region as a mismatch, not a pass", () => {
    expect(candidateInDealState(null, "IL")).toBe(false);
    expect(candidateInDealState("IL", "Ill.")).toBe(false);
    expect(normalizeState("XX")).toBeNull();
  });
});

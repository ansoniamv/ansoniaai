import { describe, it, expect } from "vitest";
import { isAddressLevel } from "../../supabase/functions/_shared/esriMatch";

/**
 * The Addr_type values and scores below are not invented — each was returned by
 * a live findAddressCandidates call against the World GeocodeServer while
 * diagnosing why deals were landing on city centroids and in London.
 */
describe("isAddressLevel", () => {
  it("accepts the three address-level types", () => {
    expect(isAddressLevel("PointAddress")).toBe(true);
    expect(isAddressLevel("StreetAddress")).toBe(true);
    expect(isAddressLevel("Subaddress")).toBe(true);
  });

  it("rejects a city centroid, which is how four Chicago deals shared one point", () => {
    // "Chicago, IL" -> Addr_type=Locality, score 100.
    expect(isAddressLevel("Locality")).toBe(false);
  });

  it("rejects a postcode centroid", () => {
    // "60614" -> Addr_type=Postal, score 100.
    expect(isAddressLevel("Postal")).toBe(false);
  });

  it("rejects a street without a number", () => {
    // "The Grove At Schaumburg" -> Addr_type=StreetName, score 95.59, and the
    // stored point was 2.2 miles from the real address.
    expect(isAddressLevel("StreetName")).toBe(false);
  });

  it("rejects a point of interest, which is how K Square landed in London", () => {
    // "K Square" with no countryCode -> Addr_type=POI, score 100, at
    // 51.4762/-0.2145. A Chicago deal stored in south-west London.
    expect(isAddressLevel("POI")).toBe(false);
  });

  it("rejects an absent type rather than assuming it is fine", () => {
    expect(isAddressLevel(null)).toBe(false);
    expect(isAddressLevel(undefined)).toBe(false);
    expect(isAddressLevel("")).toBe(false);
  });

  it("is why score alone cannot be the gate", () => {
    // Every rejected type above scored at or above the 85 confidence threshold.
    // If score were the only check, all of them would have passed.
    const scoredAboveThreshold = ["Locality", "Postal", "StreetName", "POI"];
    for (const t of scoredAboveThreshold) {
      expect(isAddressLevel(t), `${t} must be rejected on type despite a passing score`).toBe(false);
    }
  });
});

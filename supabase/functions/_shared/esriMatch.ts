// Whether an Esri geocode result identifies a property or merely an area.
//
// Pure, so it can be unit tested — esri-enrich itself imports Deno https:// URLs
// and cannot be loaded by Vitest.
//
// Addr_type values verified against live findAddressCandidates responses while
// diagnosing why deals were landing on city centroids and in London:
//
//   1600 Pennsylvania Ave NW   -> PointAddress  score 100
//   5501 New Albany Rd E       -> PointAddress  score 100
//   The Grove At Schaumburg    -> StreetName    score 95.59
//   Chicago, IL                -> Locality      score 100
//   60614                      -> Postal        score 100
//   K Square (no countryCode)  -> POI           score 100   (in London)
//
// The scores are the whole point. Every bad match above scores at or above the
// 85 confidence threshold, so score can never separate a rooftop from a city
// centre. Four unrelated Chicago deals ended up on 41.88323/-87.63240 — the
// Locality centroid — each with a passing score. Only the type tells them apart.

const ADDRESS_LEVEL_TYPES = new Set(["PointAddress", "StreetAddress", "Subaddress"]);

/** True only for a result that identifies an actual property. */
export function isAddressLevel(addrType: string | null | undefined): boolean {
  return !!addrType && ADDRESS_LEVEL_TYPES.has(addrType);
}

/** The country restriction for findAddressCandidates. Documented parameter name. */
export const GEOCODE_COUNTRY = "USA";

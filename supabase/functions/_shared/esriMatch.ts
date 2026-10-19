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

// ---------------------------------------------------------------------------
// The geocode query, built from the deal row — never from the client.
//
// esri-enrich used to geocode whatever string the browser sent. For the
// 1251 South Michigan deal (Chicago, IL) that string was the property name,
// "Sky55 & 1251 S Michigan", with no city or state. Esri read "Michigan" as the
// state and returned "1251 S Lk, Columbiaville, Michigan" — a StreetAddress, so
// the address-level gate above passed it. Only the state tells it apart.
// ---------------------------------------------------------------------------

export type GeocodeDeal = {
  address?: string | null;
  property_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export type GeocodeQuery = { ok: true; query: string } | { ok: false; reason: string };

/**
 * A house number, then a street name of 2+ letters somewhere after it.
 * hellodataClient's hasStreetAddress needs the name directly after the number,
 * so it rejects "1251 S Michigan Ave" — a one-letter directional breaks it.
 */
export function hasStreet(s: unknown): boolean {
  return /^\s*\d+[A-Za-z]?\s+(?:\S+\s+)*[A-Za-z]{2,}/.test(String(s ?? ""));
}

/**
 * deals.address (human-entered) wins over property_address (HelloData-written).
 * The property name is never used. A street is required: without one the best
 * Esri can return is a Locality, which isAddressLevel rejects — a paid miss.
 */
export function buildGeocodeQuery(deal: GeocodeDeal): GeocodeQuery {
  const city = deal.city?.trim() || null;
  const state = deal.state?.trim() || null;
  if (!city || !state) {
    return { ok: false, reason: "Deal needs a city and state before it can be geocoded." };
  }
  const street = [deal.address, deal.property_address].find((s) => hasStreet(s))?.trim();
  if (!street) {
    return { ok: false, reason: "No street address on this deal. Add one before geocoding." };
  }
  return { ok: true, query: [street, city, state, deal.zip?.trim() || null].filter(Boolean).join(", ") };
}

const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "puerto rico": "PR",
};

/** "IL", "il", "Illinois" → "IL"; anything unrecognised → null. */
export function normalizeState(s: unknown): string | null {
  const v = String(s ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v.length === 2) {
    const up = v.toUpperCase();
    return Object.values(STATE_ABBR).includes(up) ? up : null;
  }
  return STATE_ABBR[v] ?? null;
}

/**
 * True only when both states are recognised and equal. An unrecognised value
 * on either side is a mismatch, not a pass — we cannot confirm the location.
 */
export function candidateInDealState(candidateRegion: unknown, dealState: unknown): boolean {
  const a = normalizeState(candidateRegion);
  const b = normalizeState(dealState);
  return a !== null && a === b;
}

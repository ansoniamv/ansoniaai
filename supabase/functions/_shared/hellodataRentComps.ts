/**
 * Rent vs market, from HelloData only.
 *
 * Both sides are HelloData listings, so they are the same kind of number:
 *   - the property: the rents on its own listed units (building_availability),
 *   - the market: the rents on the listed units of its 5 closest HelloData
 *     comps (POST /property/comparables, then /property/{id} for each).
 * Neither side ever comes from a rent roll, OM or Census figure. A broker's
 * in-place rent is tenant-paid and a listing is an asking rent; comparing one to
 * the other measures the gap between the two kinds of number, not the deal.
 *
 * Bedrooms are compared like for like: a property that is all 1-beds is not
 * "below market" just because its comps have 3-beds. Each bedroom count is
 * weighted by how many of the property's own listings have it, and only counts
 * both sides have are used.
 *
 * Pure: the IO is in the hellodata-rent-comps function.
 */

export type BedRents = Record<string, { avg: number; n: number }>;

export type CompRents = {
  id: string;
  name: string | null;
  address: string | null;
  distance_miles: number | null;
  similarity: number | null;
  number_units: number | null;
  year_built: number | null;
  by_bed: BedRents;
};

export type RentVsMarket = {
  subject_rent: number;
  market_rent: number;
  /** (property − market) ÷ market × 100. Negative = below market. */
  pct: number;
  beds: { bed: string; subject: number; market: number; weight: number; comps: number }[];
};

/** Listings older than this say little about today's market. */
const MAX_AGE_DAYS = 365;
const MIN_RENT = 300;
const MAX_RENT = 25_000;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 0 = studio, 1, 2, and 3 for three or more. */
export function bedKey(bed: unknown): string | null {
  if (!isNum(bed) || bed < 0) return null;
  return String(Math.min(Math.round(bed), 3));
}

/** Average listed rent per bedroom count, from a /property/{id} payload. */
export function rentsByBed(payload: any, now: Date = new Date()): BedRents {
  const listings: any[] = Array.isArray(payload?.building_availability) ? payload.building_availability : [];
  const cutoff = now.getTime() - MAX_AGE_DAYS * 86_400_000;
  const sums: Record<string, { sum: number; n: number }> = {};
  for (const l of listings) {
    const key = bedKey(l?.bed);
    if (key === null) continue;
    // Effective (after concessions) when HelloData has it, else the asking price.
    const rent = isNum(l?.effective_price) && l.effective_price > 0 ? l.effective_price : l?.price;
    if (!isNum(rent) || rent < MIN_RENT || rent > MAX_RENT) continue;
    const seen = Date.parse(l?.exit_market ?? l?.enter_market ?? l?.created_on ?? "");
    if (Number.isFinite(seen) && seen < cutoff) continue;
    const s = (sums[key] ??= { sum: 0, n: 0 });
    s.sum += rent;
    s.n += 1;
  }
  const out: BedRents = {};
  for (const [k, { sum, n }] of Object.entries(sums)) out[k] = { avg: Math.round(sum / n), n };
  return out;
}

export function rentVsMarket(subject: BedRents, comps: BedRents[]): RentVsMarket | null {
  const beds: RentVsMarket["beds"] = [];
  for (const [bed, s] of Object.entries(subject)) {
    // Each comp counts once per bedroom count, however many units it lists.
    const compAvgs = comps.map((c) => c[bed]?.avg).filter(isNum);
    if (!compAvgs.length) continue;
    const market = compAvgs.reduce((a, b) => a + b, 0) / compAvgs.length;
    beds.push({ bed, subject: s.avg, market: Math.round(market), weight: s.n, comps: compAvgs.length });
  }
  const w = beds.reduce((a, b) => a + b.weight, 0);
  if (!w) return null;
  const subjectRent = beds.reduce((a, b) => a + b.subject * b.weight, 0) / w;
  const marketRent = beds.reduce((a, b) => a + b.market * b.weight, 0) / w;
  if (marketRent <= 0) return null;
  return {
    subject_rent: Math.round(subjectRent),
    market_rent: Math.round(marketRent),
    pct: Math.round(((subjectRent - marketRent) / marketRent) * 1000) / 10,
    beds: beds.sort((a, b) => Number(a.bed) - Number(b.bed)),
  };
}

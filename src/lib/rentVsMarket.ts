/**
 * Rent vs market as the pipeline shows it: from HelloData only (the property's
 * listed rents vs its HelloData comps', see hellodata-rent-comps). Never a rent
 * roll / OM rent, the Census tract median or CoStar.
 */

/** (property − market) ÷ market × 100; negative = below market. Null without comps. */
export function hellodataRentVsMarketPct(deal: unknown): number | null {
  const v = (deal as Record<string, unknown> | null)?.hd_rent_vs_market_pct;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** How far BELOW market, as a positive number (the "rent lag"). */
export function rentLagPct(deal: unknown): number | null {
  const pct = hellodataRentVsMarketPct(deal);
  return pct == null ? null : -pct;
}

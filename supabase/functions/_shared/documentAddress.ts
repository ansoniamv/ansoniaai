/**
 * The street address a deal document gives, when the deal has none.
 *
 * Broker emails often name a property without its street ("Twin Towers,
 * Chicago"), and every address-keyed source (Census, Esri, schools, HelloData)
 * then has nothing to look up. The OM, brochure or rent roll almost always
 * prints the street. parse-deal-document already reads it
 * (extraction.property_address); this decides whether it can go on the deal.
 *
 * It is written only when it is clearly the same property: the document names
 * it (loosely) the same, sits in the same state, and does not disagree on the
 * unit count. Anything less and the deal stays blank: a wrong street sends every
 * lookup to the wrong building, which is worse than none.
 */
import { hasStreet } from "./esriMatch.ts";

export type AddressDeal = {
  property_name?: string | null;
  address?: string | null;
  property_address?: string | null;
  state?: string | null;
  zip?: string | null;
  unit_count?: number | null;
};

export type AddressDoc = {
  property_name: string | null;
  property_address: string | null;
  unit_count: number | null;
};

export type AddressFill =
  | { ok: true; address: string; zip: string | null }
  | { ok: false; reason: string };

const STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
  "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR",
  "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR",
]);

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(apartments?|apts?|homes?|the|at)\b/g, " ").replace(/\s+/g, " ").trim();

/** Same loose rule as the deal page's document check (src/lib/documentMatch.ts), but a missing name is not a match. */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x) || x.split(" ")[0] === y.split(" ")[0];
}

/** A two-letter state named in the address, after a comma or just before the ZIP. */
function stateIn(addr: string): string | null {
  const m = addr.match(/(?:,\s*([A-Za-z]{2})\.?,?\s*(?:\d{5}(?:-\d{4})?)?|\s([A-Za-z]{2})\.?,?\s+\d{5}(?:-\d{4})?)\s*$/);
  const st = m ? (m[1] ?? m[2]).toUpperCase() : null;
  return st && STATES.has(st) ? st : null;
}

export function dealHasStreet(deal: AddressDeal): boolean {
  return hasStreet(deal.address) || hasStreet(deal.property_address);
}

export function addressFromDocument(doc: AddressDoc, deal: AddressDeal): AddressFill {
  if (dealHasStreet(deal)) return { ok: false, reason: "deal already has a street address" };
  const full = (doc.property_address ?? "").trim();
  if (!full) return { ok: false, reason: "document gives no address" };

  // The street is the part before the first comma: "1649 E. 50th Street,
  // Chicago, IL 60615". City, state and ZIP already have their own columns.
  const street = full.split(",")[0].trim();
  if (!hasStreet(street)) return { ok: false, reason: `"${street}" is not a street address` };

  if (!namesMatch(doc.property_name, deal.property_name)) {
    return { ok: false, reason: `document is for "${doc.property_name ?? "an unnamed property"}"` };
  }
  const docState = stateIn(full);
  const dealState = (deal.state ?? "").trim().toUpperCase().slice(0, 2) || null;
  if (docState && dealState && docState !== dealState) {
    return { ok: false, reason: `document address is in ${docState}; the deal is in ${dealState}` };
  }
  const units = deal.unit_count;
  const docUnits = doc.unit_count;
  if (typeof units === "number" && units > 0 && typeof docUnits === "number" && docUnits > 0 &&
      Math.abs(units - docUnits) > Math.max(3, units * 0.05)) {
    return { ok: false, reason: `document lists ${docUnits} units; the deal has ${units}` };
  }

  const zip = full.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null;
  return { ok: true, address: street.slice(0, 200), zip: deal.zip ? null : zip };
}

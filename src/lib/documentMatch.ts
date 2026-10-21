/**
 * Does a parsed OM / rent roll / T12 belong to this deal, and is it current?
 *
 * The case this exists for: a 2021 rent roll for a 167-unit "The Foundry" was
 * uploaded to Foundry Townhomes (120 units, Simpsonville SC) and its figures
 * were applied. The names agree once "The" and "Townhomes" are dropped, so a
 * name check alone passes it; the unit count and the date are what give it away.
 *
 * Two severities:
 *   block — strong evidence of another property (unit count or location). Its
 *           figures are not offered for applying until someone says the
 *           document is right anyway, because the deal's own value can be the
 *           wrong one (a HelloData prediction, a typo).
 *   warn  — worth a look, not worth stopping for: names are written many ways,
 *           and an old document is sometimes all there is.
 *
 * Pure, so the rules can be tested without the panel around them.
 */
import type { DocumentSummary } from "@/components/DealDocumentSummary";

export type DocumentIssue = {
  kind: "units" | "location" | "street" | "name" | "stale";
  severity: "block" | "warn";
  message: string;
};

export type DocumentForCheck = {
  doc_type: "om" | "rent_roll" | "t12" | "other" | null;
  doc_property_name: string | null;
  doc_as_of: string | null;
  /** extraction.figures.unit_count.value — the stated total, for any doc type. */
  doc_unit_count?: number | null;
  /** extraction.property_address — absent on documents read before it existed. */
  doc_address?: string | null;
  summary: DocumentSummary | null;
};

export type DealForCheck = {
  property_name: string;
  unit_count?: unknown;
  property_address?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Units can differ a little between documents (down units, a model counted or not). */
export function unitCountsDisagree(deal: number, doc: number): boolean {
  return Math.abs(deal - doc) > Math.max(3, deal * 0.05);
}

/** Loose match: a document for "Alara North Burnet" on deal "Alara" is fine. */
export function sameProperty(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(apartments?|apts?|homes?|the|at)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!a || !b) return true;
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return true;
  return x.includes(y) || y.includes(x) || x.split(" ")[0] === y.split(" ")[0];
}

const STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
  "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR",
  "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

type AddressParts = { number: string | null; street: string | null; state: string | null; zip: string | null };

/**
 * Street number, first street word, state and ZIP out of a one-line address.
 * Each part is null unless it is clearly there: a missing part is "not stated",
 * never a mismatch.
 */
export function addressParts(addr: string | null): AddressParts {
  const none: AddressParts = { number: null, street: null, state: null, zip: null };
  if (!addr) return none;
  const lead = addr.trim().match(/^(\d+[a-z]?)\s+(?:(?:n|s|e|w|north|south|east|west)\.?\s+)?([a-z0-9]+)/i);
  const zip = addr.match(/\b(\d{5})(?:-\d{4})?\s*$/);
  // A two-letter state at the end after a comma, or anywhere just before the ZIP.
  // Not a bare trailing pair: "Fairview Ct" would read as Connecticut.
  const state = addr.match(/(?:,\s*([A-Za-z]{2})\.?,?\s*(?:\d{5}(?:-\d{4})?)?|\s([A-Za-z]{2})\.?,?\s+\d{5}(?:-\d{4})?)\s*$/);
  const st = state ? (state[1] ?? state[2]).toUpperCase() : null;
  return {
    number: lead ? lead[1].toLowerCase() : null,
    street: lead ? lead[2].toLowerCase() : null,
    state: st && STATES.has(st) ? st : null,
    zip: zip ? zip[1] : null,
  };
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The latest year-month a piece of text names, as months since year 0, or null.
 *
 * Latest, because a T12 period ("Oct 2025-Sep 2026") is as current as its last
 * month. Each candidate is range-checked: an unparseable date returns null and
 * raises no warning, rather than becoming a date that looks real.
 */
export function latestMonthIn(text: string | null | undefined): number | null {
  if (!text) return null;
  const found: number[] = [];
  const add = (y: number, m: number) => {
    if (y >= 1990 && y <= 2100 && m >= 1 && m <= 12) found.push(y * 12 + (m - 1));
  };
  for (const x of text.matchAll(/\b(\d{4})-(\d{1,2})(?:-\d{1,2})?\b/g)) add(+x[1], +x[2]);
  for (const x of text.matchAll(/\b(\d{1,2})\/(?:\d{1,2}\/)?(\d{4})\b/g)) add(+x[2], +x[1]);
  for (const x of text.matchAll(/\b(\d{1,2})\/\d{1,2}\/(\d{2})\b/g)) add(2000 + +x[2], +x[1]);
  // Whole month names only: a bare three-letter prefix reads "Market 2021" as March.
  const monthName = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?[\s-]+(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?('?\d{2}|\d{4})\b/gi;
  for (const x of text.matchAll(monthName)) {
    const m = MONTH_NAMES.indexOf(x[1].slice(0, 3).toLowerCase());
    if (m < 0) continue;
    const y = x[2].replace("'", "");
    add(y.length === 2 ? 2000 + +y : +y, m + 1);
  }
  if (found.length) return Math.max(...found);
  // Year only ("FY 2021"): its last month, so a bare year is never read as older than it is.
  const years = [...text.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((x) => +x[1]);
  for (const y of years) add(y, 12);
  return found.length ? Math.max(...found) : null;
}

/** How old a document's figures may be before they are flagged, in months. */
const STALE_AFTER_MONTHS: Record<string, number> = { rent_roll: 6, t12: 12, om: 12 };

function asOfMonth(doc: DocumentForCheck): number | null {
  return (
    latestMonthIn(doc.summary?.rent_roll?.as_of) ??
    latestMonthIn(doc.summary?.t12?.period) ??
    latestMonthIn(doc.doc_as_of)
  );
}

function omAddress(summary: DocumentSummary | null): string | null {
  return str(summary?.om?.facts.find((f) => /^(property )?address$/i.test(f.label.trim()))?.value);
}

export function checkDocumentAgainstDeal(
  doc: DocumentForCheck,
  deal: DealForCheck,
  now: Date = new Date(),
): DocumentIssue[] {
  const issues: DocumentIssue[] = [];

  const dealUnits = isNum(deal.unit_count) && deal.unit_count > 0 ? deal.unit_count : null;
  const rrUnits = doc.summary?.rent_roll?.units;
  const docUnits = isNum(doc.doc_unit_count) && doc.doc_unit_count > 0
    ? doc.doc_unit_count
    : isNum(rrUnits) && rrUnits > 0 ? rrUnits : null;
  if (dealUnits !== null && docUnits !== null && unitCountsDisagree(dealUnits, docUnits)) {
    issues.push({
      kind: "units",
      severity: "block",
      message: `It lists ${docUnits.toLocaleString()} units; this deal has ${dealUnits.toLocaleString()}.`,
    });
  }

  const docAddr = addressParts(str(doc.doc_address) ?? omAddress(doc.summary));
  const dealLine = str(deal.property_address) ??
    ([str(deal.address), str(deal.city), [str(deal.state), str(deal.zip)].filter(Boolean).join(" ")]
      .filter(Boolean).join(", ") || null);
  const dealAddr = addressParts(dealLine);
  const dealState = dealAddr.state ?? (str(deal.state)?.toUpperCase().slice(0, 2) || null);
  const dealZip = dealAddr.zip ?? str(deal.zip)?.slice(0, 5) ?? null;
  if (docAddr.state && dealState && docAddr.state !== dealState) {
    issues.push({ kind: "location", severity: "block", message: `It is in ${docAddr.state}; this deal is in ${dealState}.` });
  } else if (docAddr.zip && dealZip && docAddr.zip !== dealZip) {
    issues.push({ kind: "location", severity: "block", message: `Its ZIP is ${docAddr.zip}; this deal's is ${dealZip}.` });
  } else if (
    docAddr.number && dealAddr.number && docAddr.street && dealAddr.street &&
    docAddr.number !== dealAddr.number && docAddr.street !== dealAddr.street
  ) {
    // Warn only: a property can front two streets, and the OM may use either.
    issues.push({ kind: "street", severity: "warn", message: "Its street address differs from this deal's." });
  }

  if (!sameProperty(doc.doc_property_name, deal.property_name)) {
    issues.push({ kind: "name", severity: "warn", message: `It is for “${doc.doc_property_name}”.` });
  }

  const asOf = asOfMonth(doc);
  const limit = STALE_AFTER_MONTHS[doc.doc_type ?? ""];
  if (asOf !== null && limit !== undefined) {
    const nowMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
    const age = nowMonth - asOf;
    if (age > limit) {
      const years = Math.floor(age / 12);
      const ago = years >= 2 ? `${years} years` : `${age} months`;
      issues.push({ kind: "stale", severity: "warn", message: `It is dated ${ago} ago.` });
    }
  }

  return issues;
}

export const blocksApply = (issues: DocumentIssue[]) => issues.some((i) => i.severity === "block");

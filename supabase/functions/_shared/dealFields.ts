/**
 * Deal field extraction: the column contract, the write-boundary guards, and the
 * deterministic fallbacks.
 *
 * Lives in _shared so it can be unit tested without a Deno runtime, the same way
 * _shared/hellodataClient is. summarize-emails and sync-acquisitions-inbox both
 * import from here so there is one definition of what a deal field is.
 *
 * The target table is `inbox_deals`. Every key below is a real column on it —
 * that invariant is what the accompanying test pins.
 */

/**
 * Keys the extractor may write. Each one IS a column on public.inbox_deals.
 *
 * `asking_price` was previously named `price_guidance` here and in the prompt.
 * No such column exists, so every row where the model returned a price failed
 * its UPDATE — and because the same list is interpolated into the preceding
 * SELECT, that SELECT errored too, which silently disabled the
 * don't-overwrite-existing-values guard. Evidence: asking_price was populated
 * on 0 of 512 deals.
 */
export const EXTRACTABLE_FIELDS = [
  "property_name",
  "address",
  "location_city",
  "location_state",
  "msa",
  "units",
  "year_built",
  "avg_sf",
  "occupancy_pct",
  "asset_class",
  "strategy",
  "offers_due",
  "broker_firm",
  "asking_price",
] as const;

export type ExtractableField = (typeof EXTRACTABLE_FIELDS)[number];
export type Extracted = Partial<Record<ExtractableField, string | number | null>>;

export const UNITS_MIN = 1;
export const UNITS_MAX = 5000;
export const YEAR_MIN = 1900;
/** Pre-sale and under-construction deals legitimately carry a future vintage. */
export const yearMax = (now: Date = new Date()) => now.getFullYear() + 3;

export type GuardRejection = { field: string; value: unknown; reason: string };

const asInt = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  const digits = String(v).replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * True when a units candidate is really a calendar year that leaked in.
 *
 * 5000 does not exclude it: 2026 is a perfectly legal unit count arithmetically,
 * which is exactly why the range guard alone let "2026 units" through. So any
 * value in the plausible-vintage window is refused as a unit count.
 *
 * The tradeoff is deliberate and one-sided: a genuine 1,900-5,000 unit portfolio
 * in that window gets dropped and logged rather than written. Blank is
 * recoverable and visibly missing; a wrong number is silently believed and feeds
 * the gate and the score.
 */
export function looksLikeYear(n: number, now: Date = new Date()): boolean {
  return n >= YEAR_MIN && n <= yearMax(now);
}

/**
 * The write boundary. Anything that fails its own guard is dropped and reported
 * rather than written — a wrong number in units is worse than a blank, because
 * a blank is visibly missing and a wrong number is silently believed.
 */
export function coerceDealFields(
  raw: Record<string, unknown>,
  now: Date = new Date(),
): { fields: Extracted; rejected: GuardRejection[] } {
  const fields: Extracted = {};
  const rejected: GuardRejection[] = [];

  for (const k of EXTRACTABLE_FIELDS) {
    const v = raw[k];
    if (v === undefined || v === null || v === "") continue;

    if (k === "units") {
      const n = asInt(v);
      if (n === null) {
        rejected.push({ field: k, value: v, reason: "not an integer" });
      } else if (n < UNITS_MIN || n > UNITS_MAX) {
        rejected.push({ field: k, value: v, reason: `outside ${UNITS_MIN}-${UNITS_MAX}` });
      } else if (looksLikeYear(n, now)) {
        // The Casata San Marcos case: units=2026, year_built=null.
        rejected.push({ field: k, value: v, reason: "looks like a calendar year, not a unit count" });
      } else {
        fields.units = n;
      }
      continue;
    }

    if (k === "year_built") {
      const n = asInt(v);
      if (n === null) {
        rejected.push({ field: k, value: v, reason: "not an integer" });
      } else if (n < YEAR_MIN || n > yearMax(now)) {
        rejected.push({ field: k, value: v, reason: `outside ${YEAR_MIN}-${yearMax(now)}` });
      } else {
        fields.year_built = n;
      }
      continue;
    }

    if (k === "avg_sf") {
      const n = asInt(v);
      if (n === null || n <= 0 || n > 20000) {
        rejected.push({ field: k, value: v, reason: "outside 1-20000" });
      } else {
        fields.avg_sf = n;
      }
      continue;
    }

    if (k === "occupancy_pct") {
      const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d.]/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        rejected.push({ field: k, value: v, reason: "outside 0-100" });
      } else {
        fields.occupancy_pct = n;
      }
      continue;
    }

    const s = String(v).trim();
    if (s) (fields as Record<string, unknown>)[k] = s;
  }

  return { fields, rejected };
}

/**
 * Regex pre-extraction from the raw email, used at ingest before any model runs.
 *
 * The units pattern is deliberately single-line. The previous `\s*` crossed
 * newlines, so a body reading "…delivery 2026\nUnits: 288" matched "2026\nUnits"
 * and captured the year. [^\S\n] is "horizontal whitespace only".
 */
export function preExtractFacts(
  subject: string,
  body: string | null,
  now: Date = new Date(),
): { units: number | null; year_built: number | null; rejected: GuardRejection[] } {
  const blob = `${subject}\n${body ?? ""}`;
  const rejected: GuardRejection[] = [];

  let units: number | null = null;
  // Ordered most-reliable first. A LABELLED count ("Units: 288", "Unit count 288")
  // is trustworthy; the bare "288 units" form is last because it is the one that
  // can pick up a stray number, and it is confined to a single line so a delivery
  // year on the previous line cannot join up with a "Units" label on this one.
  const unitMatch =
    blob.match(/\bunit[^\S\n]*count[^\S\n]*[:\-]?[^\S\n]*(\d[\d,]{0,4})\b/i) ||
    blob.match(/\bunits?[^\S\n]*[:\-][^\S\n]*(\d[\d,]{0,4})\b/i) ||
    blob.match(/(\d[\d,]{0,4})[^\S\n]*\+?[^\S\n]*units?\b/i);
  if (unitMatch) {
    const n = parseInt(unitMatch[1].replace(/,/g, ""), 10);
    if (!Number.isFinite(n) || n < UNITS_MIN || n > UNITS_MAX) {
      rejected.push({ field: "units", value: unitMatch[1], reason: `outside ${UNITS_MIN}-${UNITS_MAX}` });
    } else if (looksLikeYear(n, now)) {
      rejected.push({ field: "units", value: unitMatch[1], reason: "looks like a calendar year" });
    } else {
      units = n;
    }
  }

  let year_built: number | null = null;
  const yearMatch = blob.match(
    /\b(?:year\s*built|built(?:\s*in)?|vintage|constructed(?:\s*in)?|circa|c\.)\s*[:\-]?\s*((?:19|20)\d{2})\b/i,
  );
  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10);
    if (y >= YEAR_MIN && y <= yearMax(now)) year_built = y;
    else rejected.push({ field: "year_built", value: yearMatch[1], reason: "outside range" });
  }

  return { units, year_built, rejected };
}

/** Mailbox providers and aggregators that say nothing about the brokerage. */
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com",
  "me.com", "live.com", "msn.com", "protonmail.com", "comcast.net", "verizon.net",
  "crexi.com", "buildout.com", "constantcontact.com", "mailchimp.com", "rcm1.com",
]);

const FIRM_WORD_OVERRIDES: Record<string, string> = {
  cbre: "CBRE", jll: "JLL", nmrk: "Newmark", newmark: "Newmark", cushwake: "Cushman & Wakefield",
  berkadia: "Berkadia", walkerdunlop: "Walker & Dunlop", marcusmillichap: "Marcus & Millichap",
  irr: "IRR", eastdil: "Eastdil Secured", greysteel: "Greysteel", nai: "NAI",
};

/**
 * Best-effort brokerage name from the broker's email domain.
 *
 * broker_contact_name and broker_contact_email are written deterministically at
 * ingest from the message headers; broker_firm was only ever written by the
 * model. That asymmetry is why contact details survive an LLM outage and the
 * firm does not. The domain is already in hand at ingest, so the firm no longer
 * has to wait on a model — the model can still refine it later.
 */
export function firmFromEmailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || !domain.includes(".")) return null;

  const labels = domain.split(".");
  // Drop the public suffix, including two-part ones like .co.uk.
  const second = labels.length >= 3 && labels[labels.length - 2].length <= 3
    ? labels[labels.length - 3]
    : labels[labels.length - 2];
  if (!second) return null;
  if (GENERIC_EMAIL_DOMAINS.has(domain)) return null;

  const key = second.replace(/[^a-z0-9]/g, "");
  if (!key) return null;
  if (FIRM_WORD_OVERRIDES[key]) return FIRM_WORD_OVERRIDES[key];

  // Title-case the bare label. Deliberately plain: a wrong-looking guess is
  // visible and correctable, where a blank is just missing.
  return key.charAt(0).toUpperCase() + key.slice(1);
}

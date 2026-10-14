/**
 * Does this suggested deal already exist in the pipeline?
 *
 * Pure, so the same rule runs in the edge function and in tests, and so the
 * rule can be read without reading the sync job around it.
 *
 * THE TRADE. A false positive hides a real deal from the acquisitions team and
 * nobody notices, because the thing that went missing never appeared. A false
 * negative shows a repeat, which costs a glance. So the rule is deliberately
 * tight, and every loosening has to buy its way in:
 *
 *   exact  — canonical names are equal. No location needed.
 *   strong — canonical names are equal only after dropping a trailing generic
 *            property word ("Apartments", "Townhomes", …), AND the location
 *            corroborates: same state, and same city when both are known.
 *   none   — anything else.
 *
 * The location requirement on `strong` is the whole safety margin. "Parkview
 * Apartments" is not a name, it is a description — there is one in most cities
 * in America. Dropping the suffix without checking the state would collapse
 * every one of them into a single deal.
 *
 * Note what is NOT here: token-overlap scoring. The sync job's existing
 * inbox-to-inbox matcher scores shared tokens and accepts at 0.6, which is a
 * much looser rule than anything below. It is untouched; this module is only
 * used for matching against the pipeline.
 */

/** Words that describe what a building is, not which building it is. */
const GENERIC_SUFFIXES = new Set([
  "apartments", "apartment", "apts", "apt",
  "townhomes", "townhome", "townhouses", "townhouse",
  "residences", "residence", "lofts", "loft", "flats",
  "homes", "living", "community", "communities",
  "portfolio", "property", "properties",
]);

/**
 * Lowercase, punctuation to space, whitespace collapsed, leading "the" dropped.
 *
 * Nothing else. "&" and "and" are left as they are: normalising one to the
 * other is a change of meaning often enough ("Smith & Jones" is a firm) that it
 * is not worth it for the handful of names it would join.
 */
export function canonicalName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
  return n.length > 0 ? n : null;
}

/** canonicalName with one trailing generic word removed. The looser key. */
export function canonicalNameLoose(name: string | null | undefined): string | null {
  const n = canonicalName(name);
  if (!n) return null;
  const parts = n.split(" ");
  // Only one word, and only when something identifying survives. "Apartments"
  // on its own canonicalises to nothing rather than to the empty string.
  if (parts.length > 1 && GENERIC_SUFFIXES.has(parts[parts.length - 1])) {
    parts.pop();
  }
  const out = parts.join(" ");
  return out.length > 0 ? out : null;
}

const canonState = (s: string | null | undefined) =>
  (s ?? "").trim().toUpperCase().slice(0, 2) || null;

const canonCity = (s: string | null | undefined) => {
  const c = (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return c.length > 0 ? c : null;
};

export type MatchCandidate = {
  id: string;
  property_name: string | null;
  city?: string | null;
  state?: string | null;
};

export type MatchSubject = {
  property_name: string | null;
  city?: string | null;
  state?: string | null;
};

export type MatchConfidence = "exact" | "strong" | "none";

export type DealMatch = {
  confidence: MatchConfidence;
  dealId: string;
  dealName: string | null;
  /** Plain English, stored on the row so a hidden deal can explain itself. */
  reason: string;
};

/**
 * Both locations known and compatible.
 *
 * Unknown is not a match. A missing state on either side means we cannot
 * corroborate, and `strong` exists precisely for the case where the name alone
 * is not enough — so an unknown location fails it rather than passing it.
 */
function locationAgrees(a: MatchSubject, b: MatchCandidate): boolean {
  const sa = canonState(a.state);
  const sb = canonState(b.state);
  if (!sa || !sb || sa !== sb) return false;
  const ca = canonCity(a.city);
  const cb = canonCity(b.city);
  // City only has to agree when both sides have one; a deal whose city was
  // never extracted still matches on state alone, which is why the name had to
  // survive suffix-stripping to get here.
  if (ca && cb && ca !== cb) return false;
  return true;
}

/**
 * The best match for `subject` among `candidates`, or null.
 *
 * Exact beats strong; among equals, the first candidate wins, so callers that
 * care about ordering should sort before calling.
 */
export function matchPipelineDeal(
  subject: MatchSubject,
  candidates: MatchCandidate[],
): DealMatch | null {
  const exact = canonicalName(subject.property_name);
  if (!exact) return null;
  // A one-word name is not evidence. "Westview", "Lakeside", "The Point" —
  // matching those across the whole pipeline would be guessing.
  if (exact.split(" ").length < 2) return null;

  const loose = canonicalNameLoose(subject.property_name);

  let strong: DealMatch | null = null;
  for (const c of candidates) {
    const cExact = canonicalName(c.property_name);
    if (cExact && cExact === exact) {
      return {
        confidence: "exact",
        dealId: c.id,
        dealName: c.property_name,
        reason: `Already in the pipeline as "${c.property_name ?? "(unnamed)"}" — same property name`,
      };
    }
    if (strong || !loose) continue;
    const cLoose = canonicalNameLoose(c.property_name);
    if (cLoose && cLoose === loose && locationAgrees(subject, c)) {
      strong = {
        confidence: "strong",
        dealId: c.id,
        dealName: c.property_name,
        reason: `Already in the pipeline as "${c.property_name ?? "(unnamed)"}" — same name and location`,
      };
    }
  }
  return strong;
}

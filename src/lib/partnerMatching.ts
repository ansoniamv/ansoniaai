/**
 * Pure capital-partner matching engine.
 *
 * Replaces the inline scorer that lived in PartnerMatchPanel.tsx. Makes NO
 * network calls and holds no React state, so it is safe to unit test and to
 * re-run whenever inputs change.
 *
 * Design notes (differences from the previous inline scorer):
 *  - Coverage-aware normalization. A pillar with no data on either side is
 *    marked NOT APPLICABLE and dropped from the denominator, instead of
 *    silently scoring 0 and dragging every partner down. Mirrors the
 *    score_confidence / score_coverage pattern used for deal AI scores.
 *  - Hard gates. Check size and the avoid list disqualify outright rather than
 *    zeroing one pillar and letting the partner surface anyway.
 *  - Warmth is NOT part of the fit score. It ranks partners *within* a fit
 *    band. See MATCH_WEIGHTS.warmth to fold it back in.
 *  - Geography matches on state codes / word boundaries, never on raw
 *    substrings. ("in" no longer matches "Cincinnati".)
 *  - Notes signals are deduplicated by (direction, term) so one restated
 *    sentence cannot max out the swing.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Structural inputs — intentionally not the app's Deal/Partner types
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchableDeal {
  state?: string | null;
  city?: string | null;
  msa?: string | null;
  estimated_equity?: number | null; // $M
  school_rating?: number | null;
}

export interface MatchablePartner {
  id: string;
  name: string;
  relationship_strength?: string | null;
  min_equity_m?: number | null;
  max_equity_m?: number | null;
  geography?: string[] | null;
  geography_avoid?: string[] | null;
  strategy_value_add?: boolean | null;
  strategy_core_plus?: boolean | null;
  strategy_workforce?: boolean | null;
  strategy_affordable?: boolean | null;
  additional_notes?: string | null;
  organized_notes?: string | null;
  // Used only for the analyst-facing blurb, never for scoring.
  firm_type?: string | null;
  investor_type?: string[] | null;
  headquarters?: string | null;
  product_types?: string[] | null;
  hold_period?: string[] | null;
  profile_summary?: string | null;
}

export interface PartnerContactLite {
  name: string;
  role?: string | null;
}

export type StrategyKey = "value_add" | "core_plus" | "workforce" | "affordable";

export const STRATEGY_LABEL: Record<StrategyKey, string> = {
  value_add: "Value-Add",
  core_plus: "Core+",
  workforce: "Workforce",
  affordable: "Affordable",
};

export const PARTNER_STRATEGY_FIELD: Record<StrategyKey, keyof MatchablePartner> = {
  value_add: "strategy_value_add",
  core_plus: "strategy_core_plus",
  workforce: "strategy_workforce",
  affordable: "strategy_affordable",
};

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fit pillars sum to 100 so the normalized score reads directly as a percent
 * when all three apply. `notesSwing` is applied AFTER normalization, in
 * percentage points, so its effect is identical regardless of coverage.
 */
export const MATCH_WEIGHTS = {
  checkSize: 40,
  strategy: 30,
  geography: 30,
  notesSwing: 12,
  /**
   * Warmth deliberately contributes 0 to the fit score — relationship warmth
   * is not evidence that a partner fits the deal, it is how easy the call is.
   * It drives ranking within a band via WARMTH_RANK. Set this above 0 to fold
   * it back into the score as a fourth pillar.
   */
  warmth: 0,
} as const;

/** Higher = warmer. Used for ranking and display, not for the fit score. */
export const WARMTH_RANK: Record<string, number> = {
  "Existing Partner": 5,
  "Very Warm": 4,
  Warm: 3,
  Tepid: 2,
  Cold: 1,
};

export const TIER_THRESHOLDS = { strong: 75, moderate: 55 } as const;

const CONFIDENCE_THRESHOLDS = { high: 0.85, medium: 0.6, low: 0.3 } as const;

/** Check-size fit bands, as multipliers on the partner's stated range. */
const CHECK_BANDS = {
  nearLow: 0.75,
  nearHigh: 1.25,
  stretchLow: 0.5,
  stretchHigh: 1.75,
} as const;

const CHECK_CREDIT = { inBand: 1, near: 0.8, stretch: 0.45 } as const;
const GEO_CREDIT = { exact: 1, region: 0.7, notesOnly: 0.45, mismatch: 0 } as const;
const STRATEGY_CREDIT = { generalist: 0.5 } as const;

const NOTES_POINTS = {
  partnerNamedInDeal: 6,
  partnerReferencedInDeal: 3,
  geoInterest: 5,
  geoInterestCap: 10,
  geoAvoid: -8,
  geoAvoidCap: -16,
  schoolConcern: -5,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Notes signal regexes
// ─────────────────────────────────────────────────────────────────────────────

const AVOID_RE = /\b(avoid|no interest|not interested|will not (do|invest)|won.t (do|invest)|pass(ed|ing)? on|stay(ing)? out of|dislike|steer clear)\b/i;
const INTEREST_RE = /\b(very interested|interested in|actively looking|target(ing|ed)?|focus(ed|ing)? on|love|prefer|hunting for|bullish on|want more)\b/i;
const SCHOOL_CONCERN_RE = /\b(school|schools|school district|school quality|school rating)\b/i;
const NATIONAL_RE = /\b(national|nationwide|nation-?wide|all markets|anywhere in the us)\b/i;
const SENIOR_ROLE_RE = /\b(managing (director|partner|member)|founder|co-?founder|ceo|coo|cio|president|chief|principal|partner|head of|portfolio manager|svp|senior vice president)\b/i;

// ─────────────────────────────────────────────────────────────────────────────
// Geography reference data
// ─────────────────────────────────────────────────────────────────────────────

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", "district of columbia": "dc",
  florida: "fl", georgia: "ga", hawaii: "hi", idaho: "id", illinois: "il",
  indiana: "in", iowa: "ia", kansas: "ks", kentucky: "ky", louisiana: "la",
  maine: "me", maryland: "md", massachusetts: "ma", michigan: "mi",
  minnesota: "mn", mississippi: "ms", missouri: "mo", montana: "mt",
  nebraska: "ne", nevada: "nv", "new hampshire": "nh", "new jersey": "nj",
  "new mexico": "nm", "new york": "ny", "north carolina": "nc",
  "north dakota": "nd", ohio: "oh", oklahoma: "ok", oregon: "or",
  pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc",
  "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut",
  vermont: "vt", virginia: "va", washington: "wa", "west virginia": "wv",
  wisconsin: "wi", wyoming: "wy",
};

const STATE_CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAME_TO_CODE).map(([name, code]) => [code, name]),
);

/** Region buckets keyed by state CODE only — never mixed with full names. */
const REGION_STATES: Record<string, string[]> = {
  southeast: ["fl", "ga", "nc", "sc", "va", "tn", "al", "ms", "la", "ar", "ky", "wv"],
  midwest: ["il", "in", "oh", "mi", "wi", "mo", "ia", "mn", "ks", "ne", "nd", "sd"],
  northeast: ["ny", "nj", "pa", "ma", "ct", "ri", "vt", "nh", "me", "de", "md", "dc"],
  southwest: ["tx", "az", "nm", "ok"],
  west: ["ca", "or", "wa", "nv", "ut", "co", "id", "mt", "wy", "ak", "hi"],
};

const REGION_ALIASES: Record<string, string[]> = {
  southeast: ["southeast", "south east", "sunbelt", "sun belt", "southern"],
  southwest: ["southwest", "south west"],
  northeast: ["northeast", "north east", "mid atlantic", "midatlantic", "new england"],
  midwest: ["midwest", "mid west", "middle west", "great lakes"],
  west: ["west", "western", "west coast", "pacific", "mountain west"],
};

export const REGION_LABEL: Record<string, string> = {
  southeast: "Southeast", southwest: "Southwest", northeast: "Northeast",
  midwest: "Midwest", west: "West",
};

// ─────────────────────────────────────────────────────────────────────────────
// Text matching primitives
// ─────────────────────────────────────────────────────────────────────────────

const norm = (s: string | null | undefined): string =>
  (s ?? "").toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Word-boundary containment. Unlike String.includes this will not match "in"
 * inside "Cincinnati". Internal whitespace and hyphens are treated as flexible
 * separators so "ft worth" matches "ft-worth".
 */
export function wordMatch(haystack: string, needle: string): boolean {
  const h = norm(haystack);
  const n = norm(needle);
  if (n.length < 3 || !h) return false;
  const pattern = escapeRe(n).replace(/[\s-]+/g, "[\\s-]+");
  return new RegExp(`\\b${pattern}\\b`).test(h);
}

/** Alphabetic tokens, used for exact 2-letter state-code comparison. */
const tokens = (s: string): string[] => norm(s).split(/[^a-z]+/).filter(Boolean);

/** Resolve a raw state string ("IL", "Illinois") to a 2-letter code. */
export function resolveStateCode(raw: string | null | undefined): string | null {
  const n = norm(raw);
  if (!n) return null;
  if (n.length === 2 && STATE_CODE_TO_NAME[n]) return n;
  if (STATE_NAME_TO_CODE[n]) return STATE_NAME_TO_CODE[n];
  for (const [name, code] of Object.entries(STATE_NAME_TO_CODE)) {
    if (wordMatch(n, name)) return code;
  }
  return null;
}

/** Does a partner geography entry reference this state? */
function geoMentionsState(geo: string, code: string): boolean {
  if (tokens(geo).includes(code)) return true;
  const name = STATE_CODE_TO_NAME[code];
  return name ? wordMatch(geo, name) : false;
}

/**
 * Place-name overlap in either direction, word-bounded and length-guarded so
 * short state codes inside an MSA string ("IL-IN-WI") never count as places.
 */
function placeOverlap(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x.length < 4 || y.length < 4) return false;
  return wordMatch(x, y) || wordMatch(y, x);
}

/** Split an MSA label ("Chicago-Naperville-Elgin, IL-IN-WI") into place parts. */
function msaParts(msa: string): string[] {
  return norm(msa)
    .split(/[-–—,/]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4);
}

function detectRegion(geo: string): string | null {
  for (const key of ["southeast", "southwest", "northeast", "midwest", "west"]) {
    if (REGION_ALIASES[key].some((alias) => wordMatch(geo, alias))) return key;
  }
  return null;
}

function regionForState(code: string): string | null {
  for (const [region, states] of Object.entries(REGION_STATES)) {
    if (states.includes(code)) return region;
  }
  return null;
}

const formatM = (v: number): string =>
  Number.isInteger(v) ? `$${v}M` : `$${v.toFixed(1)}M`;

function formatBand(min: number | null, max: number | null): string {
  if (min != null && max != null) return `${formatM(min)}–${formatM(max)}`;
  if (min != null) return `${formatM(min)}+`;
  if (max != null) return `up to ${formatM(max)}`;
  return "unset";
}

/** "a, b and c" with an overflow tail. */
function listPhrase(items: string[], max: number): string {
  const clean = items.map((s) => s.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  const shown = clean.slice(0, max);
  const extra = clean.length - shown.length;
  let phrase: string;
  if (shown.length === 1) phrase = shown[0];
  else phrase = `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return extra > 0 ? `${phrase} (+${extra} more)` : phrase;
}

/** Placeholder firm/investor types that carry no meaning in a sentence. */
const GENERIC_TYPES = new Set(["other", "others", "unknown", "n/a", "na", "tbd", "misc", "general"]);

const meaningfulType = (raw: string | null | undefined): string | null => {
  const t = (raw ?? "").trim();
  if (!t || GENERIC_TYPES.has(t.toLowerCase())) return null;
  return t;
};

const article = (word: string): string => (/^[aeiou]/i.test(word.trim()) ? "an" : "a");

// ─────────────────────────────────────────────────────────────────────────────
// Analyst-facing blurb — who is this firm again?
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-to-two sentence reminder of who a partner is, built ONLY from fields
 * already on the record. Deterministic and free: no LLM, no network, safe to
 * call on every render.
 *
 * If partner.profile_summary is populated (see the optional LLM pass) that text
 * wins; this is the always-available fallback.
 */
export function buildPartnerBlurb(
  partner: MatchablePartner,
  contacts: PartnerContactLite[] = [],
): string {
  if (partner.profile_summary && partner.profile_summary.trim()) {
    return partner.profile_summary.trim();
  }

  // Sentence 1 — identity, domicile, check size, footprint. Placeholder types
  // like "Other" are dropped rather than rendered as "is a Other".
  const firmType = meaningfulType(partner.firm_type);
  const investorTypes = (partner.investor_type ?? [])
    .map(meaningfulType)
    .filter(Boolean) as string[];
  const kind = firmType ?? (investorTypes.length ? investorTypes.join(" / ") : null);
  const clauses: string[] = [
    kind ? `${partner.name} is ${article(kind)} ${kind}` : `${partner.name} is a capital partner`,
  ];
  if (partner.headquarters) clauses.push(`based in ${partner.headquarters}`);
  const { min, max } = partnerBand(partner);
  const band = formatBand(min, max);
  if (band !== "unset") clauses.push(`writing ${band} equity checks`);
  const geos = (partner.geography ?? []).filter(Boolean);
  if (geos.length) clauses.push(`investing across ${listPhrase(geos, 3)}`);
  const first = `${clauses.join(", ")}.`;

  // Sentence 2 — mandate and who to call.
  const bits: string[] = [];
  const strategies = (Object.keys(PARTNER_STRATEGY_FIELD) as StrategyKey[])
    .filter((k) => partner[PARTNER_STRATEGY_FIELD[k]] === true)
    .map((k) => STRATEGY_LABEL[k]);
  if (strategies.length) bits.push(`Targets ${listPhrase(strategies, 4)}`);
  const products = (partner.product_types ?? []).filter(Boolean);
  if (products.length) bits.push(`product focus ${listPhrase(products, 3)}`);
  const holds = (partner.hold_period ?? []).filter(Boolean);
  if (holds.length) bits.push(`hold ${listPhrase(holds, 2)}`);

  const leaders = contacts
    .filter((c) => c.name && c.role && SENIOR_ROLE_RE.test(c.role))
    .slice(0, 2)
    .map((c) => `${c.name} (${c.role})`);
  const fallbackContacts = contacts.filter((c) => c.name).slice(0, 2).map((c) => c.name);
  const people = leaders.length ? leaders : fallbackContacts;
  if (people.length) bits.push(`key contacts ${people.join(", ")}`);

  if (!bits.length) return first;
  const second = bits.join("; ");
  return `${first} ${second.charAt(0).toUpperCase()}${second.slice(1)}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Result shapes
// ─────────────────────────────────────────────────────────────────────────────

export type PillarKey = "check_size" | "strategy" | "geography";
export type Confidence = "high" | "medium" | "low" | "insufficient";
export type MatchTier = "Strong" | "Moderate" | "Weak" | "Unrated";
export type GateKey = "avoid_list" | "check_size";

const MISSING_LABELS: Record<PillarKey, string> = {
  check_size: "Check size unset",
  geography: "Geography unset",
  strategy: "Strategy focus unspecified",
};

export interface PillarResult {
  key: PillarKey;
  weight: number;
  /** null = not applicable; excluded from the denominator. */
  points: number | null;
  reasons: string[];
  misses: string[];
  /** Set when the gap is on the partner record and a user could fill it in. */
  missingField?: PillarKey;
}

export interface NotesResult {
  adjustment: number;
  reasons: string[];
  misses: string[];
}

export interface MatchCoverage {
  pillarsCovered: number;
  pillarsTotal: number;
  weightCoveredPct: number;
}

export interface PartnerMatch {
  partner: MatchablePartner;
  /** 0..100. Meaningful only when `confidence !== "insufficient"`. */
  score: number;
  /** Score before the notes adjustment, for explainability. */
  baseScore: number;
  notesAdjustment: number;
  tier: MatchTier;
  confidence: Confidence;
  coverage: MatchCoverage;
  pillars: PillarResult[];
  reasons: string[];
  misses: string[];
  missingFields: PillarKey[];
  warmthRank: number;
  /** True when a hard gate disqualified this partner. */
  gated: boolean;
  gateKey?: GateKey;
  gateReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pillar scorers
// ─────────────────────────────────────────────────────────────────────────────

/** Normalize a partner's stated band, tolerating half-populated / inverted data. */
export function partnerBand(partner: MatchablePartner): { min: number | null; max: number | null } {
  let min = typeof partner.min_equity_m === "number" ? partner.min_equity_m : null;
  let max = typeof partner.max_equity_m === "number" ? partner.max_equity_m : null;
  if (min != null && max != null && min > max) [min, max] = [max, min];
  return { min, max };
}

export function scoreCheckSize(
  deal: MatchableDeal,
  partner: MatchablePartner,
): PillarResult & { gate?: { key: GateKey; reason: string } } {
  const weight = MATCH_WEIGHTS.checkSize;
  const base: PillarResult = { key: "check_size", weight, points: null, reasons: [], misses: [] };
  const { min, max } = partnerBand(partner);
  const equity = typeof deal.estimated_equity === "number" ? deal.estimated_equity : null;

  // Partner side unknown — not applicable, but flag it as fillable.
  if (min == null && max == null) {
    return { ...base, missingField: "check_size", misses: [MISSING_LABELS.check_size] };
  }
  // Deal side unknown — not applicable, and say so rather than scoring 0 silently.
  if (equity == null) {
    return { ...base, misses: ["Deal equity not set — check size not scored"] };
  }

  const band = formatBand(min, max);
  const lo = min ?? 0;
  const hi = max ?? Number.POSITIVE_INFINITY;

  if (equity >= lo && equity <= hi) {
    return { ...base, points: weight * CHECK_CREDIT.inBand, reasons: [`Check size in band (${band})`] };
  }
  const nearLo = min != null ? min * CHECK_BANDS.nearLow : 0;
  const nearHi = max != null ? max * CHECK_BANDS.nearHigh : Number.POSITIVE_INFINITY;
  if (equity >= nearLo && equity <= nearHi) {
    return { ...base, points: weight * CHECK_CREDIT.near, reasons: [`Check size near band (${band})`] };
  }
  const stretchLo = min != null ? min * CHECK_BANDS.stretchLow : 0;
  const stretchHi = max != null ? max * CHECK_BANDS.stretchHigh : Number.POSITIVE_INFINITY;
  if (equity >= stretchLo && equity <= stretchHi) {
    return { ...base, points: weight * CHECK_CREDIT.stretch, reasons: [`Check size a stretch (${band})`] };
  }

  const direction = equity > stretchHi ? "too large for" : "too small for";
  return {
    ...base,
    points: 0,
    misses: [`Check size out of range — deal needs ${formatM(equity)}, partner writes ${band}`],
    gate: {
      key: "check_size",
      reason: `${formatM(equity)} is ${direction} this partner's ${band} range`,
    },
  };
}

export function scoreStrategy(
  partner: MatchablePartner,
  dealStrategies: ReadonlySet<StrategyKey>,
): PillarResult {
  const weight = MATCH_WEIGHTS.strategy;
  const base: PillarResult = { key: "strategy", weight, points: null, reasons: [], misses: [] };
  const keys = Object.keys(PARTNER_STRATEGY_FIELD) as StrategyKey[];
  const flags = keys.filter((k) => partner[PARTNER_STRATEGY_FIELD[k]] === true);

  if (flags.length === 0) {
    return { ...base, missingField: "strategy", misses: [MISSING_LABELS.strategy] };
  }
  if (dealStrategies.size === 0) {
    return { ...base, misses: ["Deal strategy not set — strategy not scored"] };
  }
  // A partner flagged for everything genuinely covers the deal; it is just
  // uninformative. Half credit beats the old behaviour of scoring it zero.
  if (flags.length === keys.length) {
    return { ...base, points: weight * STRATEGY_CREDIT.generalist, reasons: ["Generalist mandate (all strategies)"] };
  }

  const overlap = flags.filter((k) => dealStrategies.has(k));
  if (overlap.length === 0) {
    return {
      ...base,
      points: 0,
      misses: [`No strategy overlap — partner does ${flags.map((k) => STRATEGY_LABEL[k]).join(", ")}`],
    };
  }
  const fraction = overlap.length / Math.min(dealStrategies.size, flags.length);
  return {
    ...base,
    points: weight * Math.min(1, fraction),
    reasons: [`Strategy: ${overlap.map((k) => STRATEGY_LABEL[k]).join(", ")}`],
  };
}

export function scoreGeography(
  deal: MatchableDeal,
  partner: MatchablePartner,
  notesGeoInterest: string[] = [],
): PillarResult & { gate?: { key: GateKey; reason: string } } {
  const weight = MATCH_WEIGHTS.geography;
  const base: PillarResult = { key: "geography", weight, points: null, reasons: [], misses: [] };

  const stateCode = resolveStateCode(deal.state);
  const city = norm(deal.city);
  const msa = norm(deal.msa);
  const dealPlaces = [city, ...(msa ? msaParts(msa) : [])].filter(Boolean);
  const hasDealGeo = Boolean(stateCode || dealPlaces.length);

  // Avoid list is a hard gate — an explicit "we do not go there" should remove
  // the partner, not merely zero one pillar.
  const avoids = (partner.geography_avoid ?? []).map(norm).filter(Boolean);
  for (const avoid of avoids) {
    const hitState = stateCode ? geoMentionsState(avoid, stateCode) : false;
    const hitPlace = dealPlaces.some((p) => placeOverlap(avoid, p));
    if (hitState || hitPlace) {
      return {
        ...base,
        points: 0,
        misses: [`On partner avoid list (${avoid})`],
        gate: { key: "avoid_list", reason: `Partner explicitly avoids ${avoid}` },
      };
    }
  }

  const geos = (partner.geography ?? []).map(norm).filter(Boolean);
  if (geos.length === 0) {
    return { ...base, missingField: "geography", misses: [MISSING_LABELS.geography] };
  }
  if (!hasDealGeo) {
    return { ...base, misses: ["Deal location not set — geography not scored"] };
  }

  if (geos.some((g) => NATIONAL_RE.test(g))) {
    return { ...base, points: weight * GEO_CREDIT.exact, reasons: ["National mandate"] };
  }
  for (const g of geos) {
    const hit = dealPlaces.find((p) => placeOverlap(g, p));
    if (hit) {
      const label = hit === city ? "City" : "MSA";
      return { ...base, points: weight * GEO_CREDIT.exact, reasons: [`${label} matches (${hit})`] };
    }
  }
  if (stateCode && geos.some((g) => geoMentionsState(g, stateCode))) {
    return { ...base, points: weight * GEO_CREDIT.exact, reasons: [`State matches (${stateCode.toUpperCase()})`] };
  }
  const dealRegion = stateCode ? regionForState(stateCode) : null;
  if (dealRegion && geos.some((g) => detectRegion(g) === dealRegion)) {
    return {
      ...base,
      points: weight * GEO_CREDIT.region,
      reasons: [`Regional match (${REGION_LABEL[dealRegion]})`],
    };
  }

  const stated = geos.slice(0, 3).join(", ");
  // Unstructured evidence can partially rescue a structured miss, so the card
  // never shows "interested in chicago" and "geography mismatch" side by side.
  if (notesGeoInterest.length > 0) {
    return {
      ...base,
      points: weight * GEO_CREDIT.notesOnly,
      reasons: [`Not in stated geography, but notes cite ${notesGeoInterest.join(", ")}`],
    };
  }
  return {
    ...base,
    points: weight * GEO_CREDIT.mismatch,
    misses: [`Geography mismatch — partner focuses on ${stated}`],
  };
}

/**
 * Notes adjustment in percentage points, deduplicated by (direction, term) so
 * a restated sentence — or the same signal appearing in both additional_notes
 * and the LLM-rewritten organized_notes — cannot fire twice.
 */
export function scoreNotes(
  deal: MatchableDeal,
  partner: MatchablePartner,
  dealNotesText: string,
): NotesResult & { geoInterest: string[] } {
  const reasons: string[] = [];
  const misses: string[] = [];
  const geoInterest: string[] = [];
  const seen = new Set<string>();
  let pts = 0;

  // Deal-side notes mention the partner (fires at most once).
  const hay = norm(dealNotesText);
  const partnerName = norm(partner.name);
  if (hay && partnerName) {
    if (wordMatch(hay, partnerName)) {
      pts += NOTES_POINTS.partnerNamedInDeal;
      reasons.push("Named in deal notes");
    } else {
      const generic = ["group", "capital", "partners", "advisors", "financial", "management"];
      const distinctive = tokens(partnerName).filter((t) => t.length >= 5 && !generic.includes(t));
      if (distinctive.some((t) => wordMatch(hay, t))) {
        pts += NOTES_POINTS.partnerReferencedInDeal;
        reasons.push("Referenced in deal notes");
      }
    }
  }

  const partnerNotes = [partner.additional_notes ?? "", partner.organized_notes ?? ""]
    .filter(Boolean)
    .join("\n");

  // Search notes for the state's full NAME, never its 2-letter code — "il" is
  // too short to match safely, so a bare code would silently never fire.
  const stateCode = resolveStateCode(deal.state);
  const stateName = stateCode ? STATE_CODE_TO_NAME[stateCode] : null;
  const geoTerms = Array.from(
    new Set(
      [norm(deal.city), ...(deal.msa ? msaParts(deal.msa) : []), norm(stateName)].filter(
        (s) => s.length >= 3,
      ),
    ),
  );

  if (partnerNotes && geoTerms.length) {
    const sentences = partnerNotes.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
    let interestTotal = 0;
    let avoidTotal = 0;
    for (const sentence of sentences) {
      const hit = geoTerms.find((t) => wordMatch(sentence, t));
      if (!hit) continue;
      // AVOID is tested first so "not interested in Chicago" reads as negative.
      if (AVOID_RE.test(sentence)) {
        const key = `avoid:${hit}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (avoidTotal > NOTES_POINTS.geoAvoidCap) {
          avoidTotal += NOTES_POINTS.geoAvoid;
          pts += NOTES_POINTS.geoAvoid;
          misses.push(`Notes: avoids ${hit}`);
        }
      } else if (INTEREST_RE.test(sentence)) {
        const key = `interest:${hit}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (interestTotal < NOTES_POINTS.geoInterestCap) {
          interestTotal += NOTES_POINTS.geoInterest;
          pts += NOTES_POINTS.geoInterest;
          reasons.push(`Notes: interested in ${hit}`);
          geoInterest.push(hit);
        }
      }
    }
  }

  const rating = typeof deal.school_rating === "number" ? deal.school_rating : null;
  if (partnerNotes && rating != null && rating <= 4) {
    const sentences = partnerNotes.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
    if (sentences.some((s) => SCHOOL_CONCERN_RE.test(s) && AVOID_RE.test(s))) {
      pts += NOTES_POINTS.schoolConcern;
      misses.push("Notes: partner avoids weak school districts");
    }
  }

  const swing = MATCH_WEIGHTS.notesSwing;
  return { adjustment: Math.max(-swing, Math.min(swing, pts)), reasons, misses, geoInterest };
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite
// ─────────────────────────────────────────────────────────────────────────────

function classifyConfidence(weightCoveredPct: number): Confidence {
  if (weightCoveredPct >= CONFIDENCE_THRESHOLDS.high) return "high";
  if (weightCoveredPct >= CONFIDENCE_THRESHOLDS.medium) return "medium";
  if (weightCoveredPct >= CONFIDENCE_THRESHOLDS.low) return "low";
  return "insufficient";
}

function classifyTier(score: number, confidence: Confidence): MatchTier {
  if (confidence === "insufficient") return "Unrated";
  if (score >= TIER_THRESHOLDS.strong) return "Strong";
  if (score >= TIER_THRESHOLDS.moderate) return "Moderate";
  return "Weak";
}

export function scorePartnerMatch(
  deal: MatchableDeal,
  partner: MatchablePartner,
  dealNotesText: string,
  dealStrategies: ReadonlySet<StrategyKey>,
): PartnerMatch {
  const notes = scoreNotes(deal, partner, dealNotesText);
  const check = scoreCheckSize(deal, partner);
  const strategy = scoreStrategy(partner, dealStrategies);
  const geography = scoreGeography(deal, partner, notes.geoInterest);

  const pillars: PillarResult[] = [check, strategy, geography];
  const applicable = pillars.filter((p) => p.points != null);
  const earned = applicable.reduce((sum, p) => sum + (p.points as number), 0);
  const available = applicable.reduce((sum, p) => sum + p.weight, 0);
  const totalWeight = pillars.reduce((sum, p) => sum + p.weight, 0);

  const baseScore = available > 0 ? (earned / available) * 100 : 0;
  const score = Math.max(0, Math.min(100, Math.round(baseScore + notes.adjustment)));

  const coverage: MatchCoverage = {
    pillarsCovered: applicable.length,
    pillarsTotal: pillars.length,
    weightCoveredPct: totalWeight > 0 ? available / totalWeight : 0,
  };
  const confidence = classifyConfidence(coverage.weightCoveredPct);

  const gate = check.gate ?? geography.gate;

  return {
    partner,
    score,
    baseScore: Math.round(baseScore),
    notesAdjustment: notes.adjustment,
    tier: classifyTier(score, confidence),
    confidence,
    coverage,
    pillars,
    reasons: [...pillars.flatMap((p) => p.reasons), ...notes.reasons],
    misses: [...pillars.flatMap((p) => p.misses), ...notes.misses],
    missingFields: pillars.map((p) => p.missingField).filter(Boolean) as PillarKey[],
    warmthRank: WARMTH_RANK[partner.relationship_strength ?? ""] ?? 0,
    gated: Boolean(gate),
    gateKey: gate?.key,
    gateReason: gate?.reason,
  };
}

export interface RankOptions {
  minScore?: number;
  /** Include hard-gated partners in `matches` instead of splitting them out. */
  includeGated?: boolean;
}

export interface RankedMatches {
  matches: PartnerMatch[];
  /** Disqualified by a hard gate. Surfaced with a count — never dropped silently. */
  gated: PartnerMatch[];
  /** Passed the gates but fell below `minScore`. */
  belowThreshold: PartnerMatch[];
}

/**
 * Deterministic ordering: fit score, then relationship warmth as the
 * tiebreaker, then name. The previous scorer sorted on score alone, so ties
 * fell back to whatever order the query returned.
 */
export function compareMatches(a: PartnerMatch, b: PartnerMatch): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.warmthRank !== a.warmthRank) return b.warmthRank - a.warmthRank;
  return a.partner.name.localeCompare(b.partner.name);
}

export function rankPartnerMatches(
  deal: MatchableDeal,
  partners: readonly MatchablePartner[],
  dealNotesText: string,
  dealStrategies: ReadonlySet<StrategyKey>,
  options: RankOptions = {},
): RankedMatches {
  const minScore = options.minScore ?? 0;
  const scored = partners.map((p) => scorePartnerMatch(deal, p, dealNotesText, dealStrategies));

  const gated: PartnerMatch[] = [];
  const belowThreshold: PartnerMatch[] = [];
  const matches: PartnerMatch[] = [];

  for (const m of scored) {
    if (m.gated && !options.includeGated) {
      gated.push(m);
    } else if (m.score < minScore) {
      belowThreshold.push(m);
    } else {
      matches.push(m);
    }
  }

  matches.sort(compareMatches);
  gated.sort(compareMatches);
  belowThreshold.sort(compareMatches);
  return { matches, gated, belowThreshold };
}

/** Pre-fill deal strategy from the deal record; the user confirms before matching. */
export function defaultDealStrategies(deal: {
  value_add_potential?: string | null;
  affordable?: boolean | null;
}): Set<StrategyKey> {
  const s = new Set<StrategyKey>();
  if (deal.value_add_potential && ["High", "Medium"].includes(deal.value_add_potential)) s.add("value_add");
  if (deal.affordable) s.add("affordable");
  return s;
}

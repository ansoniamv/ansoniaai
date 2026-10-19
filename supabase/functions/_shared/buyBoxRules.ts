// Ansonia buy box, as flags — and the score adjustment those flags force.
//
// Pure, so it can be unit tested and run identically in the edge function and
// the browser.
//
// The weighted pillar score (dealScoreEngine) ranks deals but does not know the
// buybox: it scored Georgia, Kentucky and Missouri deals at 100. The buybox is
// therefore applied ON the score, not beside it — applyBuyBox caps the number
// and the tier, and deducts per flag, so a deal outside the box can never read
// as a 100.
//
// Every rule reports one of these verdicts:
//
//   green    — explicitly favoured
//   pass     — meets the box
//   yellow   — meets it with a caveat; de-prioritise, do not screen out
//   red      — a disqualifying miss
//   no-data  — the field is absent, so the rule was NOT evaluated
//
// "no-data" is a verdict rather than a silent skip because a rule that cannot be
// evaluated has to say so. It does not count against a deal, with two
// exceptions: a deal cannot be Strong without a confirmed target-market location
// and a known unit count, the two facts the box turns on.

export type Verdict = "green" | "pass" | "yellow" | "red" | "no-data";

export type Flag = {
  rule: string;
  verdict: Verdict;
  detail: string;
  /** Location only: which of the two yellow cases this is. The cap treats them differently. */
  code?: "outside_market" | "market_unconfirmed";
};

export type BuyBoxDeal = {
  unit_count?: number | null;
  vintage_year?: number | null;
  asset_class?: string | null;
  strategy?: string | null;
  number_stories?: number | null;
  is_affordable_housing?: boolean | null;
  state?: string | null;
  msa?: string | null;
  city?: string | null;
  /**
   * Free text about the subject property (subject line, summary, extracted
   * notes). Building class, affordability, product type and renovation share
   * are not extracted fields, so they are read from here.
   */
  text?: string | null;
};

// --- Target markets -----------------------------------------------------------
//
// Each MSA is matched on its principal cities plus the suburbs around it — the
// buybox says "or the surrounding areas around them" — and only in the states it
// actually covers. Without the state check Columbus GA, Madison AL, Arlington VA
// and Aurora MO all read as target markets.
//
// A city in a target state that is NOT on these lists is outside the box
// (Houston, Milwaukee, Peoria, Provo, Cincinnati), not "unconfirmed".

const cities = (...names: string[]) =>
  new RegExp(`\\b(?:${names.map((s) => s.replace(/[.]/g, "\\.?").replace(/ /g, "[\\s-]+")).join("|")})\\b`, "i");

const TARGET_MSAS: Array<{ label: string; re: RegExp; states: string[] }> = [
  {
    label: "Chicago",
    states: ["IL"],
    re: cities(
      "chicago", "naperville", "elgin", "aurora", "joliet", "schaumburg", "evanston", "arlington heights",
      "palatine", "oak park", "oak brook", "oak lawn", "orland park", "tinley park", "bolingbrook",
      "downers grove", "wheaton", "lombard", "glen ellyn", "carol stream", "hoffman estates", "des plaines",
      "mount prospect", "mt. prospect", "skokie", "park ridge", "buffalo grove", "wheeling", "northbrook",
      "glenview", "deerfield", "highland park", "lake forest", "libertyville", "mundelein", "vernon hills",
      "waukegan", "gurnee", "north chicago", "crystal lake", "mchenry", "st. charles", "saint charles",
      "geneva", "batavia", "west chicago", "warrenville", "lisle", "woodridge", "westmont", "darien",
      "plainfield", "romeoville", "lockport", "homer glen", "oswego", "yorkville", "montgomery",
      "north aurora", "elmhurst", "addison", "bloomingdale", "roselle", "itasca", "wood dale", "bensenville",
      "villa park", "lansing", "calumet city", "harvey", "matteson", "frankfort", "mokena", "new lenox",
      "cicero", "berwyn", "burbank", "bridgeview", "lemont", "willowbrook", "hinsdale", "la grange",
      "rolling meadows", "streamwood", "bartlett", "hanover park", "elk grove village", "algonquin",
      "lake in the hills", "huntley", "carpentersville", "south elgin", "round lake", "grayslake",
      "lake zurich", "niles", "morton grove", "lincolnwood", "rosemont", "schiller park", "franklin park",
      "melrose park", "maywood", "westchester", "countryside", "hickory hills", "palos heights", "palos hills",
      "oak forest", "midlothian", "blue island", "chicago heights", "park forest", "richton park", "homewood",
      "flossmoor", "country club hills", "hazel crest", "shorewood", "minooka", "channahon", "morris",
    ),
  },
  // The Chicago MSA's Indiana and Wisconsin counties, listed apart so an
  // Illinois suburb name cannot match a Wisconsin town (Geneva vs Lake Geneva).
  {
    label: "Chicago",
    states: ["IN"],
    re: cities(
      "hammond", "gary", "merrillville", "crown point", "valparaiso", "hobart", "munster", "schererville",
      "highland", "portage", "east chicago", "chesterton", "dyer", "st. john", "saint john", "cedar lake",
      "lake station", "griffith", "lowell",
    ),
  },
  {
    label: "Chicago",
    states: ["WI"],
    re: cities("kenosha", "pleasant prairie", "chicago"),
  },
  {
    label: "Columbus OH",
    states: ["OH"],
    re: cities(
      "columbus", "dublin", "westerville", "worthington", "hilliard", "grove city", "gahanna", "reynoldsburg",
      "upper arlington", "new albany", "grandview heights", "bexley", "whitehall", "pickerington",
      "canal winchester", "groveport", "lewis center", "powell", "delaware", "marysville", "lancaster",
      "newark", "pataskala", "sunbury", "galena", "plain city", "obetz", "london", "circleville", "blacklick",
      "lockbourne", "heath", "granville", "etna", "johnstown", "ashville", "commercial point", "galloway",
    ),
  },
  {
    label: "Madison WI",
    states: ["WI"],
    re: cities(
      "madison", "middleton", "fitchburg", "sun prairie", "verona", "monona", "waunakee", "mcfarland",
      "stoughton", "oregon", "deforest", "de forest", "cottage grove", "mount horeb", "mt. horeb",
      "cross plains", "maple bluff", "shorewood hills", "windsor", "portage", "columbus", "lodi", "poynette",
      "monroe", "new glarus", "dodgeville", "mineral point", "belleville",
    ),
  },
  {
    label: "Austin",
    states: ["TX"],
    re: cities(
      "austin", "round rock", "san marcos", "georgetown", "pflugerville", "cedar park", "leander", "kyle",
      "buda", "hutto", "taylor", "lakeway", "bee cave", "manor", "dripping springs", "liberty hill", "lockhart",
      "bastrop", "elgin", "wimberley", "west lake hills", "rollingwood", "jarrell", "sunset valley",
      "del valle", "lago vista", "smithville", "luling",
    ),
  },
  {
    label: "Dallas–Fort Worth",
    states: ["TX"],
    re: cities(
      "dallas", "fort worth", "ft. worth", "arlington", "dfw", "plano", "frisco", "mckinney", "irving",
      "garland", "grand prairie", "mesquite", "carrollton", "richardson", "denton", "lewisville", "allen",
      "flower mound", "mansfield", "rowlett", "euless", "bedford", "hurst", "grapevine", "coppell", "keller",
      "north richland hills", "wylie", "rockwall", "the colony", "little elm", "prosper", "celina", "anna",
      "princeton", "forney", "cedar hill", "desoto", "duncanville", "lancaster", "burleson", "weatherford",
      "cleburne", "haltom city", "watauga", "saginaw", "southlake", "colleyville", "addison",
      "farmers branch", "sachse", "murphy", "midlothian", "waxahachie", "ennis", "red oak", "glenn heights",
      "balch springs", "seagoville", "terrell", "royse city", "fate", "heath", "azle", "crowley", "benbrook",
      "white settlement", "lake worth", "richland hills", "aledo", "granbury", "corinth", "highland village",
      "argyle", "aubrey", "roanoke", "melissa", "fairview", "lucas", "sunnyvale", "hutchins", "wilmer",
      "kennedale", "everman", "forest hill", "university park", "highland park",
    ),
  },
  {
    label: "Denver",
    states: ["CO"],
    re: cities(
      "denver", "aurora", "centennial", "lakewood", "thornton", "arvada", "westminster", "broomfield",
      "littleton", "englewood", "highlands ranch", "parker", "castle rock", "castle pines", "commerce city",
      "northglenn", "brighton", "wheat ridge", "golden", "lone tree", "greenwood village", "louisville",
      "lafayette", "boulder", "longmont", "federal heights", "sheridan", "glendale", "edgewater", "erie",
      "superior", "elizabeth", "bennett", "evergreen", "conifer", "ken caryl", "columbine", "morrison",
    ),
  },
  {
    label: "Salt Lake City",
    states: ["UT"],
    re: cities(
      "salt lake", "west valley", "west jordan", "sandy", "south jordan", "murray", "taylorsville", "draper",
      "riverton", "herriman", "midvale", "cottonwood heights", "holladay", "millcreek", "south salt lake",
      "kearns", "magna", "bluffdale", "tooele", "grantsville", "north salt lake", "bountiful", "woods cross",
      "centerville", "farmington", "kaysville", "layton", "lehi", "saratoga springs", "eagle mountain",
      "american fork",
    ),
  },
];

/** The Carolinas qualify wholesale, so state alone is enough. */
const TARGET_STATES = new Set(["NC", "SC"]);
/** States containing a target MSA. */
const MSA_STATES = new Set(["IL", "IN", "WI", "OH", "TX", "CO", "UT"]);

const STATE_NAMES: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA", COLORADO: "CO",
  CONNECTICUT: "CT", DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID",
  ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME",
  MARYLAND: "MD", MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO",
  MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH",
  OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA",
  WASHINGTON: "WA", "WEST VIRGINIA": "WV", WISCONSIN: "WI", WYOMING: "WY", "DISTRICT OF COLUMBIA": "DC",
};

/** Two-letter code from "TX", "Texas", or the tail of an msa like "Dallas-Fort Worth, TX". */
function stateCode(state: string, msa: string): string {
  const s = state.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(s)) return s;
  if (STATE_NAMES[s]) return STATE_NAMES[s];
  const tail = msa.match(/,\s*([A-Z]{2})(?:[-–][A-Z]{2})*\s*(?:MSA)?\s*$/);
  return tail ? tail[1] : "";
}

// --- Asset type ---------------------------------------------------------------

/** Always-avoid structures and opportunities, wherever they are mentioned. */
const ALWAYS_AVOID_TEXT: Array<[RegExp, string]> = [
  [/\b(?:development (?:site|opportunity|parcel)|land (?:sale|parcel|site)|entitled (?:land|site)|shovel[- ]ready|proposed development)\b/i, "development / land opportunity"],
  [/\b(?:net[- ]lease[d]?|nnn|triple[- ]net|single[- ]tenant)\b/i, "single-tenant / net lease"],
];

const AFFORDABLE =
  /\b(?:lihtc|tax[- ]credit|section[- ]?8|hap contract|project[- ]based|affordable housing|affordability|income[- ]restricted|rent[- ]restricted|% ami|ami\b|hud\b|workforce housing|lura\b|extended use)/i;

const URBAN_PRODUCT = /\b(?:high[- ]rise|mid[- ]rise|urban infill|podium)\b/i;
const GARDEN_PRODUCT = /\bgarden\b/i;

const n = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Garden-style or not. Storeys beat text; text beats nothing. Null means
 * unknown, which the vintage rule treats as garden — the dominant product here.
 */
function isLowRise(d: BuyBoxDeal, text: string): boolean | null {
  const s = n(d.number_stories);
  if (s != null) return s <= 3;
  if (URBAN_PRODUCT.test(text)) return false;
  if (GARDEN_PRODUCT.test(text)) return true;
  return null;
}

/** Share of units still to renovate, if the text states it as a percentage. */
function unrenovatedPct(text: string): number | null {
  const classic = text.match(/(\d{1,3})\s*%\s*(?:of\s+(?:the\s+)?units?\s+)?(?:are\s+|remain\s+|in\s+)?(?:classic|unrenovated|original|un-renovated)/i);
  if (classic) return Math.min(100, Number(classic[1]));
  const done = text.match(/(\d{1,3})\s*%\s*(?:of\s+(?:the\s+)?(?:units?\s+)?)?(?:units?\s+)?(?:have\s+been\s+|already\s+|were\s+|previously\s+|are\s+)?(?:renovated|upgraded|updated)/i);
  if (done) return Math.max(0, 100 - Math.min(100, Number(done[1])));
  return null;
}

export function evaluateBuyBox(d: BuyBoxDeal): Flag[] {
  const flags: Flag[] = [];
  const text = (d.text ?? "").replace(/\s+/g, " ");
  const strat = (d.strategy ?? "").trim();
  const valueAdd = /value[- ]?add|opportunistic/i.test(strat);

  // --- Unit count ---------------------------------------------------------
  const units = n(d.unit_count);
  if (units == null) flags.push({ rule: "Unit count", verdict: "no-data", detail: "no unit count" });
  else if (units < 100) flags.push({ rule: "Unit count", verdict: "red", detail: `${units} units — under 100` });
  else if (units < 150) flags.push({ rule: "Unit count", verdict: "yellow", detail: `${units} units — under 150` });
  else flags.push({ rule: "Unit count", verdict: "pass", detail: `${units} units` });

  // --- Asset type ---------------------------------------------------------
  // Must be multifamily. Mixed-use is multifamily over retail often enough to
  // stay in, with a caveat; anything else that is not multifamily is red.
  const ac = (d.asset_class ?? "").trim();
  if (!ac) flags.push({ rule: "Asset type", verdict: "no-data", detail: "asset class not recorded" });
  else if (/multi|apartment/i.test(ac)) flags.push({ rule: "Asset type", verdict: "pass", detail: ac });
  else if (/mixed/i.test(ac)) flags.push({ rule: "Asset type", verdict: "yellow", detail: `${ac} — not pure multifamily` });
  else flags.push({ rule: "Asset type", verdict: "red", detail: `${ac} — not multifamily` });

  // --- Always avoid -------------------------------------------------------
  // Development, land, single-tenant and net lease are disqualifying whichever
  // field carries them.
  if (/development|land/i.test(strat)) {
    flags.push({ rule: "Always avoid", verdict: "red", detail: `strategy is ${strat}` });
  } else {
    const hit = ALWAYS_AVOID_TEXT.find(([re]) => re.test(text));
    if (hit) flags.push({ rule: "Always avoid", verdict: "red", detail: hit[1] });
  }

  // --- Building class -----------------------------------------------------
  // Class B is preferred. Class A is fine only with value-add upside; Class C
  // is fine unless it carries significant deferred maintenance.
  const classes = new Set([...text.matchAll(/\bclass[- ]?([abc])\b/gi)].map((m) => m[1].toUpperCase()));
  if (!classes.size) flags.push({ rule: "Building class", verdict: "no-data", detail: "class not stated" });
  else if (classes.has("B")) flags.push({ rule: "Building class", verdict: "pass", detail: "Class B — preferred" });
  else if (classes.has("A")) {
    const upside = valueAdd || /value[- ]?add|upside|renovat|upgrade/i.test(text);
    flags.push(upside
      ? { rule: "Building class", verdict: "pass", detail: "Class A with value-add upside" }
      : { rule: "Building class", verdict: "yellow", detail: "Class A — no value-add upside stated" });
  } else {
    flags.push(/deferred maintenance|capital needs|heavy (?:lift|rehab)|distress/i.test(text)
      ? { rule: "Building class", verdict: "yellow", detail: "Class C — significant deferred maintenance" }
      : { rule: "Building class", verdict: "pass", detail: "Class C" });
  }

  // --- Affordable ---------------------------------------------------------
  // Any affordability component is a green flag: expiring LIHTC, project-based
  // Section 8, income restrictions.
  const aff = d.is_affordable_housing === true ? "affordability component" : text.match(AFFORDABLE)?.[0];
  if (aff) flags.push({ rule: "Affordable", verdict: "green", detail: `affordability component (${aff.trim()})` });

  // --- Vintage ------------------------------------------------------------
  // The band applies to garden-style/suburban product. Older vintage is fine for
  // urban infill and high-rise, so known non-garden product is exempt. Unknown
  // product type is treated as garden-style, and the detail says so.
  const yr = n(d.vintage_year);
  const low = isLowRise(d, text);
  if (yr == null) {
    flags.push({ rule: "Vintage", verdict: "no-data", detail: "no year built" });
  } else if (low === false) {
    const what = n(d.number_stories) != null ? `${d.number_stories} storeys` : "mid/high-rise or urban infill";
    flags.push({ rule: "Vintage", verdict: "pass", detail: `${yr} — ${what}: older vintage acceptable` });
  } else {
    const assumed = low == null ? " (product type unknown, treated as garden-style)" : "";
    if (yr < 1980) flags.push({ rule: "Vintage", verdict: "red", detail: `${yr} — pre-1980${assumed}` });
    else if (yr < 1990) flags.push({ rule: "Vintage", verdict: "yellow", detail: `${yr} — 1980s${assumed}` });
    else flags.push({ rule: "Vintage", verdict: "pass", detail: `${yr}` });
  }

  // --- Investment profile -------------------------------------------------
  if (/development|land/i.test(strat)) {
    // Already red under Always avoid; not double-counted here.
  } else if (!strat) flags.push({ rule: "Investment profile", verdict: "no-data", detail: "strategy not recorded" });
  else if (valueAdd) flags.push({ rule: "Investment profile", verdict: "pass", detail: strat });
  else if (/core/i.test(strat)) flags.push({ rule: "Investment profile", verdict: "yellow", detail: `${strat} — limited upside` });
  else flags.push({ rule: "Investment profile", verdict: "yellow", detail: `${strat} — not value-add` });

  // --- Renovation upside --------------------------------------------------
  const left = unrenovatedPct(text);
  if (left == null) flags.push({ rule: "Renovation upside", verdict: "no-data", detail: "renovated share not stated" });
  else if (left < 50) flags.push({ rule: "Renovation upside", verdict: "yellow", detail: `${left}% of units left to renovate — under 50%` });
  else flags.push({ rule: "Renovation upside", verdict: "pass", detail: `${left}% of units left to renovate` });

  // --- Location -----------------------------------------------------------
  // Out of area is a de-prioritisation, never a screen-out, so the worst this
  // can return is yellow — but outside_market drops the deal to Maybe.
  const msa = (d.msa ?? "").trim();
  const city = (d.city ?? "").trim();
  const st = stateCode(d.state ?? "", msa);
  const where = [city || msa, st].filter(Boolean).join(", ");
  const hit = st ? TARGET_MSAS.find((m) => m.states.includes(st) && (m.re.test(msa) || m.re.test(city))) : undefined;

  if (TARGET_STATES.has(st)) flags.push({ rule: "Location", verdict: "pass", detail: `${st} — Carolinas` });
  else if (hit) flags.push({ rule: "Location", verdict: "pass", detail: `${hit.label} MSA` });
  else if (!msa && !city && !st) flags.push({ rule: "Location", verdict: "no-data", detail: "no location" });
  else if (st && !MSA_STATES.has(st)) {
    flags.push({ rule: "Location", verdict: "yellow", code: "outside_market", detail: `${where} — outside target markets` });
  } else if (st ? !msa && !city : TARGET_MSAS.some((m) => m.re.test(msa) || m.re.test(city))) {
    // A target state with no city or msa, or a target-sounding place with no
    // state — and a place name alone is ambiguous (Columbus GA, Aurora MO).
    flags.push({ rule: "Location", verdict: "yellow", code: "market_unconfirmed", detail: `${where} — market not confirmed` });
  } else {
    // A known place that is not one of ours: Houston TX, Milwaukee WI, Atlanta.
    flags.push({ rule: "Location", verdict: "yellow", code: "outside_market", detail: `${where} — outside target markets` });
  }

  return flags;
}

/** Worst verdict present, for a single headline per deal. */
export function overallVerdict(flags: Flag[]): Verdict {
  if (flags.some((f) => f.verdict === "red")) return "red";
  if (flags.some((f) => f.verdict === "yellow")) return "yellow";
  if (flags.some((f) => f.verdict === "green")) return "green";
  return flags.some((f) => f.verdict === "pass") ? "pass" : "no-data";
}

/**
 * Share of rules that could actually be judged.
 *
 * Reported next to any score, because a deal judged on three rules and one
 * judged on eight are not comparable, and the number alone hides the difference.
 */
export function coverage(flags: Flag[]): { evaluated: number; total: number } {
  const total = flags.length;
  const evaluated = flags.filter((f) => f.verdict !== "no-data").length;
  return { evaluated, total };
}

export type Tier = "strong" | "medium" | "maybe" | "skip";
const TIER_RANK: Record<Tier, number> = { strong: 0, medium: 1, maybe: 2, skip: 3 };
const TIER_NAME: Record<Tier, string> = { strong: "Strong", medium: "Medium", maybe: "Maybe", skip: "Skip" };

/** Highest score each tier allows. Mirrors tierFromScore in dealScoreEngine (75 / 55 / 35). */
export const TIER_CEILING: Record<Tier, number> = { strong: 100, medium: 74, maybe: 54, skip: 34 };
/** Lowest score of the Maybe tier: the floor for anything the buybox de-prioritises but does not screen out. */
const MAYBE_FLOOR = 35;
export const RED_PENALTY = 10;
export const YELLOW_PENALTY = 5;
export const GREEN_BONUS = 5;

function tierOf(score: number): Tier {
  if (score >= 75) return "strong";
  if (score >= 55) return "medium";
  if (score >= 35) return "maybe";
  return "skip";
}

/**
 * The highest tier the buybox allows this deal, and why:
 *
 *   not multifamily / always-avoid           → Skip
 *   outside target markets                   → Maybe (the buybox's "lower
 *                                               recommendation bucket")
 *   any other red flag                       → Maybe
 *   any yellow flag                          → Medium
 *   location or unit count unknown           → Medium (Strong has to be earned)
 */
export function buyBoxCeiling(flags: Flag[]): { ceiling: Tier; reasons: string[] } {
  let ceiling: Tier = "strong";
  let reasons: string[] = [];
  const lower = (to: Tier, why: string) => {
    if (TIER_RANK[to] > TIER_RANK[ceiling]) { ceiling = to; reasons = [why]; }
    else if (to === ceiling && ceiling !== "strong") reasons.push(why);
  };

  for (const f of flags) {
    if (f.verdict === "red" && (f.rule === "Asset type" || f.rule === "Always avoid")) lower("skip", f.detail);
    else if (f.verdict === "red") lower("maybe", f.detail);
    else if (f.code === "outside_market") lower("maybe", f.detail);
    else if (f.verdict === "yellow") lower("medium", f.detail);
    else if (f.verdict === "no-data" && f.rule === "Location") lower("medium", "location unknown");
    else if (f.verdict === "no-data" && f.rule === "Unit count") lower("medium", "unit count unknown");
  }
  return { ceiling, reasons };
}

export type BuyBoxResult = {
  /** The fit score after the buybox: what is stored and shown. */
  score: number | null;
  tier: Tier | null;
  /** True when the buybox lowered the score. */
  adjusted: boolean;
  ceiling: Tier;
  reasons: string[];
};

/**
 * Apply the buybox to a pillar score.
 *
 * 1. Cap the score at the ceiling tier's maximum — an out-of-market deal can
 *    score at most 54, so it can never read as a 100.
 * 2. Deduct per flag (red 10, yellow 5) and add per green (5), within the cap,
 *    so deals inside the same bucket still rank by how many misses they carry.
 * 3. Never push a deal below Maybe on buybox grounds alone unless it is an
 *    always-avoid: out-of-box deals are de-prioritised, not screened out. A
 *    pillar score that was already low stays low.
 *
 * The tier is read off the adjusted score, so the two always agree.
 */
export function applyBuyBox(rawScore: number | null, flags: Flag[]): BuyBoxResult {
  const { ceiling, reasons } = buyBoxCeiling(flags);
  if (rawScore == null) return { score: null, tier: null, adjusted: false, ceiling, reasons };

  const max = TIER_CEILING[ceiling];
  const count = (v: Verdict) => flags.filter((f) => f.verdict === v).length;
  let s = Math.min(rawScore, max) - RED_PENALTY * count("red") - YELLOW_PENALTY * count("yellow") + GREEN_BONUS * count("green");
  s = Math.min(s, max);
  if (ceiling !== "skip") s = Math.max(s, Math.min(rawScore, MAYBE_FLOOR));
  const score = Math.round(Math.max(0, Math.min(100, s)));

  // Every miss is a reason when the binding level is Strong (only greens moved it).
  const allMisses = flags.filter((f) => f.verdict === "red" || f.verdict === "yellow").map((f) => f.detail);
  return {
    score,
    tier: tierOf(score),
    adjusted: score < rawScore,
    ceiling,
    reasons: reasons.length ? reasons : allMisses,
  };
}

/** One line for the deal card, e.g. "Buybox → Maybe (49): Kansas City, MO — outside target markets." */
export function buyBoxNote(r: BuyBoxResult): string {
  return `Buybox → ${TIER_NAME[r.tier ?? "skip"]} (${r.score}): ${r.reasons.join("; ")}.`;
}

/** An inbox_deals row in buybox terms. Inbox rows have no storeys or affordability flag. */
export function inboxBuyBoxDeal(d: {
  units?: number | null;
  year_built?: number | null;
  asset_class?: string | null;
  strategy?: string | null;
  location_state?: string | null;
  location_city?: string | null;
  msa?: string | null;
  property_name?: string | null;
  email_subject?: string | null;
  email_thread_summary?: string | null;
  other_details?: string | null;
}): BuyBoxDeal {
  return {
    unit_count: d.units ?? null,
    vintage_year: d.year_built ?? null,
    asset_class: d.asset_class ?? null,
    strategy: d.strategy ?? null,
    state: d.location_state ?? null,
    city: d.location_city ?? null,
    msa: d.msa ?? null,
    // The summary, not the raw body: the body carries signatures, disclaimers
    // and other listings, which would trip the text rules on someone else's deal.
    text: [d.property_name, d.email_subject, d.email_thread_summary, d.other_details].filter(Boolean).join("\n"),
  };
}

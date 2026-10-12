// Ansonia buy box, as flags.
//
// Pure, so it can be unit tested and run identically in the edge function and
// the browser.
//
// Flags sit ALONGSIDE the score rather than replacing it. The score ranks; the
// flags say why. A deal reading "61, red: 84 units" is actionable in a way that
// "61" is not, and a red flag is visible even when the arithmetic happens to
// land somewhere respectable.
//
// Every rule reports one of five verdicts, and the last two matter as much as
// the first three:
//
//   green    — explicitly favoured
//   pass     — meets the box
//   yellow   — meets it with a caveat; de-prioritise, do not screen out
//   red      — a disqualifying miss
//   no-data  — the field is absent, so the rule was NOT evaluated
//   stale    — the field exists but describes the wrong location
//
// "no-data" is a verdict rather than a silent skip because of what happened to
// the previous scorer: six of its eight factors had no data on any deal, the
// weights renormalised over the two that did, and every deal scored on
// property fundamentals alone while reading like a considered judgement. A rule
// that cannot be evaluated has to say so.

export type Verdict = "green" | "pass" | "yellow" | "red" | "no-data" | "stale";

export type Flag = {
  rule: string;
  verdict: Verdict;
  detail: string;
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
  median_income_tract?: number | null;
  population_growth_pct?: number | null;
  new_supply_pct_of_stock?: number | null;
  job_growth_pct?: number | null;
  esri_enrichment_stale?: boolean | null;
};

/** Target MSAs. Matched loosely because msa strings vary by source. */
const TARGET_MSA_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "Chicago", re: /chicago|naperville|elgin/i },
  { label: "Columbus OH", re: /columbus/i },
  { label: "Madison WI", re: /madison/i },
  { label: "Austin", re: /austin|round rock|san marcos/i },
  { label: "Dallas–Fort Worth", re: /dallas|fort worth|arlington/i },
  { label: "Denver", re: /denver|aurora|centennial/i },
  { label: "Salt Lake City", re: /salt lake/i },
];

/** The Carolinas qualify wholesale, so state alone is enough. */
const TARGET_STATES = new Set(["NC", "SC"]);
/** States containing a target MSA — the fallback when msa is absent. */
const MSA_STATES = new Set(["IL", "OH", "WI", "TX", "CO", "UT"]);

const NON_MULTIFAMILY = /office|retail|industrial|hospitality|hotel|land|development|net ?lease|single[- ]tenant/i;

const n = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Garden-style proxy. HelloData storeys beat parsing "garden-style" from copy. */
function isLowRise(d: BuyBoxDeal): boolean | null {
  const s = n(d.number_stories);
  return s == null ? null : s <= 3;
}

export function evaluateBuyBox(d: BuyBoxDeal): Flag[] {
  const flags: Flag[] = [];
  const stale = d.esri_enrichment_stale === true;

  // --- Unit count ---------------------------------------------------------
  const units = n(d.unit_count);
  if (units == null) flags.push({ rule: "Unit count", verdict: "no-data", detail: "no unit count" });
  else if (units < 100) flags.push({ rule: "Unit count", verdict: "red", detail: `${units} units — under 100` });
  else if (units < 150) flags.push({ rule: "Unit count", verdict: "yellow", detail: `${units} units — under 150` });
  else flags.push({ rule: "Unit count", verdict: "pass", detail: `${units} units` });

  // --- Asset type / always avoid ------------------------------------------
  const ac = (d.asset_class ?? "").trim();
  const strat = (d.strategy ?? "").trim();
  if (!ac) flags.push({ rule: "Asset type", verdict: "no-data", detail: "asset class not recorded" });
  else if (NON_MULTIFAMILY.test(ac)) flags.push({ rule: "Asset type", verdict: "red", detail: `${ac} — not multifamily` });
  else if (/multi/i.test(ac)) flags.push({ rule: "Asset type", verdict: "pass", detail: ac });
  else flags.push({ rule: "Asset type", verdict: "yellow", detail: `${ac} — not clearly multifamily` });

  // Development is disqualifying whichever field carries it.
  if (/development|land/i.test(strat)) {
    flags.push({ rule: "Always avoid", verdict: "red", detail: `strategy is ${strat}` });
  }

  // --- Vintage ------------------------------------------------------------
  // The band applies to garden-style/suburban product. Older vintage is fine for
  // urban infill, so a known high-rise is exempt. When storeys are unknown the
  // band is still applied — garden-style is the dominant product type here — and
  // the detail says so, rather than silently exempting an unknown.
  const yr = n(d.vintage_year);
  const low = isLowRise(d);
  if (yr == null) {
    flags.push({ rule: "Vintage", verdict: "no-data", detail: "no year built" });
  } else if (low === false) {
    flags.push({ rule: "Vintage", verdict: "pass", detail: `${yr} — ${d.number_stories} storeys, urban infill: older vintage acceptable` });
  } else {
    const assumed = low == null ? " (construction type unknown, treated as garden-style)" : "";
    if (yr < 1980) flags.push({ rule: "Vintage", verdict: "red", detail: `${yr} — pre-1980${assumed}` });
    else if (yr < 1990) flags.push({ rule: "Vintage", verdict: "yellow", detail: `${yr} — 1980s${assumed}` });
    else flags.push({ rule: "Vintage", verdict: "pass", detail: `${yr}` });
  }

  // --- Investment profile -------------------------------------------------
  if (!strat) flags.push({ rule: "Investment profile", verdict: "no-data", detail: "strategy not recorded" });
  else if (/value[- ]?add|opportunistic/i.test(strat)) flags.push({ rule: "Investment profile", verdict: "pass", detail: strat });
  else if (/core/i.test(strat)) flags.push({ rule: "Investment profile", verdict: "yellow", detail: `${strat} — limited upside` });
  else flags.push({ rule: "Investment profile", verdict: "yellow", detail: strat });

  // --- Location -----------------------------------------------------------
  // Out of area is a de-prioritisation, never a screen-out, so the worst this
  // can return is yellow.
  const st = (d.state ?? "").trim().toUpperCase();
  const msa = (d.msa ?? "").trim();
  const hit = TARGET_MSA_PATTERNS.find((m) => m.re.test(msa) || (!msa && m.re.test(d.msa ?? "")));
  if (TARGET_STATES.has(st)) flags.push({ rule: "Location", verdict: "pass", detail: `${st} — Carolinas` });
  else if (hit) flags.push({ rule: "Location", verdict: "pass", detail: `${hit.label} MSA` });
  else if (!msa && !st) flags.push({ rule: "Location", verdict: "no-data", detail: "no location" });
  else if (!msa && MSA_STATES.has(st)) flags.push({ rule: "Location", verdict: "yellow", detail: `${st} — target state, MSA unknown` });
  else flags.push({ rule: "Location", verdict: "yellow", detail: `${msa || st} — outside target markets` });

  // --- Affordable ---------------------------------------------------------
  if (d.is_affordable_housing === true) {
    flags.push({ rule: "Affordable", verdict: "green", detail: "affordability component" });
  }

  // --- Market rules, all derived from Esri rings --------------------------
  // A corrected pin invalidates them: the rings were measured around the old
  // point. Reporting the number anyway would rank a deal on the demographics of
  // a neighbourhood it is not in.
  const market = (rule: string, value: number | null, judge: (v: number) => Flag) => {
    if (stale) { flags.push({ rule, verdict: "stale", detail: "location corrected — enrichment pending" }); return; }
    if (value == null) { flags.push({ rule, verdict: "no-data", detail: "not enriched" }); return; }
    flags.push(judge(value));
  };

  market("Median income", n(d.median_income_tract), (v) =>
    v < 55000
      ? { rule: "Median income", verdict: "red", detail: `$${Math.round(v).toLocaleString()} — below $55k` }
      : { rule: "Median income", verdict: "pass", detail: `$${Math.round(v).toLocaleString()}` });

  market("Population growth", n(d.population_growth_pct), (v) =>
    v < 0
      ? { rule: "Population growth", verdict: "red", detail: `${v.toFixed(1)}% — declining` }
      : { rule: "Population growth", verdict: "pass", detail: `${v.toFixed(1)}%` });

  market("New supply", n(d.new_supply_pct_of_stock), (v) =>
    v > 5
      ? { rule: "New supply", verdict: "red", detail: `${v.toFixed(1)}% of stock — above 5%` }
      : { rule: "New supply", verdict: "pass", detail: `${v.toFixed(1)}% of stock` });

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
 * judged on nine are not comparable, and the number alone hides the difference.
 */
export function coverage(flags: Flag[]): { evaluated: number; total: number } {
  const total = flags.length;
  const evaluated = flags.filter((f) => f.verdict !== "no-data" && f.verdict !== "stale").length;
  return { evaluated, total };
}

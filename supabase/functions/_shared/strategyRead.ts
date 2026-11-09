/**
 * What a partner's notes say about each strategy bucket. Pure: shared by
 * read-partner-strategies (prompt, schema, validation) and the tests.
 *
 * Why notes and not the checkboxes: the team ticks Core+ on partners who would
 * only look at a Core+ deal, so nobody is left out of a search on a deal on the
 * Core+ / Value-Add line. That makes the box a "don't exclude" flag, not
 * evidence of money. The notes say who actually has the money — Prospect Ridge
 * runs a separate Core-Plus/Yield fund; that is a different answer from a box.
 */
import { matchQuote } from "./quoteMatch.ts";

export const STRATEGY_BUCKETS = ["core_plus", "value_add", "opportunistic", "workforce", "affordable"] as const;
export type StrategyBucket = (typeof STRATEGY_BUCKETS)[number];

export const BUCKET_LABEL: Record<StrategyBucket, string> = {
  core_plus: "Core+",
  value_add: "Value-Add",
  opportunistic: "Opportunistic",
  workforce: "Workforce",
  affordable: "Affordable",
};

/**
 * dedicated — a fund, vehicle, sleeve or allocation specifically for this strategy.
 * active    — the notes say they invest in it now: target returns, recent deals, a stated mandate.
 * open      — they would consider it, or it appears in a list of strategies with nothing more.
 * none      — the notes do not speak to it.
 * avoids    — the notes say they don't do it, or passed on deals for being it.
 */
export const LEVELS = ["dedicated", "active", "open", "none", "avoids"] as const;
export type Level = (typeof LEVELS)[number];

export type BucketRead = { level: Level; quote: string | null; reason: string | null };
export type StrategyReads = Record<StrategyBucket, BucketRead>;

/** Notes are capped so one 18k-character partner cannot dominate the bill. */
export const MAX_NOTES_CHARS = 12000;

export function notesText(p: { organized_notes?: string | null; additional_notes?: string | null }): string {
  return [p.organized_notes, p.additional_notes]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_NOTES_CHARS);
}

const bucketSchema = {
  type: "object",
  additionalProperties: false,
  required: ["level", "quote", "reason"],
  properties: {
    level: { type: "string", enum: [...LEVELS] },
    quote: { type: ["string", "null"] },
    reason: { type: ["string", "null"] },
  },
};

export const READ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...STRATEGY_BUCKETS],
  properties: Object.fromEntries(STRATEGY_BUCKETS.map((b) => [b, bucketSchema])),
};

export function buildReadPrompt(name: string, notes: string): string {
  return [
    `You are reading an acquisitions team's notes on a capital partner, "${name}", to judge how strong a source of capital they are for each multifamily strategy.`,
    "",
    "For each strategy, choose one level:",
    '- "dedicated": the notes name a fund, vehicle, sleeve, program or allocation specifically for this strategy (e.g. "a separate core-plus/yield fund", "our affordable fund").',
    '- "active": the notes say they invest in this strategy now — target returns for it, recent deals of this kind, or a clearly stated current mandate.',
    '- "open": they would consider it, or it appears in a list of strategies with nothing more behind it.',
    '- "none": the notes do not speak to it.',
    '- "avoids": the notes say they do not do it, or that they passed on deals for being this kind.',
    "",
    "Strategies:",
    "- core_plus: Core / Core+ / yield / stabilized, lower-risk income deals.",
    "- value_add: Value-add, renovation, repositioning.",
    "- opportunistic: Opportunistic, development, distressed, heavy lift, rescue capital.",
    "- workforce: Workforce housing (naturally affordable, unsubsidized).",
    "- affordable: Affordable housing with rent restrictions: LIHTC, Section 8, HAP.",
    "",
    "Rules:",
    "- Use only what the notes say. Never infer from the firm's name or what firms like it usually do.",
    '- "quote" is required for every level except "none": copy the exact words from the notes that support it, one sentence or line, unchanged. If you cannot quote it, the level is "none".',
    '- "reason" is one short sentence an analyst would read, e.g. "Runs a separate open-ended Core-Plus/Yield fund." Null for "none".',
    "- Where notes conflict, prefer the more recent or more specific statement.",
    "",
    "Notes:",
    "<<<",
    notes,
    ">>>",
  ].join("\n");
}

const NONE: BucketRead = { level: "none", quote: null, reason: null };

/**
 * Validate the model's answer against the notes it was given. A level the notes
 * do not back with a quote we can find is downgraded to "none": the page tells
 * people where each rating came from, so a rating with no line behind it is
 * worse than no rating.
 */
export function interpretReads(raw: unknown, notes: string): { reads: StrategyReads; dropped: StrategyBucket[] } {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const dropped: StrategyBucket[] = [];
  const reads = {} as StrategyReads;
  for (const b of STRATEGY_BUCKETS) {
    const r = obj[b];
    const level: Level | null = r && LEVELS.includes(r.level) ? r.level : null;
    if (!level || level === "none") {
      reads[b] = NONE;
      continue;
    }
    const quote = typeof r.quote === "string" ? r.quote.trim() : "";
    const hit = quote ? matchQuote(notes, quote) : null;
    if (!hit) {
      reads[b] = NONE;
      dropped.push(b);
      continue;
    }
    reads[b] = {
      level,
      // Store the notes' own words, not the model's copy of them.
      quote: notes.slice(hit.start, hit.end).trim(),
      reason: typeof r.reason === "string" && r.reason.trim() ? r.reason.trim() : null,
    };
  }
  return { reads, dropped };
}

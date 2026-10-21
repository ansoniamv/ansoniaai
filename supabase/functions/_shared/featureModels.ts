// Per-feature model selection.
//
// Each feature reads its own env var so a model change is a secrets change, not
// a redeploy — the same pattern DEAL_INBOX_MODEL established. The defaults below
// are what the platform runs on if nothing is set.
//
// The split is by SHAPE OF WORK, not by importance:
//   Haiku 4.5  — extraction and classification against a fixed contract, where
//                the answer is in the input and the job is to find it.
//   Sonnet 5   — summarising and judging, where wording and nuance matter.
//   Opus 5.5   — open-ended reasoning over the whole pipeline (Ask Atlas).
//
// One hard constraint worth knowing before editing any of these: Haiku 4.5 does
// NOT accept output_config.effort. _shared/anthropic.ts drops the parameter for
// models that reject it (see supportsEffort), so a call site passing
// effort: "low" is safe on any of these — but that is the mechanism holding it
// up, not luck.

/** Gate classifier: four fields against a schema, one call per inbox row. */
export const GATE_MODEL = Deno.env.get("GATE_MODEL") ?? "claude-haiku-4-5";

/** Atlas directive parsing: intent + two names out of an email. */
export const ATLAS_MODEL = Deno.env.get("ATLAS_MODEL") ?? "claude-haiku-4-5";

/** Ask Atlas: open-ended questions over deals, partners and mail. */
export const CHAT_MODEL = Deno.env.get("CHAT_MODEL") ?? "claude-opus-5-5";

/**
 * Suggested pass reason in the Deny dialog. Someone is waiting on it with the
 * dialog open, so latency matters more than polish: one sentence from fields
 * already on the row.
 */
export const DENY_REASON_MODEL = Deno.env.get("DENY_REASON_MODEL") ?? "claude-haiku-4-5";

/**
 * Deal documents: stated figures out of an OM, rent roll or T12.
 *
 * Sonnet, not Haiku, despite this being extraction: the figures sit in wide
 * tables flattened to CSV, often with two-row headers. On the Summerlin rent
 * roll Haiku read the "Market Rent" column as "Lease Charges" twice, proposing
 * market rent as in-place rent. Cost is a few cents a document.
 */
export const DEAL_DOCS_MODEL = Deno.env.get("DEAL_DOCS_MODEL") ?? "claude-sonnet-5";

/**
 * Data Room: summarising a source and compiling the Company Brief. Sonnet, as
 * for the partner summaries: the brief is read by every other feature, so its
 * wording matters, and it is rebuilt only when someone asks.
 */
export const DATA_ROOM_MODEL = Deno.env.get("DATA_ROOM_MODEL") ?? "claude-sonnet-5";

/** Partner summaries, enrichment and the learning loops. */
export const PARTNER_MODEL = Deno.env.get("PARTNER_MODEL") ?? "claude-sonnet-5";

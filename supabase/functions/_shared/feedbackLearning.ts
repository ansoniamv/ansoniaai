// Which deal_feedback rows still count for learning.
//
// deal_feedback is append-only (RLS allows insert, not update/delete), so a
// reversed decision cannot be edited away. Instead the latest row per inbox deal
// wins: a "restore" supersedes the "deny" before it, and a later re-deny
// supersedes the restore. A duplicate pass (the deal is already in the pipeline)
// says nothing about fit, so it ends the deal's history without counting as a
// denial. Pure — imported by edge functions and the frontend.

export type FeedbackRow = {
  inbox_deal_id: string | null;
  action: string;
  category?: string | null;
  created_at: string;
};

export const LEARNING_ACTIONS = ["deny", "restore"] as const;

export const DUPLICATE_CATEGORY = "Duplicate / Already in Pipeline";

/**
 * How many deal_feedback rows to FETCH before filtering.
 *
 * Every consumer used to take a small window of raw rows and filter afterwards,
 * which meant duplicate passes crowded out real ones. Measured on live data:
 * of the 100 most recent deny/restore rows, 96 were duplicates, leaving the
 * learned strategy distilled from 4 decisions. gate-deals, on a 50-row window,
 * also saw 4. Meanwhile 286 denials existed across 8 categories.
 *
 * The perverse part is that it got worse as the pipeline got tidier: every
 * duplicate cleared pushed a real reason out of the window.
 *
 * This cannot be fixed by filtering duplicates in SQL. effectiveFeedback treats
 * the latest row per deal as the decision, and a duplicate pass deliberately
 * ENDS that deal's history — excluding those rows from the query would resurrect
 * an earlier denial the duplicate pass had superseded. So the window is widened
 * and the filtering stays where the supersede semantics live.
 *
 * At 500 the same data yields 168 usable denials instead of 4.
 */
export const FEEDBACK_SCAN_LIMIT = 500;

/** Cap on examples handed to a model after filtering, to bound prompt size. */
export const MAX_LEARNING_EXAMPLES = 100;

export function effectiveFeedback<T extends FeedbackRow>(rows: T[]): { denials: T[]; restores: T[] } {
  const newestFirst = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const seen = new Set<string>();
  const denials: T[] = [];
  const restores: T[] = [];
  for (const r of newestFirst) {
    if (r.inbox_deal_id) {
      if (seen.has(r.inbox_deal_id)) continue;
      seen.add(r.inbox_deal_id);
    }
    if (r.action === "deny") {
      if (r.category !== DUPLICATE_CATEGORY) denials.push(r);
    }
    else if (r.action === "restore") restores.push(r);
  }
  return { denials, restores };
}

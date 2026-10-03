// Which deal_feedback rows still count for learning.
//
// deal_feedback is append-only (RLS allows insert, not update/delete), so a
// reversed decision cannot be edited away. Instead the latest row per inbox deal
// wins: a "restore" supersedes the "deny" before it, and a later re-deny
// supersedes the restore. Pure — imported by edge functions and the frontend.

export type FeedbackRow = {
  inbox_deal_id: string | null;
  action: string;
  created_at: string;
};

export const LEARNING_ACTIONS = ["deny", "restore"] as const;

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
    if (r.action === "deny") denials.push(r);
    else if (r.action === "restore") restores.push(r);
  }
  return { denials, restores };
}

/**
 * Recognises a summary_error that is the AI spend cap refusing the call, not a
 * failure. The text is BudgetExceededError's message from
 * supabase/functions/_shared/aiBudget.ts, which is the only thing that writes
 * it, so keep the two in step.
 *
 * A refusal is not a property of the deal: nothing was wrong with the emails,
 * the model was never asked, and Retry is refused the same way until the cap
 * resets. Showing it as "Summary failed" sent people retrying a deal that
 * could not succeed.
 */
export type BudgetPause = { scope: "daily" | "monthly" };

const BUDGET_RE = /^(Daily|Monthly) AI budget reached:/;

export function budgetPause(summaryError: string | null | undefined): BudgetPause | null {
  const m = summaryError ? BUDGET_RE.exec(summaryError) : null;
  if (!m) return null;
  return { scope: m[1] === "Daily" ? "daily" : "monthly" };
}

// The in-app spend cap.
//
// WHY THIS EXISTS, and why the numbers are what they are: the Anthropic Console
// account has a hard $100 limit, and hitting that kills every AI feature at once
// with no warning and no partial degradation. This cap has to trip first, so it
// is deliberately set below it — $90/month — and the day cap keeps a single bad
// afternoon from spending the month.
//
// This is the SECOND line of defence, not the only one. It can only govern calls
// that route through it, it reads an estimate rather than Anthropic's own
// accounting, and it cannot help if this code is wrong. The Console limit is the
// one that always holds.

export const DAILY_BUDGET_USD = Number(Deno.env.get("AI_DAILY_BUDGET_USD") ?? 3);
export const MONTHLY_BUDGET_USD = Number(Deno.env.get("AI_MONTHLY_BUDGET_USD") ?? 90);

/**
 * Who is waiting for this call.
 *
 * "background" — cron, fan-out, backfill, scheduled Atlas. Nobody is watching,
 *   so refusing costs nothing but a retry tomorrow. Gated by BOTH caps.
 * "interactive" — a user clicked something and is looking at a spinner. Gated by
 *   the monthly cap only, so a busy morning of background work cannot make the
 *   product look broken to someone using it.
 */
export type CallPriority = "background" | "interactive";

/** Functions whose spend is exempt from the DAILY cap (still counts monthly). */
const DAILY_EXEMPT = (Deno.env.get("AI_DAILY_EXEMPT_FUNCTIONS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

export class BudgetExceededError extends Error {
  constructor(
    readonly scope: "daily" | "monthly",
    readonly spentUsd: number,
    readonly limitUsd: number,
  ) {
    super(
      scope === "daily"
        ? `Daily AI budget reached: $${spentUsd.toFixed(2)} of $${limitUsd.toFixed(2)}. ` +
          `Background jobs pause until 00:00 UTC; anything you click still works.`
        : `Monthly AI budget reached: $${spentUsd.toFixed(2)} of $${limitUsd.toFixed(2)}. ` +
          `All AI features are paused until the limit is raised or the month rolls over.`,
    );
    this.name = "BudgetExceededError";
  }
}

type Totals = { today: number; month: number };
let cache: { at: number; totals: Totals } | null = null;
const TTL_MS = 60_000;

/**
 * Current spend, cached for 60s.
 *
 * Without the cache this is a round trip per model call, which on a 20-email
 * batch is 20 extra queries to decide something that cannot meaningfully change
 * between them. 60s is short enough that an overrun is bounded by roughly one
 * minute of spend.
 */
export async function getSpend(supabase: any): Promise<Totals> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.totals;
  try {
    const { data, error } = await supabase.rpc("ai_spend_totals", {
      exempt_function_names: DAILY_EXEMPT,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const totals = {
      today: Number(row?.today_usd ?? 0),
      month: Number(row?.month_usd ?? 0),
    };
    cache = { at: Date.now(), totals };
    return totals;
  } catch (e) {
    // Fail OPEN, loudly. A broken spend query must not take every AI feature
    // down with it — the Console limit is still underneath us. This is the one
    // place where availability beats the cap, and it is logged so it cannot be
    // the silent reason a bill ran over.
    console.error("[aiBudget] spend lookup failed, allowing the call:", String(e));
    return { today: 0, month: 0 };
  }
}

/**
 * Throws BudgetExceededError when this call should not be made.
 * No-op when supabase is absent — a caller with no client cannot be metered,
 * and silently allowing is better than throwing on a missing argument.
 */
export async function assertWithinBudget(
  supabase: any,
  priority: CallPriority = "background",
): Promise<void> {
  if (!supabase) return;
  const { today, month } = await getSpend(supabase);

  if (month >= MONTHLY_BUDGET_USD) {
    throw new BudgetExceededError("monthly", month, MONTHLY_BUDGET_USD);
  }
  if (priority === "background" && today >= DAILY_BUDGET_USD) {
    throw new BudgetExceededError("daily", today, DAILY_BUDGET_USD);
  }
}

/** Drop the cached figure — call after a known-large spend so the next check is fresh. */
export function invalidateSpendCache(): void {
  cache = null;
}

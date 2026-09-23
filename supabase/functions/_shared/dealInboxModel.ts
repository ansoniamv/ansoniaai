// The single switch for which model the Deal Inbox workflow (/pipeline) runs on:
// email summary + field extraction, the vision pass, the thread roll-up, the
// gate classifier, the fit rationale and deal-score. Reading it from the
// environment means rolling back to claude-opus-5 is a secrets change, not a
// redeploy — and it stays separate from ANTHROPIC_MODEL, which is global and
// would move chat, Atlas and every other feature at the same time.
export const DEAL_INBOX_MODEL = Deno.env.get("DEAL_INBOX_MODEL") ?? "claude-sonnet-5";

-- Make AI-generation failures visible instead of indefinite "pending".
--
-- email_thread_summary and fit_rationale are both written only on success. When
-- the model call fails, the generator catches, console.errors, and returns null
-- — so the column stays null and the card shows "Summary pending…" forever (or,
-- for the rationale, renders nothing at all). There is no way to tell "queued"
-- from "failed" by looking at the row, which is why a dead LLM looked like a
-- slow one for a week.
--
-- These columns record the attempt so the UI can distinguish the three states:
--   summary IS NULL AND attempted_at IS NULL  -> genuinely pending
--   summary IS NULL AND error IS NOT NULL     -> failed, show it, offer retry
--   summary IS NOT NULL                       -> done
--
-- Purely additive: existing rows read as "pending", which is what they already
-- rendered as.

ALTER TABLE public.inbox_deals
  ADD COLUMN IF NOT EXISTS summary_error text,
  ADD COLUMN IF NOT EXISTS summary_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS rationale_error text,
  ADD COLUMN IF NOT EXISTS rationale_attempted_at timestamptz;

-- Partial indexes: the only queries that touch these look for the failures.
CREATE INDEX IF NOT EXISTS inbox_deals_summary_error_idx
  ON public.inbox_deals (summary_attempted_at DESC)
  WHERE summary_error IS NOT NULL;

CREATE INDEX IF NOT EXISTS inbox_deals_rationale_error_idx
  ON public.inbox_deals (rationale_attempted_at DESC)
  WHERE rationale_error IS NOT NULL;

COMMENT ON COLUMN public.inbox_deals.summary_error IS
  'Last email_thread_summary generation failure. NULL once a summary lands.';
COMMENT ON COLUMN public.inbox_deals.rationale_error IS
  'Last fit_rationale generation failure. NULL once a rationale lands.';

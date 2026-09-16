-- Make LLM failures observable from SQL.
--
-- ai_usage_log already has a `success` boolean, but logAiUsage is only ever
-- called AFTER a successful completeText return — so a failed model call writes
-- no row at all. That is why "no successes since Sep 10" could not be
-- distinguished from "no invocations since Sep 10", and why diagnosing the
-- pipeline cost three rounds of guessing.
--
-- These two columns give a failure row somewhere to put the one fact that
-- settles credit-vs-key-vs-model-id: the HTTP status the provider returned.

ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS http_status integer,
  ADD COLUMN IF NOT EXISTS error_text text;

-- The only queries that touch these are looking for the failures.
CREATE INDEX IF NOT EXISTS ai_usage_log_failures_idx
  ON public.ai_usage_log (created_at DESC)
  WHERE success = false;

COMMENT ON COLUMN public.ai_usage_log.http_status IS
  'Provider HTTP status on a failed call. NULL on success and for non-HTTP failures.';
COMMENT ON COLUMN public.ai_usage_log.error_text IS
  'Verbatim provider response body (truncated) on a failed call.';

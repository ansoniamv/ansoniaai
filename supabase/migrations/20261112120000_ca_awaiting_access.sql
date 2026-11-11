-- CA runs that signed but couldn't get into the deal room yet (the broker still
-- has to approve access, or the portal needs a login we hadn't saved). The
-- deal-agents sweep starts a fresh run when retry_at comes due: once a day for a
-- week, sooner when a portal email for the deal lands in the acquisitions inbox,
-- and right away when an admin saves the missing portal login.

ALTER TABLE public.deal_ca_runs DROP CONSTRAINT IF EXISTS deal_ca_runs_status_check;
ALTER TABLE public.deal_ca_runs ADD CONSTRAINT deal_ca_runs_status_check
  CHECK (status IN ('starting', 'running', 'needs_approval', 'needs_attention', 'awaiting_access',
                    'done', 'failed', 'cancelled', 'disabled', 'no_link'));

ALTER TABLE public.deal_ca_runs
  -- What result.json said (signed, awaiting_access, needs_login, ...); status is what the page shows.
  ADD COLUMN IF NOT EXISTS outcome     text,
  -- When the sweep should start the next try; null = no retry planned.
  ADD COLUMN IF NOT EXISTS retry_at    timestamptz,
  -- Retries stop after this; carried from run to run so a chain ends a week after it began.
  ADD COLUMN IF NOT EXISTS retry_until timestamptz,
  -- The earlier run this one retried.
  ADD COLUMN IF NOT EXISTS retry_of    uuid REFERENCES public.deal_ca_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS deal_ca_runs_retry_idx ON public.deal_ca_runs (retry_at) WHERE retry_at IS NOT NULL;

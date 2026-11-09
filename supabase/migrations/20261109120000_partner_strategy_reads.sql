-- Capital Intelligence: what each partner's notes say about each strategy.
--
-- The strategy checkboxes are ticked generously ("don't leave them out of a
-- Core+ search") so they cannot tell a partner with a dedicated Core+ fund from
-- one that would merely look at Core+. The notes can. read-partner-strategies
-- reads each partner's notes once, rates every strategy bucket, and keeps the
-- verbatim line it relied on. One row per partner; rewritten only when the
-- notes change (notes_hash), so the page never triggers a model call.

CREATE TABLE IF NOT EXISTS public.partner_strategy_reads (
  partner_id uuid PRIMARY KEY REFERENCES public.partners(id) ON DELETE CASCADE,
  -- { "core_plus": { "level": "dedicated", "quote": "...", "reason": "..." }, ... }
  -- level is one of: dedicated, active, open, none, avoids.
  reads jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes_hash text NOT NULL,
  model text,
  read_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.partner_strategy_reads IS
  'Per-strategy read of a partner''s notes (dedicated / active / open / none / avoids) with the quoted line. Written by read-partner-strategies only.';

ALTER TABLE public.partner_strategy_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "approved users can select" ON public.partner_strategy_reads;
CREATE POLICY "approved users can select" ON public.partner_strategy_reads
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));

GRANT SELECT ON public.partner_strategy_reads TO authenticated;
GRANT ALL ON public.partner_strategy_reads TO service_role;

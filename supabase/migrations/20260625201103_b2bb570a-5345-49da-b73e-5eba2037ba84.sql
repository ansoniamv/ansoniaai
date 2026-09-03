
ALTER TABLE public.inbox_deals
  ADD COLUMN IF NOT EXISTS denial_category text,
  ADD COLUMN IF NOT EXISTS denial_reason text,
  ADD COLUMN IF NOT EXISTS denied_by text,
  ADD COLUMN IF NOT EXISTS denied_at timestamptz;

CREATE TABLE IF NOT EXISTS public.deal_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_deal_id uuid REFERENCES public.inbox_deals(id) ON DELETE SET NULL,
  action text NOT NULL,
  category text,
  reason_text text,
  deal_snapshot jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_feedback TO authenticated;
GRANT ALL ON public.deal_feedback TO service_role;

ALTER TABLE public.deal_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read deal_feedback"
  ON public.deal_feedback FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert deal_feedback"
  ON public.deal_feedback FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS deal_feedback_inbox_deal_id_idx ON public.deal_feedback(inbox_deal_id);
CREATE INDEX IF NOT EXISTS deal_feedback_created_at_idx ON public.deal_feedback(created_at DESC);

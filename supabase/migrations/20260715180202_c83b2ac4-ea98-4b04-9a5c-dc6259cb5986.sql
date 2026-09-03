
-- 1) Extend outlook_messages
ALTER TABLE public.outlook_messages
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS analyzed_at timestamptz;

-- Backfill source from existing mailbox column if present
UPDATE public.outlook_messages
SET source = CASE WHEN mailbox = 'atlas' THEN 'atlas' ELSE 'personal' END
WHERE source IS DISTINCT FROM CASE WHEN mailbox = 'atlas' THEN 'atlas' ELSE 'personal' END;

CREATE INDEX IF NOT EXISTS idx_outlook_messages_source ON public.outlook_messages(source);
CREATE INDEX IF NOT EXISTS idx_outlook_messages_analyzed_at ON public.outlook_messages(analyzed_at);

-- 2) partner_suggestions table
CREATE TABLE IF NOT EXISTS public.partner_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL,
  deal_id uuid,
  engagement_id uuid,
  type text NOT NULL,
  field text,
  current_value jsonb,
  proposed_value jsonb NOT NULL,
  summary text NOT NULL,
  rationale text,
  evidence jsonb,
  confidence numeric,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_suggestions TO authenticated;
GRANT ALL ON public.partner_suggestions TO service_role;

ALTER TABLE public.partner_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read partner suggestions"
  ON public.partner_suggestions FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert partner suggestions"
  ON public.partner_suggestions FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update partner suggestions"
  ON public.partner_suggestions FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete partner suggestions"
  ON public.partner_suggestions FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_partner_suggestions_partner ON public.partner_suggestions(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_suggestions_status ON public.partner_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_partner_suggestions_created ON public.partner_suggestions(created_at DESC);

CREATE TRIGGER trg_partner_suggestions_updated_at
  BEFORE UPDATE ON public.partner_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

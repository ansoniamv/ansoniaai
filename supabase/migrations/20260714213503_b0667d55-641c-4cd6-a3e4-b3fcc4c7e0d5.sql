
ALTER TABLE public.outlook_messages
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS analyzed_at timestamptz;

CREATE INDEX IF NOT EXISTS outlook_messages_source_idx ON public.outlook_messages(source);
CREATE INDEX IF NOT EXISTS outlook_messages_analyzed_idx ON public.outlook_messages(source, analyzed_at) WHERE analyzed_at IS NULL;

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

CREATE POLICY "Authenticated can read suggestions"
  ON public.partner_suggestions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert suggestions"
  ON public.partner_suggestions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update suggestions"
  ON public.partner_suggestions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete suggestions"
  ON public.partner_suggestions FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS partner_suggestions_partner_status_idx
  ON public.partner_suggestions(partner_id, status);
CREATE INDEX IF NOT EXISTS partner_suggestions_status_created_idx
  ON public.partner_suggestions(status, created_at DESC);

CREATE TRIGGER update_partner_suggestions_updated_at
  BEFORE UPDATE ON public.partner_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

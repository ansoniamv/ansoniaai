
CREATE TABLE IF NOT EXISTS public.outlook_message_deals (
  message_id uuid NOT NULL REFERENCES public.outlook_messages(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, deal_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlook_message_deals TO authenticated;
GRANT ALL ON public.outlook_message_deals TO service_role;

ALTER TABLE public.outlook_message_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view outlook_message_deals"
  ON public.outlook_message_deals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert outlook_message_deals"
  ON public.outlook_message_deals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can delete outlook_message_deals"
  ON public.outlook_message_deals FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_outlook_message_deals_deal ON public.outlook_message_deals(deal_id);

-- Backfill from existing single-deal links
INSERT INTO public.outlook_message_deals (message_id, deal_id)
SELECT id, deal_id FROM public.outlook_messages
 WHERE deal_id IS NOT NULL
ON CONFLICT DO NOTHING;

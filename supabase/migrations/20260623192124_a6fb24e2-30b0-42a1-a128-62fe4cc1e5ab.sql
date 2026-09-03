-- 1. Add summary + count columns to inbox_deals
ALTER TABLE public.inbox_deals
  ADD COLUMN IF NOT EXISTS email_thread_summary text,
  ADD COLUMN IF NOT EXISTS email_count integer NOT NULL DEFAULT 1;

-- 2. Create deal_emails
CREATE TABLE IF NOT EXISTS public.deal_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.inbox_deals(id) ON DELETE CASCADE,
  email_message_id text UNIQUE NOT NULL,
  subject text,
  body text,
  received_at timestamptz,
  sender_email text,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_emails_deal_id_idx ON public.deal_emails(deal_id);
CREATE INDEX IF NOT EXISTS deal_emails_received_at_idx ON public.deal_emails(received_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_emails TO authenticated;
GRANT ALL ON public.deal_emails TO service_role;

ALTER TABLE public.deal_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read deal_emails"
  ON public.deal_emails FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert deal_emails"
  ON public.deal_emails FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update deal_emails"
  ON public.deal_emails FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete deal_emails"
  ON public.deal_emails FOR DELETE TO authenticated USING (true);

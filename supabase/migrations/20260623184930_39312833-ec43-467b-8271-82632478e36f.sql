
CREATE TABLE public.outlook_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT,
  subject TEXT,
  preview TEXT,
  body_html TEXT,
  body_text TEXT,
  from_email TEXT,
  from_name TEXT,
  to_recipients JSONB DEFAULT '[]'::jsonb,
  cc_recipients JSONB DEFAULT '[]'::jsonb,
  received_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  is_read BOOLEAN DEFAULT false,
  has_attachments BOOLEAN DEFAULT false,
  importance TEXT,
  web_link TEXT,
  folder TEXT,
  partner_contact_id UUID REFERENCES public.partner_contacts(id) ON DELETE SET NULL,
  partner_id UUID REFERENCES public.partners(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outlook_messages_received_at ON public.outlook_messages(received_at DESC);
CREATE INDEX idx_outlook_messages_from_email ON public.outlook_messages(from_email);
CREATE INDEX idx_outlook_messages_partner_contact_id ON public.outlook_messages(partner_contact_id);
CREATE INDEX idx_outlook_messages_partner_id ON public.outlook_messages(partner_id);
CREATE INDEX idx_outlook_messages_deal_id ON public.outlook_messages(deal_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlook_messages TO authenticated;
GRANT ALL ON public.outlook_messages TO service_role;

ALTER TABLE public.outlook_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view outlook messages" ON public.outlook_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert outlook messages" ON public.outlook_messages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update outlook messages" ON public.outlook_messages FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete outlook messages" ON public.outlook_messages FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_outlook_messages_updated_at BEFORE UPDATE ON public.outlook_messages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

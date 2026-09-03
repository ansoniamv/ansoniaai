
CREATE TABLE public.inbox_deals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_name TEXT,
  location_city TEXT,
  location_state TEXT,
  msa TEXT,
  broker_firm TEXT,
  broker_contact_name TEXT,
  broker_contact_email TEXT,
  units INTEGER,
  year_built INTEGER,
  asset_class TEXT,
  strategy TEXT,
  offers_due DATE,
  asking_price TEXT,
  fit_tier TEXT CHECK (fit_tier IN ('strong','medium','maybe','skip')),
  fit_score INTEGER,
  fit_rationale TEXT,
  other_details TEXT,
  email_received_at TIMESTAMPTZ,
  email_subject TEXT,
  email_body TEXT,
  email_message_id TEXT UNIQUE,
  source TEXT DEFAULT 'email',
  reviewed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inbox_deals_email_received_at ON public.inbox_deals(email_received_at DESC);
CREATE INDEX idx_inbox_deals_fit_tier ON public.inbox_deals(fit_tier);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbox_deals TO authenticated;
GRANT ALL ON public.inbox_deals TO service_role;

ALTER TABLE public.inbox_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view inbox deals" ON public.inbox_deals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert inbox deals" ON public.inbox_deals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update inbox deals" ON public.inbox_deals FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete inbox deals" ON public.inbox_deals FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_inbox_deals_updated_at BEFORE UPDATE ON public.inbox_deals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.daily_digests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  digest_date DATE NOT NULL UNIQUE,
  deal_count INTEGER NOT NULL DEFAULT 0,
  strong_count INTEGER NOT NULL DEFAULT 0,
  medium_count INTEGER NOT NULL DEFAULT 0,
  maybe_count INTEGER NOT NULL DEFAULT 0,
  skip_count INTEGER NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_digests TO authenticated;
GRANT ALL ON public.daily_digests TO service_role;

ALTER TABLE public.daily_digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view daily digests" ON public.daily_digests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert daily digests" ON public.daily_digests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update daily digests" ON public.daily_digests FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete daily digests" ON public.daily_digests FOR DELETE TO authenticated USING (true);

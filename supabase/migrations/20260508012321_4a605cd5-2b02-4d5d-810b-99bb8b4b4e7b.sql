ALTER TABLE public.deals DROP COLUMN IF EXISTS esri_enrichment;
ALTER TABLE public.deals DROP COLUMN IF EXISTS esri_last_synced_at;

CREATE TABLE public.deal_enrichment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'esri',
  address_used text,
  matched_address text,
  lat numeric,
  lon numeric,
  rings jsonb,
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deal_enrichment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read access" ON public.deal_enrichment FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.deal_enrichment FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.deal_enrichment FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.deal_enrichment FOR DELETE USING (true);

CREATE TRIGGER update_deal_enrichment_updated_at
BEFORE UPDATE ON public.deal_enrichment
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_deal_enrichment_deal_id ON public.deal_enrichment(deal_id);
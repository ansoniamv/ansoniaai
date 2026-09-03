
CREATE TABLE public.deal_pillar_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id UUID NOT NULL REFERENCES public.inbox_deals(id) ON DELETE CASCADE,
  pillar_key TEXT NOT NULL,
  pillar_name TEXT NOT NULL,
  pillar_weight INTEGER NOT NULL,
  pillar_subscore INTEGER,
  pillar_contribution NUMERIC,
  signals JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, pillar_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_pillar_scores TO authenticated;
GRANT ALL ON public.deal_pillar_scores TO service_role;

ALTER TABLE public.deal_pillar_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view deal pillar scores" ON public.deal_pillar_scores
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert deal pillar scores" ON public.deal_pillar_scores
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update deal pillar scores" ON public.deal_pillar_scores
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete deal pillar scores" ON public.deal_pillar_scores
  FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_deal_pillar_scores_deal_id ON public.deal_pillar_scores(deal_id);

-- 1. pass_category on engagements
ALTER TABLE public.capital_raise_engagements
  ADD COLUMN IF NOT EXISTS pass_category text;

-- 2. capital_partner_feedback
CREATE TABLE IF NOT EXISTS public.capital_partner_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid,
  deal_id uuid,
  engagement_id uuid,
  category text,
  reason_text text,
  price_surmountable boolean,
  snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.capital_partner_feedback TO authenticated;
GRANT ALL ON public.capital_partner_feedback TO service_role;

ALTER TABLE public.capital_partner_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read capital_partner_feedback"
  ON public.capital_partner_feedback FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert capital_partner_feedback"
  ON public.capital_partner_feedback FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS capital_partner_feedback_partner_id_idx ON public.capital_partner_feedback(partner_id);
CREATE INDEX IF NOT EXISTS capital_partner_feedback_deal_id_idx ON public.capital_partner_feedback(deal_id);
CREATE INDEX IF NOT EXISTS capital_partner_feedback_engagement_id_idx ON public.capital_partner_feedback(engagement_id);
CREATE INDEX IF NOT EXISTS capital_partner_feedback_created_at_idx ON public.capital_partner_feedback(created_at DESC);

-- 3. learned_partner_strategy
CREATE TABLE IF NOT EXISTS public.learned_partner_strategy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL DEFAULT '',
  example_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

GRANT SELECT ON public.learned_partner_strategy TO authenticated;
GRANT ALL ON public.learned_partner_strategy TO service_role;

ALTER TABLE public.learned_partner_strategy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read learned_partner_strategy"
  ON public.learned_partner_strategy FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can insert learned_partner_strategy"
  ON public.learned_partner_strategy FOR INSERT
  TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update learned_partner_strategy"
  ON public.learned_partner_strategy FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.learned_partner_strategy (content, example_count)
SELECT '', 0
WHERE NOT EXISTS (SELECT 1 FROM public.learned_partner_strategy);

-- 4. Backfill from existing passed engagements
INSERT INTO public.capital_partner_feedback
  (partner_id, deal_id, engagement_id, category, reason_text, price_surmountable, snapshot, created_at)
SELECT
  e.partner_id,
  e.deal_id,
  e.id,
  NULL,
  e.pass_feedback,
  e.pass_price_surmountable,
  jsonb_build_object(
    'deal', jsonb_build_object(
      'state', d.state,
      'market', d.msa,
      'unit_count', d.unit_count,
      'asset_class', NULL,
      'price', d.asking_price,
      'estimated_equity', d.estimated_equity,
      'value_add_potential', d.value_add_potential
    ),
    'partner', jsonb_build_object(
      'firm_type', p.firm_type,
      'investor_type', p.investor_type,
      'geography', p.geography,
      'min_equity_m', p.min_equity_m,
      'max_equity_m', p.max_equity_m,
      'strategy_value_add', p.strategy_value_add,
      'strategy_core_plus', p.strategy_core_plus,
      'strategy_workforce', p.strategy_workforce,
      'strategy_affordable', p.strategy_affordable,
      'product_types', p.product_types
    )
  ),
  COALESCE(e.updated_at, e.created_at, now())
FROM public.capital_raise_engagements e
LEFT JOIN public.deals d ON d.id = e.deal_id
LEFT JOIN public.partners p ON p.id = e.partner_id
WHERE e.passed = true
  AND NOT EXISTS (
    SELECT 1 FROM public.capital_partner_feedback f WHERE f.engagement_id = e.id
  );
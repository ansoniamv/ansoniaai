
-- Pricing table (editable) -------------------------------------------------
CREATE TABLE public.ai_model_pricing (
  model TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  input_per_mtok NUMERIC NOT NULL DEFAULT 0,
  output_per_mtok NUMERIC NOT NULL DEFAULT 0,
  cached_input_per_mtok NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ai_model_pricing TO authenticated;
GRANT ALL ON public.ai_model_pricing TO service_role;

ALTER TABLE public.ai_model_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_model_pricing readable by authenticated"
  ON public.ai_model_pricing FOR SELECT TO authenticated USING (true);

CREATE POLICY "ai_model_pricing admins can insert"
  ON public.ai_model_pricing FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ai_model_pricing admins can update"
  ON public.ai_model_pricing FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ai_model_pricing admins can delete"
  ON public.ai_model_pricing FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER ai_model_pricing_updated_at
  BEFORE UPDATE ON public.ai_model_pricing
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed with PLACEHOLDER rates (confirm against real billing before trusting)
INSERT INTO public.ai_model_pricing (model, provider, input_per_mtok, output_per_mtok, cached_input_per_mtok, notes) VALUES
  ('google/gemini-2.5-flash',         'lovable-gateway', 0.30, 2.50, 0.075, 'PLACEHOLDER — confirm against Lovable AI Gateway credit conversion'),
  ('google/gemini-2.5-flash-lite',    'lovable-gateway', 0.10, 0.40, 0.025, 'PLACEHOLDER — confirm against Lovable AI Gateway credit conversion'),
  ('google/gemini-3-flash-preview',   'lovable-gateway', 0.30, 2.50, 0.075, 'PLACEHOLDER — confirm against Lovable AI Gateway credit conversion'),
  ('claude-sonnet-4-5',               'anthropic',       3.00, 15.00, 0.30, 'PLACEHOLDER — confirm against Anthropic public pricing');

-- Usage log ----------------------------------------------------------------
CREATE TABLE public.ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  function_name TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC,
  success BOOLEAN NOT NULL DEFAULT true,
  deal_id UUID,
  partner_id UUID
);

CREATE INDEX ai_usage_log_created_at_idx ON public.ai_usage_log (created_at DESC);
CREATE INDEX ai_usage_log_model_idx ON public.ai_usage_log (model);
CREATE INDEX ai_usage_log_function_idx ON public.ai_usage_log (function_name);

GRANT SELECT ON public.ai_usage_log TO authenticated;
GRANT ALL ON public.ai_usage_log TO service_role;

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_usage_log readable by authenticated"
  ON public.ai_usage_log FOR SELECT TO authenticated USING (true);

-- Daily rollup view --------------------------------------------------------
CREATE VIEW public.ai_usage_daily AS
SELECT
  (created_at AT TIME ZONE 'UTC')::date AS day,
  model,
  function_name,
  COUNT(*)::int AS calls,
  COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
  COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
  COALESCE(SUM(cached_tokens), 0)::bigint AS cached_tokens,
  COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd
FROM public.ai_usage_log
GROUP BY 1, 2, 3;

GRANT SELECT ON public.ai_usage_daily TO authenticated;
GRANT SELECT ON public.ai_usage_daily TO service_role;

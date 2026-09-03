
-- Extend pricing table for per-request billing
ALTER TABLE public.ai_model_pricing
  ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'token',
  ADD COLUMN IF NOT EXISTS unit_label TEXT,
  ADD COLUMN IF NOT EXISTS per_call_usd NUMERIC;

-- Clean provider casing on existing rows
UPDATE public.ai_model_pricing SET provider = 'Anthropic' WHERE provider = 'anthropic';
UPDATE public.ai_model_pricing SET provider = 'Lovable Gateway' WHERE provider IN ('lovable-gateway','lovable_gateway','Lovable AI Gateway');

-- Seed request-billed data APIs (placeholders, editable)
INSERT INTO public.ai_model_pricing (model, provider, billing_type, unit_label, per_call_usd, input_per_mtok, output_per_mtok, cached_input_per_mtok, notes)
VALUES
  ('hellodata', 'HelloData', 'request', 'per call', 0.25, 0, 0, 0, 'PLACEHOLDER — set per-call price against HelloData billing'),
  ('esri', 'Esri', 'request', 'per call', 0.05, 0, 0, 0, 'PLACEHOLDER — ArcGIS bills in credits; set a blended $/call')
ON CONFLICT (model) DO NOTHING;

-- Extend usage log to allow per-request rows (no model/tokens)
ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'token',
  ADD COLUMN IF NOT EXISTS service TEXT,
  ADD COLUMN IF NOT EXISTS units NUMERIC NOT NULL DEFAULT 1;

ALTER TABLE public.ai_usage_log
  ALTER COLUMN model DROP NOT NULL,
  ALTER COLUMN input_tokens DROP NOT NULL,
  ALTER COLUMN output_tokens DROP NOT NULL,
  ALTER COLUMN cached_tokens DROP NOT NULL;

CREATE INDEX IF NOT EXISTS ai_usage_log_service_idx ON public.ai_usage_log (service);
CREATE INDEX IF NOT EXISTS ai_usage_log_billing_type_idx ON public.ai_usage_log (billing_type);

-- Refresh daily rollup view with new columns
DROP VIEW IF EXISTS public.ai_usage_daily;
CREATE VIEW public.ai_usage_daily AS
SELECT
  (created_at AT TIME ZONE 'UTC')::date AS day,
  billing_type,
  service,
  model,
  function_name,
  COUNT(*)::int AS calls,
  COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
  COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
  COALESCE(SUM(cached_tokens), 0)::bigint AS cached_tokens,
  COALESCE(SUM(units), 0)::numeric AS units,
  COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd
FROM public.ai_usage_log
GROUP BY 1, 2, 3, 4, 5;

GRANT SELECT ON public.ai_usage_daily TO authenticated;
GRANT SELECT ON public.ai_usage_daily TO service_role;

CREATE OR REPLACE VIEW public.deal_enrichment_summary
WITH (security_invoker = on) AS
SELECT
  deal_id,
  NULLIF(rings->'1mi'->>'MEDHINC_CY','')::numeric AS medhinc_1mi,
  NULLIF(rings->'3mi'->>'MEDHINC_CY','')::numeric AS medhinc_3mi,
  NULLIF(rings->'5mi'->>'MEDHINC_CY','')::numeric AS medhinc_5mi,
  NULLIF(rings->'1mi'->>'TOTPOP_CY','')::numeric AS pop_cy_1mi,
  NULLIF(rings->'1mi'->>'TOTPOP_FY','')::numeric AS pop_fy_1mi,
  NULLIF(rings->'3mi'->>'TOTPOP_CY','')::numeric AS pop_cy_3mi,
  NULLIF(rings->'3mi'->>'TOTPOP_FY','')::numeric AS pop_fy_3mi,
  NULLIF(rings->'5mi'->>'TOTPOP_CY','')::numeric AS pop_cy_5mi,
  NULLIF(rings->'5mi'->>'TOTPOP_FY','')::numeric AS pop_fy_5mi
FROM public.deal_enrichment;

GRANT SELECT ON public.deal_enrichment_summary TO anon, authenticated;
GRANT ALL  ON public.deal_enrichment_summary TO service_role;
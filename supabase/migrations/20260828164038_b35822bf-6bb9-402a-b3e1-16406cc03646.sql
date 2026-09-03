CREATE TABLE public.partner_pipeline_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  exported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  exported_at timestamptz NOT NULL DEFAULT now(),
  deal_ids uuid[] NOT NULL DEFAULT '{}',
  deal_count int NOT NULL DEFAULT 0,
  format text NOT NULL CHECK (format IN ('pdf','xlsx')),
  included_outside boolean NOT NULL DEFAULT true,
  included_score boolean NOT NULL DEFAULT false
);

GRANT SELECT, INSERT ON public.partner_pipeline_exports TO authenticated;
GRANT ALL ON public.partner_pipeline_exports TO service_role;

ALTER TABLE public.partner_pipeline_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pipeline exports"
  ON public.partner_pipeline_exports FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can log their own pipeline exports"
  ON public.partner_pipeline_exports FOR INSERT TO authenticated
  WITH CHECK (exported_by = auth.uid());

CREATE INDEX partner_pipeline_exports_partner_idx
  ON public.partner_pipeline_exports (partner_id, exported_at DESC);
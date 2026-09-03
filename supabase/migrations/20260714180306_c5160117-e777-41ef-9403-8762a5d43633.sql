
CREATE TABLE public.warmth_import_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  partner_id uuid,
  partner_name text,
  old_warmth text,
  new_warmth text,
  matched_by text,
  applied_by text,
  applied_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warmth_import_log TO authenticated;
GRANT ALL ON public.warmth_import_log TO service_role;
ALTER TABLE public.warmth_import_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read warmth_import_log" ON public.warmth_import_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated insert warmth_import_log" ON public.warmth_import_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX warmth_import_log_batch_idx ON public.warmth_import_log(batch_id, applied_at DESC);

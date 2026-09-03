CREATE TABLE public.deals_status_backup_20260818 AS
SELECT id, status::text AS old_status, pipeline_stage AS old_pipeline_stage
FROM public.deals;

GRANT SELECT ON public.deals_status_backup_20260818 TO authenticated;
GRANT ALL ON public.deals_status_backup_20260818 TO service_role;
ALTER TABLE public.deals_status_backup_20260818 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read status backup" ON public.deals_status_backup_20260818 FOR SELECT TO authenticated USING (true);
-- Allow 'docx' as a tearsheet export format.
--
-- usePipelineExports already types `format` as pdf|xlsx|docx, but the live
-- constraint admits only ('pdf', 'xlsx'). Nothing produces a docx today — the
-- Word export was dropped in favour of shipping the PDF alone — so this closes
-- a gap rather than enabling a feature: the type and the constraint currently
-- disagree about what is writable, and the type is the one callers read.
--
-- Worth widening now because of where the failure would land. The export is
-- logged AFTER the file has been handed to the user, so a rejected insert
-- surfaces as an error on a download that already succeeded.
--
-- All 15 existing rows are 'pdf', so widening the set rewrites nothing.

ALTER TABLE public.partner_pipeline_exports
  DROP CONSTRAINT IF EXISTS partner_pipeline_exports_format_check;

ALTER TABLE public.partner_pipeline_exports
  ADD CONSTRAINT partner_pipeline_exports_format_check
  CHECK (format IN ('pdf', 'xlsx', 'docx'));

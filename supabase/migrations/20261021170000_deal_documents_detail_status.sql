-- The full breakdown (unit transcription, T12 lines, OM facts) now runs after
-- the headline figures are saved, so a slow or killed breakdown no longer loses
-- the figures and proposals. This column tracks the breakdown on its own:
--
--   reading  — figures saved, breakdown in progress
--   done     — summary written
--   failed   — breakdown failed; figures are unaffected
--   skipped  — document type has no breakdown ("other")
--
-- NULL on rows parsed before this existed.
ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS detail_status text
  CHECK (detail_status IN ('reading', 'done', 'failed', 'skipped'));

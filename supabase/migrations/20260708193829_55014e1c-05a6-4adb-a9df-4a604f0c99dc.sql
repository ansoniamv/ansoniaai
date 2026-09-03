ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS classification TEXT NOT NULL DEFAULT 'unclassified',
  ADD COLUMN IF NOT EXISTS classification_summary TEXT,
  ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS classified_content_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_notes_classification ON public.notes(classification);
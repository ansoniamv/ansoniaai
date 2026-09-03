ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS enriched_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_notes_hash TEXT,
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;
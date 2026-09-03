ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS esri_enrichment jsonb,
  ADD COLUMN IF NOT EXISTS esri_last_synced_at timestamp with time zone;
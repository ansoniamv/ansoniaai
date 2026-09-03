
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS manual_fields text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS geography_avoid text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS partners_archived_at_idx ON public.partners (archived_at);

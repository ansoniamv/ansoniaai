ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS denial_overview text,
  ADD COLUMN IF NOT EXISTS denial_overview_at timestamptz;
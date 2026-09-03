ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS denial_themes jsonb,
  ADD COLUMN IF NOT EXISTS denial_themes_at timestamp with time zone;
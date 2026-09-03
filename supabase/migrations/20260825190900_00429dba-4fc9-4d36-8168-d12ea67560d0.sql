ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS profile_summary text,
  ADD COLUMN IF NOT EXISTS profile_summary_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_summary_hash text;

COMMENT ON COLUMN public.partners.profile_summary IS 'LLM-generated 1-2 sentence firm summary. Written only by the summarize-partners edge function; regenerated only when profile_summary_hash no longer matches the source-field hash.';
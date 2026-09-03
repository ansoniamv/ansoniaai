ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS raise_archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS raise_archived_by text,
  ADD COLUMN IF NOT EXISTS raise_archive_note text;

CREATE INDEX IF NOT EXISTS deals_active_raise_idx
  ON public.deals (raise_status)
  WHERE raise_archived_at IS NULL;

CREATE INDEX IF NOT EXISTS deals_raise_archived_at_idx
  ON public.deals (raise_archived_at)
  WHERE raise_archived_at IS NOT NULL;
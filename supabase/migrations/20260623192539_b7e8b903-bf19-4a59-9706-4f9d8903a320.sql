ALTER TABLE public.deal_emails
  ADD COLUMN IF NOT EXISTS extracted_fields jsonb;
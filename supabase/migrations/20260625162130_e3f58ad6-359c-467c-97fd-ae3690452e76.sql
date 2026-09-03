
ALTER TABLE public.inbox_deals
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS avg_sf integer,
  ADD COLUMN IF NOT EXISTS occupancy_pct numeric;

ALTER TABLE public.deal_emails
  ADD COLUMN IF NOT EXISTS vision_checked boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_deal_emails_vision_checked
  ON public.deal_emails (vision_checked)
  WHERE vision_checked = false;

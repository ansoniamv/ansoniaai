ALTER TABLE public.inbox_deals
  ADD COLUMN IF NOT EXISTS denied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accepted_deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS inbox_deal_id uuid REFERENCES public.inbox_deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_deals_denied ON public.inbox_deals(denied);
CREATE INDEX IF NOT EXISTS idx_deals_source ON public.deals(source);
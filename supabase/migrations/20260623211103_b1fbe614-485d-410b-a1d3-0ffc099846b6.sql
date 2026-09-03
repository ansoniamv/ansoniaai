
-- Qualification gate columns on inbox_deals
ALTER TABLE public.inbox_deals
  ADD COLUMN IF NOT EXISTS gate_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS gate_reason TEXT,
  ADD COLUMN IF NOT EXISTS gate_checked_at TIMESTAMPTZ;

-- Constrain gate_status values
DO $$ BEGIN
  ALTER TABLE public.inbox_deals
    ADD CONSTRAINT inbox_deals_gate_status_check
    CHECK (gate_status IN ('pending','passed','review','filtered'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS inbox_deals_gate_status_idx ON public.inbox_deals(gate_status);

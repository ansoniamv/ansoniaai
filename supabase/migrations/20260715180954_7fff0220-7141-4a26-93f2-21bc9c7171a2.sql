
ALTER TABLE public.partner_suggestions
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.partner_suggestions(id),
  ADD COLUMN IF NOT EXISTS signals jsonb,
  ADD COLUMN IF NOT EXISTS deal_confidence numeric;

CREATE INDEX IF NOT EXISTS idx_partner_suggestions_superseded_by ON public.partner_suggestions(superseded_by);

CREATE TABLE IF NOT EXISTS public.partner_warmth_signals (
  partner_id uuid PRIMARY KEY,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  inbound_90d int NOT NULL DEFAULT 0,
  outbound_90d int NOT NULL DEFAULT 0,
  avg_response_hours numeric,
  meetings_scheduled int NOT NULL DEFAULT 0,
  deals_engaged int NOT NULL DEFAULT 0,
  computed_level text,
  computed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_warmth_signals TO authenticated;
GRANT ALL ON public.partner_warmth_signals TO service_role;
ALTER TABLE public.partner_warmth_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read partner warmth signals"
  ON public.partner_warmth_signals FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_partner_warmth_signals_computed_at ON public.partner_warmth_signals(computed_at DESC);

ALTER TABLE public.connectors ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO public.connectors (key, name, enabled, config)
VALUES ('atlas_automation', 'Atlas Automation', false, jsonb_build_object('interval_hours', 6, 'last_run_at', null, 'last_counts', jsonb_build_object()))
ON CONFLICT (key) DO NOTHING;

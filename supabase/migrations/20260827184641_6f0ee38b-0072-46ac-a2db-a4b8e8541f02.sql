ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS capital_status text
    CHECK (capital_status IS NULL OR capital_status IN (
      'Actively Deploying','Selective','Constrained','Out of Capital'
    )),
  ADD COLUMN IF NOT EXISTS capital_available_from date,
  ADD COLUMN IF NOT EXISTS capital_status_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS capital_status_detail text;

COMMENT ON COLUMN public.partners.capital_status IS
  'Current ability to deploy capital. Set only via an approved Atlas suggestion or a manual edit; never written directly by an enrichment function.';
COMMENT ON COLUMN public.partners.capital_available_from IS
  'When the partner expects to be able to deploy again. Null when unknown or already deploying.';
COMMENT ON COLUMN public.partners.capital_status_as_of IS
  'When we learned this — the source email/note date, NOT the approval date. Drives the staleness warning on the profile.';

CREATE INDEX IF NOT EXISTS idx_partners_capital_status
  ON public.partners (capital_status) WHERE archived_at IS NULL;

ALTER TABLE public.partner_interactions
  ADD COLUMN IF NOT EXISTS source_message_ids text[],
  ADD COLUMN IF NOT EXISTS fact_category text;
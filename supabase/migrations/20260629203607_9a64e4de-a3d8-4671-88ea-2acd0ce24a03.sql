
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS zip text,
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS classic_units_remaining integer,
  ADD COLUMN IF NOT EXISTS total_renovated_units integer,
  ADD COLUMN IF NOT EXISTS t12_noi numeric,
  ADD COLUMN IF NOT EXISTS t12_opex numeric,
  ADD COLUMN IF NOT EXISTS hellodata_payload jsonb,
  ADD COLUMN IF NOT EXISTS hellodata_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS area_median_income_1mi numeric,
  ADD COLUMN IF NOT EXISTS population_growth_pct numeric,
  ADD COLUMN IF NOT EXISTS job_growth_pct numeric,
  ADD COLUMN IF NOT EXISTS new_supply_pct_of_stock numeric,
  ADD COLUMN IF NOT EXISTS school_rating numeric,
  ADD COLUMN IF NOT EXISTS nearest_employment_node_min numeric,
  ADD COLUMN IF NOT EXISTS market_cap_rate numeric,
  ADD COLUMN IF NOT EXISTS regulatory_risk text,
  ADD COLUMN IF NOT EXISTS passes_hard_filters boolean,
  ADD COLUMN IF NOT EXISTS hard_filter_failures jsonb,
  ADD COLUMN IF NOT EXISTS factor_scores jsonb,
  ADD COLUMN IF NOT EXISTS total_score numeric,
  ADD COLUMN IF NOT EXISTS deal_tier text,
  ADD COLUMN IF NOT EXISTS value_add_upside numeric,
  ADD COLUMN IF NOT EXISTS scored_at timestamptz;

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_hellodata_status_check;
ALTER TABLE public.deals
  ADD CONSTRAINT deals_hellodata_status_check
  CHECK (hellodata_status IN ('pending','fetched','failed'));

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_regulatory_risk_check;
ALTER TABLE public.deals
  ADD CONSTRAINT deals_regulatory_risk_check
  CHECK (regulatory_risk IS NULL OR regulatory_risk IN ('green','yellow','red'));

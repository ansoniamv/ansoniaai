ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS hellodata_id TEXT,
  ADD COLUMN IF NOT EXISTS msa TEXT,
  ADD COLUMN IF NOT EXISTS management_company TEXT,
  ADD COLUMN IF NOT EXISTS median_income_tract NUMERIC,
  ADD COLUMN IF NOT EXISTS median_rent_tract NUMERIC,
  ADD COLUMN IF NOT EXISTS building_quality_score NUMERIC,
  ADD COLUMN IF NOT EXISTS is_lease_up BOOLEAN,
  ADD COLUMN IF NOT EXISTS uses_rev_management BOOLEAN,
  ADD COLUMN IF NOT EXISTS in_place_avg_rent NUMERIC,
  ADD COLUMN IF NOT EXISTS avg_time_on_market NUMERIC,
  ADD COLUMN IF NOT EXISTS active_concessions_summary TEXT,
  ADD COLUMN IF NOT EXISTS hellodata_last_synced_at TIMESTAMPTZ;
-- Columns for the HelloData facts we already pay for but never read.
--
-- WHY THIS EXISTS: fetch-hellodata caches the entire /property/{id} response on
-- deals.hellodata_payload, and the shared mapper extracts roughly 35 fields out
-- of it. Everything below is already sitting in that cached JSON on every
-- enriched deal — rent history, availability periods, the fee schedule, the
-- amenity lists, the room-level quality scores, the asset-type flags. Reading
-- them costs zero additional API calls, and re-running fetch-hellodata on an
-- already-fetched deal re-maps from cache without touching HelloData at all.
--
-- ORDERING: this migration must land BEFORE the edge functions are deployed.
-- hellodata-enrich writes the mapper output straight to PostgREST, and an update
-- naming a column that does not exist is rejected in full — one unknown key
-- fails the whole write.

ALTER TABLE public.deals
  -- Rent trajectory, from payload.history / building_availability[].history.
  ADD COLUMN IF NOT EXISTS rent_trend_3mo_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS rent_trend_12mo_pct NUMERIC,

  -- Leasing velocity, from building_availability / availability_periods.
  ADD COLUMN IF NOT EXISTS units_available INTEGER,
  ADD COLUMN IF NOT EXISTS exposure_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS median_days_on_market NUMERIC,

  -- Concession economics, from concessions_history[].items.
  ADD COLUMN IF NOT EXISTS concession_weeks_free NUMERIC,
  ADD COLUMN IF NOT EXISTS concession_pct_of_rent NUMERIC,

  -- Posted fee schedule, from the named fee fields plus payload.fees.
  ADD COLUMN IF NOT EXISTS fee_schedule JSONB,
  ADD COLUMN IF NOT EXISTS move_in_fees_total NUMERIC,

  -- Amenity inventory, from building_amenities / unit_amenities.
  ADD COLUMN IF NOT EXISTS building_amenities JSONB,
  ADD COLUMN IF NOT EXISTS unit_amenities JSONB,

  -- Room-level condition, from building_quality.
  ADD COLUMN IF NOT EXISTS building_quality_detail JSONB,

  -- Asset-type flags. These are hard-filter inputs (the buy box is conventional
  -- value-add multifamily) and they double as a match canary: a payload that
  -- says is_single_family is describing a different building than the one on a
  -- 150+ unit deal.
  ADD COLUMN IF NOT EXISTS is_student_housing BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_senior_housing BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_affordable_housing BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_build_to_rent BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_condo BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_single_family BOOLEAN,

  -- Provenance for the two fields the buy box gates on. HelloData returns
  -- number_units_prediction / year_built_prediction when it has no filed value;
  -- the mapper now falls back to them, so a deal can clear the 150-unit or the
  -- vintage filter on a model output. These say which.
  ADD COLUMN IF NOT EXISTS unit_count_is_estimated BOOLEAN,
  ADD COLUMN IF NOT EXISTS vintage_is_estimated BOOLEAN,

  -- Structure and identity.
  ADD COLUMN IF NOT EXISTS number_stories INTEGER,
  ADD COLUMN IF NOT EXISTS census_tract_id TEXT,
  ADD COLUMN IF NOT EXISTS street_view_url TEXT;

COMMENT ON COLUMN public.deals.rent_trend_3mo_pct IS
  'Same-unit median change in effective rent over the trailing 3 months, percent. Only units priced in both windows are counted, so a shift in the available unit mix cannot move it. NULL below 3 qualifying units.';
COMMENT ON COLUMN public.deals.rent_trend_12mo_pct IS
  'Same-unit median change in effective rent over the trailing 12 months, percent. Same method as rent_trend_3mo_pct.';
COMMENT ON COLUMN public.deals.units_available IS
  'Units listed as available in the cached payload. 0 is a real value (nothing on the market); NULL means HelloData returned no availability array.';
COMMENT ON COLUMN public.deals.exposure_pct IS
  'units_available as a percent of total units. The leasing-velocity read the occupancy field cannot give: a T-12 occupancy of 94% with 11% exposure is a property that is emptying.';
COMMENT ON COLUMN public.deals.median_days_on_market IS
  'Median days on market across listed units. Median, not mean, because one stale listing drags an average by weeks.';
COMMENT ON COLUMN public.deals.concession_weeks_free IS
  'Weeks of free rent offered by the largest active concession. Months are converted at 4.345 weeks.';
COMMENT ON COLUMN public.deals.concession_pct_of_rent IS
  'Value of the largest active concession as a percent of one year of rent. This is the haircut between asking and effective rent — 6 weeks free is 11.5%.';
COMMENT ON COLUMN public.deals.fee_schedule IS
  'Normalized [{label, amount, frequency}] from the named fee columns and payload.fees. The posted schedule, NOT a capture-rate-adjusted income estimate.';
COMMENT ON COLUMN public.deals.move_in_fees_total IS
  'Admin fee plus application fee. The only two fees that are unambiguously charged to every new lease.';
COMMENT ON COLUMN public.deals.building_quality_detail IS
  'Per-room condition scores on the same 0-100 scale as building_quality_score, which is their blended average. This is what tells you whether the capex belongs in kitchens or in common areas.';
COMMENT ON COLUMN public.deals.unit_count_is_estimated IS
  'TRUE when unit_count came from HelloData number_units_prediction rather than a filed unit count.';
COMMENT ON COLUMN public.deals.vintage_is_estimated IS
  'TRUE when vintage_year came from HelloData year_built_prediction rather than a filed year built.';
COMMENT ON COLUMN public.deals.census_tract_id IS
  'HelloData census tract GEOID. The join key for the *_tract columns and for any ACS or Esri pull that should line up with them.';

-- The asset-type flags exist to be filtered on, and all six are overwhelmingly
-- NULL or false, so partial indexes stay tiny.
CREATE INDEX IF NOT EXISTS deals_disqualifying_subtype_idx
  ON public.deals (id)
  WHERE is_student_housing OR is_senior_housing OR is_affordable_housing
     OR is_condo OR is_single_family;

-- Drop legacy buy_box_criteria
DROP TABLE IF EXISTS public.buy_box_criteria CASCADE;

-- Pillars
CREATE TABLE public.buy_box_pillars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  weight integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.buy_box_pillars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all read access" ON public.buy_box_pillars FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.buy_box_pillars FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.buy_box_pillars FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.buy_box_pillars FOR DELETE USING (true);
CREATE TRIGGER update_buy_box_pillars_updated_at BEFORE UPDATE ON public.buy_box_pillars
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Signals
CREATE TABLE public.buy_box_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pillar_id uuid NOT NULL REFERENCES public.buy_box_pillars(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  field_source text NOT NULL,
  scoring_method text NOT NULL DEFAULT 'higher_better',
  min_value numeric,
  max_value numeric,
  optimal_min numeric,
  optimal_max numeric,
  weight_within_pillar integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.buy_box_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all read access" ON public.buy_box_signals FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.buy_box_signals FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.buy_box_signals FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.buy_box_signals FOR DELETE USING (true);
CREATE TRIGGER update_buy_box_signals_updated_at BEFORE UPDATE ON public.buy_box_signals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Singleton thesis
CREATE TABLE public.buy_box_thesis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL DEFAULT '',
  last_updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.buy_box_thesis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all read access" ON public.buy_box_thesis FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.buy_box_thesis FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.buy_box_thesis FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.buy_box_thesis FOR DELETE USING (true);
CREATE TRIGGER update_buy_box_thesis_updated_at BEFORE UPDATE ON public.buy_box_thesis
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.buy_box_thesis (content) VALUES (
'We target value-add multifamily in growing Sunbelt and secondary markets where in-place rents lag market by 10%+, supply pipelines are constrained, and population/job growth outpaces national averages. Prefer 1990s-2010s vintage, 150+ units, with operational upside (no rev management, high concessions, dated interiors). Avoid markets with >5% new supply as % of stock, declining population, or median income below $55k. Strong school districts and access to employment nodes are positive signals.'
);

-- Permits cache
CREATE TABLE public.permits_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cbsa_code text NOT NULL,
  cbsa_name text,
  year integer NOT NULL,
  month integer,
  multifamily_permits integer,
  total_units integer,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cbsa_code, year, month)
);
ALTER TABLE public.permits_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all read access" ON public.permits_data FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.permits_data FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.permits_data FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.permits_data FOR DELETE USING (true);

-- Deals scoring columns
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS pillar_scores jsonb,
  ADD COLUMN IF NOT EXISTS score_thesis_adjustment integer,
  ADD COLUMN IF NOT EXISTS last_scored_at timestamptz;

-- Seed pillars
INSERT INTO public.buy_box_pillars (key, name, description, weight, sort_order) VALUES
  ('market_demand', 'Market Demand & Demographics', 'Population growth, income, education, age mix — the drivers of housing demand.', 20, 1),
  ('market_supply', 'Market Supply & Rent Dynamics', 'Rent growth, vacancy, new supply pressure, concessions, absorption.', 25, 2),
  ('location', 'Location & Accessibility', 'School quality, jobs proximity, amenities, walkability.', 10, 3),
  ('asset_quality', 'Asset Quality & Vintage', 'Year built, building condition, scale, lease-up status.', 15, 4),
  ('value_add', 'Value-Add Opportunity', 'In-place vs market rent gap, no rev mgmt, high concessions, operational upside.', 20, 5),
  ('deal_economics', 'Deal Economics', 'Price per unit, estimated equity, AMI mix, affordability.', 10, 6);

-- Seed signals
WITH p AS (SELECT id, key FROM public.buy_box_pillars)
INSERT INTO public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, sort_order) VALUES
  ((SELECT id FROM p WHERE key='market_demand'), 'Population growth (5yr, tract)', 'Tract-level 5yr population growth %', 'deal_enrichment.rings.5mi.pop_growth_5yr', 'higher_better', -5, 20, NULL, NULL, 30, 1),
  ((SELECT id FROM p WHERE key='market_demand'), 'Median household income (tract)', 'Tract median income, USD', 'deals.median_income_tract', 'higher_better', 35000, 120000, NULL, NULL, 25, 2),
  ((SELECT id FROM p WHERE key='market_demand'), 'Bachelor''s degree %', 'Share of pop with bachelor''s+', 'deals.bachelors_pct_tract', 'higher_better', 10, 60, NULL, NULL, 20, 3),
  ((SELECT id FROM p WHERE key='market_demand'), 'Median age (tract)', 'Optimal renter-age range', 'deals.median_age_tract', 'range_optimal', 20, 65, 28, 42, 15, 4),
  ((SELECT id FROM p WHERE key='market_demand'), 'Population density', 'Density per sq mi', 'deals.population_density_tract', 'higher_better', 500, 15000, NULL, NULL, 10, 5),

  ((SELECT id FROM p WHERE key='market_supply'), 'Tract vacancy rate', 'Lower is tighter', 'deals.vacancy_rate_tract', 'lower_better', 2, 15, NULL, NULL, 25, 1),
  ((SELECT id FROM p WHERE key='market_supply'), 'Median market rent (tract)', 'Tract rent level', 'deals.median_rent_tract', 'higher_better', 800, 3000, NULL, NULL, 15, 2),
  ((SELECT id FROM p WHERE key='market_supply'), 'Avg time on market', 'Days listings stay up — lower is better', 'deals.avg_time_on_market', 'lower_better', 10, 90, NULL, NULL, 15, 3),
  ((SELECT id FROM p WHERE key='market_supply'), 'New supply pressure (permits/1k units)', 'Multifamily permits per 1k existing units, trailing 12mo', 'permits.permits_per_1k_units', 'lower_better', 0, 50, NULL, NULL, 30, 4),
  ((SELECT id FROM p WHERE key='market_supply'), 'Avg price change %', 'Negative = softening rents', 'deals.avg_price_change', 'higher_better', -10, 10, NULL, NULL, 15, 5),

  ((SELECT id FROM p WHERE key='location'), 'Owner-occupied %', 'Stable neighborhood signal', 'deals.owner_occupied_pct_tract', 'range_optimal', 0, 100, 30, 70, 40, 1),
  ((SELECT id FROM p WHERE key='location'), 'Has high school in district', 'School coverage signal', 'deal_enrichment.schools.high.exists', 'boolean', NULL, NULL, NULL, NULL, 30, 2),
  ((SELECT id FROM p WHERE key='location'), 'Review average rating (proxy for area)', 'Resident sentiment proxy', 'deals.review_avg_rating', 'higher_better', 1, 5, NULL, NULL, 30, 3),

  ((SELECT id FROM p WHERE key='asset_quality'), 'Vintage year', 'Sweet spot 1990s-2010s', 'deals.vintage_year', 'range_optimal', 1960, 2025, 1990, 2015, 35, 1),
  ((SELECT id FROM p WHERE key='asset_quality'), 'Unit count', 'Scale matters', 'deals.unit_count', 'higher_better', 50, 400, NULL, NULL, 30, 2),
  ((SELECT id FROM p WHERE key='asset_quality'), 'Building quality score', 'HelloData composite', 'deals.building_quality_score', 'higher_better', 1, 10, NULL, NULL, 25, 3),
  ((SELECT id FROM p WHERE key='asset_quality'), 'Not in lease-up', 'Stabilized = lower risk', 'deals.is_lease_up', 'boolean', NULL, NULL, NULL, NULL, 10, 4),

  ((SELECT id FROM p WHERE key='value_add'), 'No revenue management', 'Operational upside if absent', 'deals.uses_rev_management', 'boolean', NULL, NULL, NULL, NULL, 30, 1),
  ((SELECT id FROM p WHERE key='value_add'), 'Active concessions present', 'Indicates operator weakness / opportunity', 'deals.active_concessions_summary', 'boolean', NULL, NULL, NULL, NULL, 25, 2),
  ((SELECT id FROM p WHERE key='value_add'), 'In-place rent gap (in-place vs market)', 'Higher gap = bigger opportunity', 'derived.rent_gap_pct', 'higher_better', 0, 30, NULL, NULL, 30, 3),
  ((SELECT id FROM p WHERE key='value_add'), 'Value-add potential rating', 'Manual rating: low/medium/high', 'deals.value_add_potential', 'higher_better', 1, 3, NULL, NULL, 15, 4),

  ((SELECT id FROM p WHERE key='deal_economics'), 'Estimated equity ($M)', 'Bigger checks preferred', 'deals.estimated_equity', 'higher_better', 5000000, 100000000, NULL, NULL, 50, 1),
  ((SELECT id FROM p WHERE key='deal_economics'), 'Price per unit', 'Lower is better, market-dependent', 'derived.price_per_unit', 'lower_better', 50000, 400000, NULL, NULL, 40, 2),
  ((SELECT id FROM p WHERE key='deal_economics'), 'Affordable component', 'Affordable bonus signal', 'deals.affordable', 'boolean', NULL, NULL, NULL, NULL, 10, 3);

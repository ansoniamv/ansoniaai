-- Buy-box scoring configuration, captured from the database into version control.
--
-- buy_box_pillars and buy_box_signals drive the deal-score edge function, and
-- until now existed ONLY as rows in the production database with no migration.
-- That is the same gap that hid the missing pg_cron job: configuration that
-- nothing in the repo describes, so nothing in review can catch a change to it.
--
-- Captured 2026-09-15. Idempotent: keyed on the natural
-- keys (pillar key, signal name within pillar) so re-running does not duplicate.
--
-- NOTE for whoever reads this next: most signal field_source values resolve to
-- the HelloData-derived tract columns. Those were found to be matched to the
-- wrong building on ~44% of enriched deals and have been cleared on 13 of them,
-- so several of these signals now resolve to null by design.

insert into public.buy_box_pillars (key, name, description, weight, sort_order, is_active, created_at, updated_at)
values ('market_demand', 'Market Demand & Demographics', 'Population growth, income, education, age mix — the drivers of housing demand.', 20, 1, true, '2026-05-11 16:19:10.591576+00', '2026-05-11 16:19:10.591576+00')
on conflict (key) do update set
    name = excluded.name,
    description = excluded.description,
    weight = excluded.weight,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

insert into public.buy_box_pillars (key, name, description, weight, sort_order, is_active, created_at, updated_at)
values ('market_supply', 'Market Supply & Rent Dynamics', 'Rent growth, vacancy, new supply pressure, concessions, absorption.', 25, 2, true, '2026-05-11 16:19:10.591576+00', '2026-05-11 16:19:10.591576+00')
on conflict (key) do update set
    name = excluded.name,
    description = excluded.description,
    weight = excluded.weight,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

insert into public.buy_box_pillars (key, name, description, weight, sort_order, is_active, created_at, updated_at)
values ('location', 'Location & Accessibility', 'School quality, jobs proximity, amenities, walkability.', 10, 3, true, '2026-05-11 16:19:10.591576+00', '2026-05-11 16:19:10.591576+00')
on conflict (key) do update set
    name = excluded.name,
    description = excluded.description,
    weight = excluded.weight,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

insert into public.buy_box_pillars (key, name, description, weight, sort_order, is_active, created_at, updated_at)
values ('asset_quality', 'Asset Quality & Vintage', 'Year built, building condition, scale, lease-up status.', 15, 4, true, '2026-05-11 16:19:10.591576+00', '2026-05-11 16:19:10.591576+00')
on conflict (key) do update set
    name = excluded.name,
    description = excluded.description,
    weight = excluded.weight,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

insert into public.buy_box_pillars (key, name, description, weight, sort_order, is_active, created_at, updated_at)
values ('value_add', 'Value-Add Opportunity', 'In-place vs market rent gap, no rev mgmt, high concessions, operational upside.', 20, 5, true, '2026-05-11 16:19:10.591576+00', '2026-05-11 16:19:10.591576+00')
on conflict (key) do update set
    name = excluded.name,
    description = excluded.description,
    weight = excluded.weight,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

insert into public.buy_box_pillars (key, name, description, weight, sort_order, is_active, created_at, updated_at)
values ('deal_economics', 'Deal Economics', 'Price per unit, estimated equity, AMI mix, affordability.', 10, 6, true, '2026-05-11 16:19:10.591576+00', '2026-05-11 16:19:10.591576+00')
on conflict (key) do update set
    name = excluded.name,
    description = excluded.description,
    weight = excluded.weight,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'market_demand'), 'Bachelor''s degree %', 'Percentage of adults in the census tract holding a bachelor''s degree or higher.', 'deals.bachelors_pct_tract', 'higher_better', '10', '60', null, null, 20, true, 3, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'market_demand' and x.name = 'Bachelor''s degree %'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'market_demand'), 'Median age (tract)', 'Median age of residents in the property''s census tract.', 'deals.median_age_tract', 'range_optimal', '20', '65', '28', '42', 15, true, 4, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'market_demand' and x.name = 'Median age (tract)'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'market_demand'), 'Median household income (tract)', 'Median household income in the property''s census tract, in dollars.', 'deals.median_income_tract', 'higher_better', '35000', '120000', null, null, 25, true, 2, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'market_demand' and x.name = 'Median household income (tract)'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'market_demand'), 'Population density', 'Number of residents per square mile in the property''s census tract.', 'deals.population_density_tract', 'higher_better', '500', '15000', null, null, 10, true, 5, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'market_demand' and x.name = 'Population density'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'market_demand'), 'Population growth (5yr, tract)', 'Five-year population growth percentage within a 5-mile radius of the property.', 'deal_enrichment.rings.5mi.pop_growth_5yr', 'higher_better', '-5', '20', null, null, 30, true, 1, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'market_demand' and x.name = 'Population growth (5yr, tract)'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'market_supply'), 'Avg price change %', 'Year-over-year change in average listing price for comparable units in the submarket.', 'deals.avg_price_change', 'higher_better', '-10', '10', null, null, 15, true, 5, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'market_supply' and x.name = 'Avg price change %'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'market_supply'), 'Avg time on market', 'Average number of days listings remain active before lease or sale in the local market.', 'deals.avg_time_on_market', 'lower_better', '10', '90', null, null, 15, true, 3, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'market_supply' and x.name = 'Avg time on market'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'market_supply'), 'Median market rent (tract)', 'Median market rent for comparable units in the census tract, in dollars.', 'deals.median_rent_tract', 'higher_better', '800', '3000', null, null, 15, true, 2, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'market_supply' and x.name = 'Median market rent (tract)'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'market_supply'), 'New supply pressure (permits/1k units)', 'Multifamily construction permits issued per 1,000 existing units in the CBSA over the trailing 12 months.', 'permits.permits_per_1k_units', 'lower_better', '0', '50', null, null, 30, true, 4, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'market_supply' and x.name = 'New supply pressure (permits/1k units)'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'market_supply'), 'Tract vacancy rate', 'Share of rental housing units sitting vacant in the census tract.', 'deals.vacancy_rate_tract', 'lower_better', '2', '15', null, null, 25, true, 1, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'market_supply' and x.name = 'Tract vacancy rate'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'location'), 'Has high school in district', 'Whether a high school is present within the property''s school district.', 'deal_enrichment.schools.high.exists', 'boolean', null, null, null, null, 30, true, 2, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'location' and x.name = 'Has high school in district'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'location'), 'Owner-occupied %', 'Percentage of housing units in the tract that are owner-occupied rather than rented.', 'deals.owner_occupied_pct_tract', 'range_optimal', '0', '100', '30', '70', 40, true, 1, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'location' and x.name = 'Owner-occupied %'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'location'), 'Review average rating (proxy for area)', 'Average online rating for the property or comparable buildings in the area.', 'deals.review_avg_rating', 'higher_better', '1', '5', null, null, 30, true, 3, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'location' and x.name = 'Review average rating (proxy for area)'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'asset_quality'), 'Building quality score', 'HelloData composite score assessing overall building condition and amenity quality.', 'deals.building_quality_score', 'higher_better', '1', '10', null, null, 25, true, 3, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'asset_quality' and x.name = 'Building quality score'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'asset_quality'), 'Not in lease-up', 'Whether the property is currently in its initial lease-up phase.', 'deals.is_lease_up', 'boolean', null, null, null, null, 10, true, 4, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'asset_quality' and x.name = 'Not in lease-up'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'asset_quality'), 'Unit count', 'Total number of residential units in the property.', 'deals.unit_count', 'higher_better', '50', '400', null, null, 30, true, 2, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'asset_quality' and x.name = 'Unit count'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'asset_quality'), 'Vintage year', 'Year the property was originally built or substantially renovated.', 'deals.vintage_year', 'range_optimal', '1960', '2025', '1990', '2021', 35, true, 1, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:23:55.298512+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'asset_quality' and x.name = 'Vintage year'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'value_add'), 'In-place rent gap (in-place vs market)', 'Percentage difference between in-place rents and current market rents.', 'derived.rent_gap_pct', 'higher_better', '0', '30', null, null, 30, true, 3, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'value_add' and x.name = 'In-place rent gap (in-place vs market)'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'value_add'), 'No revenue management', 'Whether the operator currently uses automated revenue management software.', 'deals.uses_rev_management', 'boolean', null, null, null, null, 20, true, 1, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'value_add' and x.name = 'No revenue management'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'value_add'), 'Value-add potential rating', 'Analyst-assessed rating of renovation or operational upside opportunity.', 'deals.value_add_potential', 'higher_better', '1', '3', null, null, 50, true, 4, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'value_add' and x.name = 'Value-add potential rating'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'deal_economics'), 'Affordable component', 'Whether the property includes an affordable housing component.', 'deals.affordable', 'boolean', null, null, null, null, 10, true, 3, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'deal_economics' and x.name = 'Affordable component'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'deal_economics'), 'Estimated equity ($M)', 'Estimated total equity invested or required for the transaction, in millions.', 'deals.estimated_equity', 'higher_better', '5000000', '100000000', null, null, 50, true, 1, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'deal_economics' and x.name = 'Estimated equity ($M)'
);

insert into public.buy_box_signals (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order, created_at, updated_at)
select (select id from public.buy_box_pillars where key = 'deal_economics'), 'Price per unit', 'Asking price divided by total unit count.', 'derived.price_per_unit', 'lower_better', '50000', '400000', null, null, 40, true, 2, '2026-05-11 16:19:10.591576+00', '2026-07-01 17:19:53.697634+00'
where not exists (
  select 1 from public.buy_box_signals x
  join public.buy_box_pillars p on p.id = x.pillar_id
  where p.key = 'deal_economics' and x.name = 'Price per unit'
);

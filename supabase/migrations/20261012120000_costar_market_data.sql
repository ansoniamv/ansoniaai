-- Quarterly CoStar market data, and the submarket supply signal it feeds.
--
-- WHY. deals.new_supply_pct_of_stock has never measured new supply. It's Esri's
-- annualised five-year growth in ALL housing units inside a 5-mile ring
-- (market-metrics-enrich), so it counts single-family subdivisions and misses a
-- 400-unit tower that's already under construction. The deal-score signal
-- "New supply pressure" reads permits.permits_per_1k_units, which is hard-coded
-- to null. Nothing in the platform knows what is being built next door.
--
-- CoStar does, and the data changes slowly enough that a quarterly export is
-- fine. An admin uploads the export on /market-data, the browser parses it, and
-- the rows land here. Each upload is an import whose rows stay hidden until
-- complete_market_data_import() checks the row count and flips it to
-- 'complete', so a half-finished upload is never read.
--
-- GEOGRAPHY. CoStar submarkets have no polygon in the export, so a deal is
-- linked to its submarket by an explicit pick (deals.costar_submarket_code),
-- not by a spatial join. The pick is made once per deal.
--
-- WHAT THE DEAL GETS. When a deal has a submarket, new_supply_pct_of_stock
-- becomes CoStar under-construction units as a percent of existing inventory,
-- summed over every star slice in the export. That's the pipeline that delivers
-- in the next 12–24 months, a measured count rather than a forecast. The
-- trigger below keeps it that way even if market-metrics-enrich later writes an
-- Esri figure over it, and new_supply_source records which one is showing.

-- ---------------------------------------------------------------- imports
create table if not exists public.market_data_imports (
  id              uuid primary key default gen_random_uuid(),
  source          text not null default 'costar',
  as_of           text not null,                 -- CoStar's label, e.g. '2026 Q4'
  as_of_date      date not null,                 -- that quarter's last day, for ordering
  file_name       text,
  geography_types text[] not null default '{}',
  slices          text[] not null default '{}',
  row_count       integer not null check (row_count > 0),
  status          text not null default 'loading'
                  check (status in ('loading', 'complete')),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

comment on table public.market_data_imports is
  'One row per uploaded vendor export. Rows in costar_series are only read once their import is complete.';

-- ---------------------------------------------------------------- series
create table if not exists public.costar_series (
  import_id        uuid not null references public.market_data_imports(id) on delete cascade,
  geography_type   text not null,               -- 'Submarket', 'Market', ...
  geography_code   text not null,               -- 'APT-1-9393'
  geography_name   text not null,               -- 'Atlanta - GA USA - Barrow County'
  cbsa_code        text,
  slice            text not null,               -- '3 Star', '4 & 5 Star', ...
  period           text not null,               -- '2026 Q4 YTD', '2027 Q4'
  period_year      integer not null,
  period_quarter   integer not null check (period_quarter between 1 and 4),
  period_kind      text not null check (period_kind in ('history', 'ytd', 'estimate', 'forecast')),

  inventory_units                 double precision,
  under_construction_units        double precision,
  construction_starts_units_12mo  double precision,
  net_delivered_units_12mo        double precision,
  absorption_units_12mo           double precision,
  demand_units                    double precision,
  occupancy_rate                  double precision,  -- fraction, 0.95
  stabilized_vacancy              double precision,
  asking_rent_unit                double precision,
  effective_rent_unit             double precision,
  effective_rent_growth_12mo      double precision,  -- fraction
  market_cap_rate                 double precision,
  sale_price_per_unit             double precision,

  -- Every non-empty column of the export under its CoStar header, so a metric
  -- nobody promoted to a column above is still there next quarter.
  metrics jsonb not null default '{}'::jsonb,

  primary key (import_id, geography_code, slice, period)
);

create index if not exists costar_series_geo_idx on public.costar_series (geography_code);

comment on column public.costar_series.period_kind is
  'history = a closed period before the as-of year; ytd = the as-of year to date (where under-construction counts live); estimate = CoStar''s full-year figure for the as-of year; forecast = later years.';

-- ---------------------------------------------------------------- access
alter table public.market_data_imports enable row level security;
alter table public.costar_series       enable row level security;

drop policy if exists "approved users read market imports" on public.market_data_imports;
create policy "approved users read market imports"
  on public.market_data_imports for select to authenticated
  using ((select public.is_approved(auth.uid())));

drop policy if exists "admins write market imports" on public.market_data_imports;
create policy "admins write market imports"
  on public.market_data_imports for all to authenticated
  using ((select public.has_role(auth.uid(), 'admin')))
  with check ((select public.has_role(auth.uid(), 'admin')));

drop policy if exists "approved users read costar series" on public.costar_series;
create policy "approved users read costar series"
  on public.costar_series for select to authenticated
  using ((select public.is_approved(auth.uid())));

-- Rows can only be added to an import that is still loading, so a completed
-- vintage can't be changed after its row count was checked.
drop policy if exists "admins load costar series" on public.costar_series;
create policy "admins load costar series"
  on public.costar_series for insert to authenticated
  with check (
    (select public.has_role(auth.uid(), 'admin'))
    and exists (select 1 from public.market_data_imports i
                where i.id = import_id and i.status = 'loading')
  );

grant select, insert, update, delete on public.market_data_imports to authenticated;
grant select, insert on public.costar_series to authenticated;
grant all on public.market_data_imports, public.costar_series to service_role;

-- ---------------------------------------------------------------- signals
-- One row per submarket and scope, for the newest complete submarket vintage.
-- scope is each star slice in the export plus 'Combined' (all slices summed,
-- rates weighted by inventory).
--
-- Every pct_* column is a favourability percentile: the share of comparable
-- submarkets (same scope, ≥ 500 units) this one beats or ties *for rent
-- growth*. 1.0 is best. So low supply ranks high and rising occupancy ranks
-- high. Submarkets under 500 units get values but no percentile, because a
-- 40-unit delivery in a 300-unit submarket is noise, not a cycle.
--
-- cyclical_score is the mean of the available percentiles × 100. It needs at
-- least four of the six, so a submarket with no rent series doesn't score off
-- supply alone.
drop materialized view if exists public.costar_submarket_signals;
create materialized view public.costar_submarket_signals as
with cur as (
  select id, as_of, extract(year from as_of_date)::int as as_of_year
  from public.market_data_imports
  where source = 'costar' and status = 'complete' and 'Submarket' = any (geography_types)
  order by as_of_date desc, completed_at desc
  limit 1
),
annual as (
  -- A quarterly export has four rows per year; keep the latest quarter of each.
  select * from (
    select s.*, cur.as_of, cur.as_of_year,
           row_number() over (partition by s.geography_code, s.slice, s.period_kind, s.period_year
                              order by s.period_quarter desc) as rn
    from public.costar_series s
    join cur on s.import_id = cur.id
    where s.geography_type = 'Submarket'
  ) x
  where rn = 1
),
scoped as (
  select geography_code, geography_name, cbsa_code, as_of, as_of_year,
         slice as scope, period_year, period_kind,
         inventory_units as inv, under_construction_units as uc,
         net_delivered_units_12mo as del, absorption_units_12mo as absorbed,
         occupancy_rate as occ, asking_rent_unit as ask, effective_rent_unit as eff
  from annual
  union all
  select geography_code, max(geography_name), max(cbsa_code), as_of, as_of_year,
         'Combined', period_year, period_kind,
         sum(inventory_units), sum(under_construction_units),
         sum(net_delivered_units_12mo), sum(absorption_units_12mo),
         sum(occupancy_rate * inventory_units)
           / nullif(sum(inventory_units) filter (where occupancy_rate is not null), 0),
         -- Asking and effective are weighted over the same slices, or the
         -- concession computed from them compares two different mixes.
         sum(asking_rent_unit * inventory_units) filter (where effective_rent_unit is not null)
           / nullif(sum(inventory_units) filter (where asking_rent_unit is not null and effective_rent_unit is not null), 0),
         sum(effective_rent_unit * inventory_units) filter (where asking_rent_unit is not null)
           / nullif(sum(inventory_units) filter (where asking_rent_unit is not null and effective_rent_unit is not null), 0)
  from annual
  group by geography_code, as_of, as_of_year, period_year, period_kind
),
pts as (
  select geography_code, scope,
    max(geography_name) as geography_name,
    max(cbsa_code)      as cbsa_code,
    max(as_of)          as as_of,
    -- Today's stock and pipeline come from the year-to-date row; CoStar leaves
    -- under-construction blank on the full-year estimate.
    coalesce(max(inv)      filter (where period_kind = 'ytd'), max(inv)      filter (where period_kind = 'estimate')) as inventory,
    coalesce(max(uc)       filter (where period_kind = 'ytd'), max(uc)       filter (where period_kind = 'estimate')) as uc_units,
    coalesce(max(del)      filter (where period_kind = 'ytd'), max(del)      filter (where period_kind = 'estimate')) as delivered_t12,
    coalesce(max(absorbed) filter (where period_kind = 'ytd'), max(absorbed) filter (where period_kind = 'estimate')) as absorbed_t12,
    coalesce(max(occ)      filter (where period_kind = 'ytd'), max(occ)      filter (where period_kind = 'estimate')) as occupancy,
    sum(del)   filter (where period_kind = 'forecast' and period_year between as_of_year + 1 and as_of_year + 2) as fwd_deliveries_2y,
    count(del) filter (where period_kind = 'forecast' and period_year between as_of_year + 1 and as_of_year + 2) as fwd_years,
    avg(occ)   filter (where period_kind = 'history' and period_year >= as_of_year - 10) as occupancy_10yr_mean,
    count(occ) filter (where period_kind = 'history' and period_year >= as_of_year - 10) as occupancy_years,
    -- Rents come from the full-year estimate; CoStar leaves effective rent
    -- blank on most year-to-date rows.
    coalesce(max(ask) filter (where period_kind = 'estimate'), max(ask) filter (where period_kind = 'ytd')) as ask_now,
    coalesce(max(eff) filter (where period_kind = 'estimate'), max(eff) filter (where period_kind = 'ytd')) as eff_now,
    max(ask) filter (where period_kind = 'history'  and period_year = as_of_year - 1) as ask_prev,
    max(eff) filter (where period_kind = 'history'  and period_year = as_of_year - 1) as eff_prev,
    max(eff) filter (where period_kind = 'forecast' and period_year = as_of_year + 1) as eff_f1,
    max(eff) filter (where period_kind = 'forecast' and period_year = as_of_year + 3) as eff_f3
  from scoped
  group by geography_code, scope
),
sig as (
  select p.*,
    uc_units      / nullif(inventory, 0) as uc_pct,
    delivered_t12 / nullif(inventory, 0) as delivered_t12_pct,
    case when fwd_years = 2 then fwd_deliveries_2y / nullif(inventory, 0) end as fwd_deliveries_2y_pct,
    (absorbed_t12 - delivered_t12) / nullif(inventory, 0) as demand_gap_t12_pct,
    case when occupancy_years >= 5 then occupancy - occupancy_10yr_mean end as occupancy_gap,
    1 - eff_now / nullif(ask_now, 0) as concession_now,
    (1 - eff_now / nullif(ask_now, 0)) - (1 - eff_prev / nullif(ask_prev, 0)) as concession_change,
    eff_now / nullif(eff_prev, 0) - 1 as rent_growth_t12,
    eff_f1  / nullif(eff_now, 0) - 1  as rent_forecast_1y,
    power(eff_f3 / nullif(eff_now, 0), 1.0 / 3) - 1 as rent_forecast_3y_cagr,
    coalesce(inventory, 0) >= 500 as eligible
  from pts p
),
ranked as (
  select s.*,
    case when eligible and uc_pct is not null then
      cume_dist() over (partition by scope, eligible, uc_pct is null order by uc_pct desc) end as pct_uc,
    case when eligible and fwd_deliveries_2y_pct is not null then
      cume_dist() over (partition by scope, eligible, fwd_deliveries_2y_pct is null order by fwd_deliveries_2y_pct desc) end as pct_fwd_supply,
    case when eligible and demand_gap_t12_pct is not null then
      cume_dist() over (partition by scope, eligible, demand_gap_t12_pct is null order by demand_gap_t12_pct) end as pct_demand_gap,
    case when eligible and occupancy_gap is not null then
      cume_dist() over (partition by scope, eligible, occupancy_gap is null order by occupancy_gap) end as pct_occupancy_gap,
    case when eligible and concession_change is not null then
      cume_dist() over (partition by scope, eligible, concession_change is null order by concession_change desc) end as pct_concession_change,
    case when eligible and rent_forecast_3y_cagr is not null then
      cume_dist() over (partition by scope, eligible, rent_forecast_3y_cagr is null order by rent_forecast_3y_cagr) end as pct_rent_forecast
  from sig s
)
select
  r.geography_code, r.scope, r.geography_name, r.cbsa_code, r.as_of,
  -- 'Atlanta - GA USA - Barrow County' → market 'Atlanta - GA USA', state 'GA'
  split_part(r.geography_name, ' - ', 1) || ' - ' || split_part(r.geography_name, ' - ', 2) as market_name,
  trim(substring(r.geography_name from position(' - ' in r.geography_name) + 3
       for position(' USA' in r.geography_name) - position(' - ' in r.geography_name) - 3)) as state,
  trim(substring(r.geography_name from length(split_part(r.geography_name, ' - ', 1) || ' - ' || split_part(r.geography_name, ' - ', 2)) + 4)) as submarket_name,
  r.inventory, r.uc_units, r.delivered_t12, r.absorbed_t12, r.fwd_deliveries_2y,
  r.uc_pct, r.delivered_t12_pct, r.fwd_deliveries_2y_pct, r.demand_gap_t12_pct,
  r.occupancy, r.occupancy_10yr_mean, r.occupancy_gap,
  r.ask_now, r.eff_now, r.concession_now, r.concession_change,
  r.rent_growth_t12, r.rent_forecast_1y, r.rent_forecast_3y_cagr,
  r.eligible,
  r.pct_uc, r.pct_fwd_supply, r.pct_demand_gap, r.pct_occupancy_gap,
  r.pct_concession_change, r.pct_rent_forecast,
  case when c.n >= 4 then round((100 * c.total / c.n)::numeric)::int end as cyclical_score
from ranked r
cross join lateral (
  select count(v) as n, sum(v) as total
  from unnest(array[r.pct_uc, r.pct_fwd_supply, r.pct_demand_gap, r.pct_occupancy_gap,
                    r.pct_concession_change, r.pct_rent_forecast]) as v
) c;

create unique index costar_submarket_signals_pk on public.costar_submarket_signals (geography_code, scope);

comment on materialized view public.costar_submarket_signals is
  'Supply, occupancy, concession and rent-forecast signals per CoStar submarket for the newest complete import. Refreshed by complete_market_data_import(). pct_* = favourability percentile for rent growth (1 = best) among same-scope submarkets with >= 500 units.';

-- Materialized views ignore RLS; gate reads the same way the tables are gated.
revoke all on public.costar_submarket_signals from anon, authenticated;
create or replace function public.costar_submarket_signals_for_user()
returns setof public.costar_submarket_signals
language sql stable security definer set search_path = public as $$
  select * from public.costar_submarket_signals where public.is_approved(auth.uid());
$$;
create or replace view public.costar_submarket_signals_v
with (security_invoker = true) as
  select * from public.costar_submarket_signals_for_user();
grant select on public.costar_submarket_signals_v to authenticated;
grant execute on function public.costar_submarket_signals_for_user() to authenticated;
grant select on public.costar_submarket_signals to service_role;

-- ---------------------------------------------------------------- deals
alter table public.deals
  add column if not exists costar_submarket_code text,
  add column if not exists new_supply_source     text;

comment on column public.deals.costar_submarket_code is
  'CoStar submarket geography code (APT-1-…), picked on the deal page. Drives new_supply_pct_of_stock.';
comment on column public.deals.new_supply_source is
  'costar_uc = CoStar under-construction units / inventory for the deal''s submarket; esri_housing_units = Esri 5-mi annualised housing-unit growth (the fallback when no submarket is picked).';

-- With a submarket picked, the supply figure is CoStar's and stays CoStar's:
-- a later Esri write from market-metrics-enrich is replaced on the way in.
-- Without one, whatever was written is labelled as the Esri figure it is.
create or replace function public.apply_costar_supply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v double precision;
begin
  if new.costar_submarket_code is not null then
    select uc_pct into v
    from public.costar_submarket_signals
    where geography_code = new.costar_submarket_code and scope = 'Combined';
    if v is not null then
      new.new_supply_pct_of_stock := round((v * 100)::numeric, 2);
      new.new_supply_source := 'costar_uc';
      return new;
    end if;
  end if;

  -- OLD doesn't exist on INSERT, and plpgsql doesn't short-circuit, so the
  -- UPDATE-only checks sit in their own block.
  if tg_op = 'UPDATE' then
    if old.costar_submarket_code is not null and new.costar_submarket_code is null
       and new.new_supply_source = 'costar_uc' then
      -- Submarket cleared: the CoStar figure no longer describes this deal.
      -- Esri refills it on the next rescore.
      new.new_supply_pct_of_stock := null;
      new.new_supply_source := null;
      return new;
    end if;
    if new.new_supply_pct_of_stock is not distinct from old.new_supply_pct_of_stock then
      return new;  -- figure unchanged, label unchanged
    end if;
  end if;

  -- A figure written with no usable CoStar row behind it is Esri's.
  new.new_supply_source := case when new.new_supply_pct_of_stock is null then null
                                else 'esri_housing_units' end;
  return new;
end $$;

drop trigger if exists deals_costar_supply on public.deals;
create trigger deals_costar_supply
  before insert or update of costar_submarket_code, new_supply_pct_of_stock on public.deals
  for each row execute function public.apply_costar_supply();

-- Every existing supply figure came from Esri.
update public.deals set new_supply_source = 'esri_housing_units'
where new_supply_pct_of_stock is not null and new_supply_source is null;

-- ---------------------------------------------------------------- completing an import
-- Called by the uploader after the last batch. Refuses an import whose row
-- count doesn't match what the browser parsed, since that means a batch was
-- lost. On success it replaces any earlier load of the same vintage, refreshes
-- the signals and pushes the new supply figure onto every linked deal.
create or replace function public.complete_market_data_import(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  imp public.market_data_imports;
  loaded integer;
  replaced integer;
  synced integer;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'only admins can complete a market data import';
  end if;

  select * into imp from public.market_data_imports where id = p_import_id for update;
  if not found then
    raise exception 'import % not found', p_import_id;
  end if;
  if imp.status <> 'loading' then
    raise exception 'import % is already %', p_import_id, imp.status;
  end if;

  select count(*) into loaded from public.costar_series where import_id = p_import_id;
  if loaded <> imp.row_count then
    raise exception 'import % has % rows but the file had %; not completing it', p_import_id, loaded, imp.row_count;
  end if;

  -- A second upload of the same vintage is a correction: it replaces the first.
  with gone as (
    delete from public.market_data_imports
    where source = imp.source and as_of = imp.as_of and id <> imp.id
      and status = 'complete' and geography_types && imp.geography_types
    returning 1
  ) select count(*) into replaced from gone;

  update public.market_data_imports
  set status = 'complete', completed_at = now()
  where id = p_import_id;

  refresh materialized view public.costar_submarket_signals;

  with s as (
    select geography_code, round((uc_pct * 100)::numeric, 2) as supply
    from public.costar_submarket_signals
    where scope = 'Combined' and uc_pct is not null
  ), upd as (
    update public.deals d
    set new_supply_pct_of_stock = s.supply, new_supply_source = 'costar_uc'
    from s
    where d.costar_submarket_code = s.geography_code
      and (d.new_supply_pct_of_stock is distinct from s.supply or d.new_supply_source is distinct from 'costar_uc')
    returning 1
  ) select count(*) into synced from upd;

  return jsonb_build_object('rows', loaded, 'replaced_imports', replaced, 'deals_updated', synced);
end $$;

revoke all on function public.complete_market_data_import(uuid) from public, anon;
grant execute on function public.complete_market_data_import(uuid) to authenticated;

-- ---------------------------------------------------------------- buybox signal
-- "New supply pressure" has read permits.permits_per_1k_units since May, and
-- deal-score hard-codes that to null, so the signal has never scored a deal.
-- Point it at CoStar's under-construction share instead. 0 → 100, 12% → 0:
-- the median submarket is ~1%, the 90th percentile ~11.5%. A deal with no
-- submarket picked still resolves to null and drops out, exactly as before.
update public.buy_box_signals
set name         = 'New supply pressure (CoStar under construction)',
    description  = 'Units under construction ÷ existing units in the deal''s CoStar submarket, all star slices in the latest export. A fraction: 0.05 = 5%.',
    field_source = 'costar.uc_pct',
    min_value    = 0,
    max_value    = 0.12,
    updated_at   = now()
where field_source = 'permits.permits_per_1k_units';

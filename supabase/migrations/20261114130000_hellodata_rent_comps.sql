-- Rent vs market from HelloData only: the property's listed rents against its
-- 5 HelloData comps' listed rents (hellodata-rent-comps). Replaces the deal
-- page's in-place rent vs Census tract median and the scorer's CoStar fallback.

alter table public.deals
  add column if not exists hd_subject_rent        numeric,
  add column if not exists hd_comp_market_rent    numeric,
  -- (property − market) ÷ market × 100. Negative = below market.
  add column if not exists hd_rent_vs_market_pct  numeric,
  -- The comps and the per-bedroom figures behind the number, for the deal page.
  add column if not exists hd_rent_comps          jsonb,
  add column if not exists hd_rent_comps_at       timestamptz;

-- A comp's rents, reused across deals for 30 days: neighbouring deals share
-- comps, and every /property/{id} lookup is billed.
create table if not exists public.hellodata_comp_rents (
  hellodata_id  text primary key,
  building_name text,
  street_address text,
  number_units  integer,
  year_built    integer,
  by_bed        jsonb not null default '{}'::jsonb,
  fetched_at    timestamptz not null default now()
);

alter table public.hellodata_comp_rents enable row level security;
drop policy if exists "approved users can select" on public.hellodata_comp_rents;
create policy "approved users can select" on public.hellodata_comp_rents
  for select to authenticated using (public.is_approved(auth.uid()));
-- Written only by hellodata-rent-comps (service role).

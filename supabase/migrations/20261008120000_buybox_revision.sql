-- The revised Ansonia acquisition buybox.
--
-- Three things change: the thesis text, the fields the scorer can actually read,
-- and an explicit list of target MSAs.
--
-- WHAT ALREADY MATCHED. The numeric thresholds in src/lib/dealScoring.ts turn out
-- to encode the new spec exactly: HARD_LIMITS min_units 100 / vintage_min 1980
-- are the red flags, DEFAULT_BENCHMARKS min_units 150 / vintage_min 1990 are the
-- yellow flags. That two-tier shape is the flag model, so nothing there moves.
--
-- WHAT WAS MISSING. asset_class and strategy are extracted onto inbox_deals and
-- are well populated there -- Multifamily 1140, Office 13, Retail 23, Industrial
-- 19, Development 2; Value-Add 546, Core-Plus 46, Opportunistic 9 -- but they
-- stop at the inbox. `deals` has no such columns, so once a deal was accepted the
-- platform forgot its asset class and investment profile, and no rule could read
-- them. They are added here and backfilled through accepted_deal_id.
--
-- construction_type has no source at all: nothing extracts garden vs mid-rise vs
-- high-rise. The column is added because the vintage rule depends on it (pre-1980
-- is a red flag for garden/suburban but acceptable for urban infill), but it is
-- left null rather than guessed. A null means "unknown", and the vintage rule
-- must treat unknown as the stricter case rather than silently waiving the flag.
--
-- TARGET MSAs are stored as data, not code, so the list can change without a
-- deploy. Outside them a deal is DE-PRIORITISED, never screened out -- that is
-- explicit in the buybox and is the opposite of a hard gate.

alter table public.deals
  add column if not exists asset_class       text,
  add column if not exists strategy          text,
  add column if not exists construction_type text;

comment on column public.deals.asset_class is
  'Multifamily, Office, Retail, Industrial, Hospitality, Mixed-Use, Development, Other. Carried from inbox_deals on accept.';
comment on column public.deals.strategy is
  'Value-Add, Core-Plus, Core, Opportunistic, Development. Carried from inbox_deals on accept.';
comment on column public.deals.construction_type is
  'Garden, Low-Rise, Mid-Rise, High-Rise, Urban Infill. No extractor populates this yet; null means unknown and the vintage rule treats unknown as garden (the stricter case).';

-- Backfill from the inbox rows these deals were accepted from.
update public.deals d
set asset_class = coalesce(d.asset_class, i.asset_class),
    strategy    = coalesce(d.strategy, i.strategy)
from public.inbox_deals i
where i.accepted_deal_id = d.id
  and (i.asset_class is not null or i.strategy is not null);

create table if not exists public.buy_box_target_msas (
  id         uuid primary key default gen_random_uuid(),
  msa_name   text not null unique,
  match_kind text not null default 'msa' check (match_kind in ('msa','state')),
  match_value text,
  notes      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.buy_box_target_msas is
  'Target geographies. A deal outside these is de-prioritised, never screened out. match_kind=state matches on deals.state instead of msa.';

alter table public.buy_box_target_msas enable row level security;
drop policy if exists "target msas readable by authenticated" on public.buy_box_target_msas;
create policy "target msas readable by authenticated"
  on public.buy_box_target_msas for select to authenticated using (true);
grant select on public.buy_box_target_msas to authenticated;
grant all    on public.buy_box_target_msas to service_role;

insert into public.buy_box_target_msas (msa_name, match_kind, match_value, notes) values
  ('Chicago-Naperville-Elgin, IL',          'msa',   null, 'Core market; 10 owned assets in IL'),
  ('Columbus, OH',                          'msa',   null, 'Owned: Sunbury Commons'),
  ('Madison, WI',                           'msa',   null, 'Owned: Brighton Square'),
  ('Austin-Round Rock-San Marcos, TX',      'msa',   null, 'Owned: Alara North Burnet'),
  ('Dallas-Fort Worth-Arlington, TX',       'msa',   null, 'Owned: Fielder Crossing, Cooper Denton'),
  ('Denver-Aurora-Centennial, CO',          'msa',   null, 'Target expansion; no owned assets yet'),
  ('Salt Lake City, UT',                    'msa',   null, 'Target expansion; no owned assets yet'),
  ('North Carolina (statewide)',            'state', 'NC',  'Whole state is in scope'),
  ('South Carolina (statewide)',            'state', 'SC',  'Whole state is in scope')
on conflict (msa_name) do nothing;

update public.buy_box_thesis
set content = 'ANSONIA CAPITAL MANAGEMENT — ACQUISITION BUYBOX

UNIT COUNT. Under 150 units is a yellow flag. Under 100 units is a red flag.

ASSET TYPE. Must be multifamily; anything else is a red flag. Class-B is preferred. Class-A with no value-add upside is a yellow flag, as is Class-C carrying significant deferred maintenance. Affordable housing is a GREEN flag — expiring LIHTC, project-based Section 8, or any affordability component.

VINTAGE. For garden-style/suburban product: built before 1980 is a red flag, 1980-1989 is a yellow flag, 1990 or later is preferred. Older vintage is acceptable for urban infill high-rise and other non-garden product types.

INVESTMENT PROFILE. Value-Add or Opportunistic preferred. Explicitly Core-Plus is a yellow flag. Fewer than 50% of units available to renovate is a yellow flag.

CONSTRUCTION TYPE. Garden-style, low-density (three storeys or fewer) preferred, but all multifamily product types are considered, including mid- and high-rise.

LOCATION. Score highest in these MSAs and their surrounding areas: Chicago-Naperville-Elgin IL; Columbus OH; Madison WI; Austin-Round Rock-San Marcos TX; Dallas-Fort Worth-Arlington TX; Denver-Aurora-Centennial CO; Salt Lake City UT; and anywhere in North or South Carolina. Outside this geography a deal is a yellow flag: de-prioritise it into the lower recommendation bucket, but DO NOT screen it out automatically.

ALWAYS AVOID (RED FLAG). Non-multifamily asset classes (office, retail, industrial, hotel). Development and land opportunities. Single-tenant or net-lease structures.',
    updated_at = now();

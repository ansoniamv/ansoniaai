-- Record WHERE a deal's coordinates came from, and whether geocoding was tried.
--
-- latitude/longitude are written only by esri-enrich today, which spends ArcGIS
-- credits, so a deal nobody paid to enrich simply has no coordinates and cannot
-- be plotted. A free Census pass can fill most of the gap, but only if the two
-- sources can be told apart: Esri geocodes a real street address at rooftop
-- level, Census may interpolate along an address range, and the Esri result must
-- never be silently replaced by the cheaper one.
--
-- The tri-state matters more than it looks. Without it, "we have not tried" and
-- "we tried and it failed" are the same empty cell, so a bad address is retried
-- for ever and never surfaces to be fixed:
--
--   geocode_source IS NULL + no coords  -> never attempted
--   geocode_source = 'failed'           -> attempted, coords deliberately left
--                                          NULL, geocode_error says why
--   geocode_source = 'esri' | 'census'  -> coords present and trustworthy
--
-- A failure must never be written as 0,0. Null Island is a real coordinate off
-- the coast of Africa: it would plot, it would pass a NOT NULL check, and it
-- would quietly corrupt any map or distance calculation built on it. A miss has
-- no coordinates, and says so.
--
-- geocode_address stores the one-line address the last attempt used, so a later
-- run can tell an edited address from one already tried and skip the rest.

alter table public.deals
  add column if not exists geocode_source  text,
  add column if not exists geocoded_at     timestamptz,
  add column if not exists geocode_error   text,
  add column if not exists geocode_address text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'deals_geocode_source_check'
  ) then
    alter table public.deals
      add constraint deals_geocode_source_check
      check (geocode_source is null or geocode_source in ('esri','census','failed'));
  end if;
end $$;

comment on column public.deals.geocode_source is
  'Where latitude/longitude came from: esri (paid, rooftop), census (free, may be range-interpolated), or failed. NULL means never attempted. A failed row keeps NULL coordinates — never 0,0.';
comment on column public.deals.geocode_error is
  'Why the last geocode attempt produced no coordinates. Set only when geocode_source = ''failed''.';
comment on column public.deals.geocode_address is
  'The one-line address the last attempt used, so an edited address can be distinguished from one already tried.';

-- Everything that already has coordinates got them from esri-enrich; it is the
-- only writer of these columns to date.
update public.deals
set geocode_source = 'esri',
    geocoded_at    = coalesce(enriched_at, updated_at)
where latitude is not null
  and longitude is not null
  and geocode_source is null;

create index if not exists deals_geocode_pending_idx
  on public.deals (geocode_source)
  where latitude is null or longitude is null;

-- Preserve Esri's coordinates before correcting them, and flag stale enrichment.
--
-- A spot-check against the Census geocoder found 28 of 50 Esri points more than
-- half a mile from the address on the deal, two of them on the wrong continent
-- (K Square at 51.48/-0.21 in London, East Park Apartments at 48.12/11.64 in
-- Munich) and seven sharing a city centroid — four unrelated Chicago deals all
-- sat on 41.88323/-87.63240.
--
-- Esri's values are copied here before anything is corrected. They are the input
-- the existing ring and crime enrichment was computed around, so throwing them
-- away would make it impossible to tell later which enrichment was built on
-- which point.
--
-- The staleness flag exists because the enrichment CANNOT be silently trusted
-- once the point moves. Rings and crime indices were measured around the old
-- coordinate; after a correction they describe somewhere the deal is not. A
-- stale number that still renders looks exactly like a fresh one, so the flag is
-- what lets the UI say "location corrected — enrichment pending" instead of
-- quietly showing a figure for the wrong neighbourhood. Nothing here re-runs any
-- paid enrichment.

alter table public.deals
  add column if not exists esri_latitude                numeric,
  add column if not exists esri_longitude               numeric,
  add column if not exists esri_enrichment_stale        boolean not null default false,
  add column if not exists esri_enrichment_stale_reason text,
  add column if not exists esri_addr_type               text;

comment on column public.deals.esri_latitude is
  'Latitude as Esri returned it, kept before any correction. The point the existing ring and crime enrichment was computed around.';
comment on column public.deals.esri_longitude is
  'Longitude as Esri returned it, kept before any correction.';
comment on column public.deals.esri_enrichment_stale is
  'TRUE when latitude/longitude moved after the Esri enrichment was computed, so rings, crime and tract demographics describe the old point. Show "location corrected — enrichment pending" rather than the stored figures.';
comment on column public.deals.esri_enrichment_stale_reason is
  'Why the enrichment went stale: how far the point moved, or that it was cleared.';
comment on column public.deals.esri_addr_type is
  'Esri Addr_type for the geocode, e.g. PointAddress, StreetName, Locality, POI. Only PointAddress, StreetAddress and Subaddress are address-level; the rest are centroids and must not be treated as a property location.';

-- Keep Esri's point for every row it placed, before reconciliation touches it.
update public.deals
set esri_latitude  = latitude,
    esri_longitude = longitude
where geocode_source = 'esri'
  and latitude is not null
  and longitude is not null
  and esri_latitude is null;

create index if not exists deals_esri_stale_idx
  on public.deals (esri_enrichment_stale)
  where esri_enrichment_stale;

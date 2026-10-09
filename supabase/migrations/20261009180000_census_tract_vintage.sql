-- Record WHICH tract vintage produced each GEOID.
--
-- A tract GEOID is only meaningful against the vintage it came from, and the
-- bare string does not say which. Connecticut makes that concrete: the state
-- replaced its eight counties with nine Planning Regions in 2022, and the county
-- FIPS is embedded in the GEOID. The same point in Hartford is:
--
--   Census2020_Current  -> 09003510600   (Hartford County, abolished)
--   ACS2023/2024/Current-> 09110510600   (Capitol Planning Region)
--
-- Same tract, same coordinates, different identifier. Stored bare, a GEOID that
-- silently fails to join to ACS data is indistinguishable from one that works,
-- and the failure appears as missing demographics rather than as an error.
--
-- geocode-deals moves from Census2020_Current to ACS2024_Current. 2024 is the
-- newest ACS 5-year release actually published — confirmed against the API's own
-- dataset catalogue, which lists acs/acs5 vintages through 2024. The geocoder
-- also offers ACS2025_Current and ACS2026_Current, but no ACS 5-year data exists
-- for those yet, so a GEOID on that geography would have nothing to join to.

alter table public.deals
  add column if not exists census_tract_vintage text;

comment on column public.deals.census_tract_vintage is
  'Census geography vintage that produced census_tract_id, e.g. ACS2024_Current. A GEOID is only valid against its own vintage: Connecticut tract GEOIDs differ between Census2020 and ACS2023+ because the county FIPS changed when counties became Planning Regions.';

-- Existing GEOIDs were all produced under Census2020_Current, by esri-enrich or
-- by the first geocode-deals run. Labelled as such rather than left null, so the
-- refresh pass can tell what still needs moving.
update public.deals
set census_tract_vintage = 'Census2020_Current'
where census_tract_id is not null
  and census_tract_vintage is null;

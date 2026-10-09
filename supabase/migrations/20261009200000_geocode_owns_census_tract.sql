-- Give census_tract_id a single owner, and keep HelloData's value separately.
--
-- The column was created by the HelloData migration and its comment still reads
-- "HelloData census tract GEOID". hellodataMapping writes it on every enrich:
--
--   census_tract_id: pick(p.census_tract_id, p.census_tract, p.tract_id)
--
-- so two writers were competing. The Grove At Schaumburg is the proof: its
-- hellodata_payload carries 17031804803 while every Census vintage — 2020, 2023,
-- 2024 and both TIGERweb services — puts that point in 17031804611. HelloData's
-- value was simply wrong for its own coordinates, and the next enrich would have
-- put it straight back over the ACS-aligned one.
--
-- HelloData's tract carries no vintage and we cannot know which geography it was
-- cut against, which is exactly the ambiguity census_tract_vintage exists to
-- remove. So geocode-deals becomes the only writer of census_tract_id, and
-- HelloData's value moves to its own column rather than being discarded.
--
-- On the *_tract columns: median_income_tract, median_rent_tract and the rest
-- come straight from HelloData's demographics block, not from a join on this
-- GEOID. Nothing in the codebase actually joins on census_tract_id — the "join
-- key" was documentary intent. Moving ownership therefore breaks no live query,
-- but the comments were wrong and are corrected below.

alter table public.deals
  add column if not exists hellodata_census_tract_id text;

comment on column public.deals.hellodata_census_tract_id is
  'Census tract GEOID as supplied by HelloData, of unknown vintage. Kept for comparison only. The *_tract demographic columns come from HelloData''s own demographics block and are not joined through this value. For an ACS-aligned tract use census_tract_id with census_tract_vintage.';

comment on column public.deals.census_tract_id is
  'Census tract GEOID, written ONLY by geocode-deals from the US Census geocoder. Always read it with census_tract_vintage: a GEOID is valid only against its own vintage, and Connecticut tract GEOIDs differ between Census2020 and ACS2023+ because counties became Planning Regions. HelloData''s value lives in hellodata_census_tract_id.';

-- Preserve what HelloData already supplied, from the payload rather than from
-- census_tract_id, which may since have been corrected by geocode-deals.
update public.deals
set hellodata_census_tract_id = coalesce(
      hellodata_payload->>'census_tract_id',
      hellodata_payload->>'census_tract',
      hellodata_payload->>'tract_id')
where hellodata_census_tract_id is null
  and hellodata_payload is not null
  and coalesce(
        hellodata_payload->>'census_tract_id',
        hellodata_payload->>'census_tract',
        hellodata_payload->>'tract_id') is not null;

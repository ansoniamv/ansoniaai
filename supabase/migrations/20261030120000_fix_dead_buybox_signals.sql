-- Point two buybox signals that have never scored at fields that exist.
--
-- "Population growth (5yr, tract)" read deal_enrichment.rings.5mi.pop_growth_5yr.
-- esri-enrich stores Esri's own attribute names in rings, so that key is on
-- none of the enrichment rows and the signal resolved to undefined on every
-- deal: 30% of Market Demand never counted. deal-score already copies Esri's
-- POPGRWCYFY (5-mile ring, forecast ANNUAL growth over the next five years, in
-- percent) into deals.population_growth_pct before it scores, so read that.
-- The old -5..20 range assumed a five-year total; on live data the annual rate
-- runs about -0.4 (p10) / 0.25 (median) / 1.6 (p90), so -0.5..2.0 spreads the
-- pipeline across the scale instead of bunching it near 20.
--
-- "Has high school in district" read deal_enrichment.schools.high.exists, which
-- schools-enrich never writes. A has-a-school boolean would not discriminate
-- anyway: the search widens to 25 miles until it finds one, and 62 of the 65
-- deals with school data have a high school. Niche grades would, but almost no
-- deal has one: school data is cached, and most of it predates the Firecrawl
-- key (added 2026-10-21), so grades only appear on a forced re-enrich. Distance to the picked high school is what
-- the data holds: p10 0.3 mi, median 1.2 mi, p90 2.9 mi, scored 0.5..4.0 mi.
--
-- Neither field is resolved by the inbox scorer (score-deals), before or after.
-- Changes config only. Stored ai_score values move when deals are rescored.

update public.buy_box_signals s
set field_source = 'deals.population_growth_pct',
    name = 'Population growth (annual, 5-mile)',
    description = 'Esri forecast annual population growth over the next five years within a 5-mile radius, in percent.',
    min_value = -0.5,
    max_value = 2.0,
    optimal_min = null,
    optimal_max = null,
    updated_at = now()
from public.buy_box_pillars p
where p.id = s.pillar_id and p.key = 'market_demand'
  and s.field_source = 'deal_enrichment.rings.5mi.pop_growth_5yr';

update public.buy_box_signals s
set field_source = 'deal_enrichment.schools.high.distance_mi',
    name = 'Distance to high school (mi)',
    description = 'Distance in miles to the nearest comprehensive public high school (NCES).',
    scoring_method = 'lower_better',
    min_value = 0.5,
    max_value = 4.0,
    optimal_min = null,
    optimal_max = null,
    updated_at = now()
from public.buy_box_pillars p
where p.id = s.pillar_id and p.key = 'location'
  and s.field_source = 'deal_enrichment.schools.high.exists';

-- Fix the pipeline buybox signals that gave every deal the same answer, and add
-- signals read from the broker documents parsed on the deal page.
--
-- Broken before this (all in deal-score; the inbox scorer leaves out Deal
-- Economics and resolves none of the derived.* values added here):
--
-- * Estimated equity ($M). deals.estimated_equity is stored in $M (p10 7.7,
--   median 16.4, p90 35.4) but the range was 5,000,000..100,000,000, so every
--   deal scored 0. The range is now the same 5..100, in $M.
-- * Price per unit. deals.asking_price is in $M too, so asking ÷ units came
--   out near 0.3 and every deal scored 100. derived.price_per_unit is now
--   worked out in dollars (pipelineScoreEngine.ts); the 50k..300k range stays.
-- * Affordable component. A boolean that scored every market-rate deal 0. The
--   thesis calls affordability a green flag, not its absence a red one, so it
--   now reads derived.affordable_bonus: 100 when affordable, otherwise left out.
-- * In-place rent gap. The benchmark was the Census tract median rent, which
--   counts every rental in the tract and sits below most Class-B assets, so
--   the gap was negative and scored 0 almost everywhere. derived.rent_gap_pct
--   now uses CoStar's effective rent for the deal's class in its submarket
--   when one is picked, as the Rent Growth score does. The range now starts at
--   10% above market, so a deal at market scores 33 rather than 0.
-- * Building quality score. HelloData's score is 0-100 (p10 56, median 71,
--   p90 78) but the range was 1..10, so every deal scored 100. Now 40..90.
-- * Population density. HelloData reports people per square metre (median
--   0.0014), against a 500..15,000 per-square-mile range, so every deal scored
--   0. derived.population_density_sqmi converts it; the range stays.
-- * Avg price change %. Stored as a fraction (median -0.0067) against a
--   -10..10 percent range, so every deal scored about 50.
--   derived.avg_price_change_pct converts it; the range is now -4..2 (p10
--   -3.6%, p90 +0.4%).
-- * Review average rating. Median 3.7 against a 4..5 range, so most deals
--   scored 0. Now 3..4.5.
-- * Value-add potential rating is filled on 14 of 104 deals. Its weight drops
--   from 50 to 30 now that the pillar has a loss-to-lease signal.
--
-- New, from the newest parsed rent roll / T12 (deal applied values win where
-- the deal has them). Each drops out when the deal has no such document:
--   Value-Add:      Loss-to-lease (rent roll)
--   Deal Economics: Going-in yield (T12 NOI ÷ asking), Expense ratio
--   Asset Quality:  Occupancy, Delinquency (rent roll)
--
-- Changes config only. Stored ai_score values move when deals are rescored.

update public.buy_box_signals s
set min_value = 5, max_value = 100, optimal_min = null, optimal_max = null, weight_within_pillar = 25,
    description = 'Equity the deal needs, in $M. Bigger checks score higher: $5M scores 0, $100M scores 100.',
    updated_at = now()
from public.buy_box_pillars p
where p.id = s.pillar_id and p.key = 'deal_economics' and s.field_source = 'deals.estimated_equity';

update public.buy_box_signals s
set optimal_min = null, optimal_max = null, weight_within_pillar = 30,
    description = 'Asking price divided by units, in dollars. Cheaper basis scores higher: $50k/unit scores 100, $300k/unit scores 0.',
    updated_at = now()
from public.buy_box_pillars p
where p.id = s.pillar_id and p.key = 'deal_economics' and s.field_source = 'derived.price_per_unit';

update public.buy_box_signals s
set field_source = 'derived.affordable_bonus',
    name = 'Affordable component',
    description = 'Any affordability component (LIHTC, Section 8, income restrictions) is a green flag in the thesis. Adds points when present; a market-rate deal is not marked down.',
    updated_at = now()
from public.buy_box_pillars p
where p.id = s.pillar_id and p.key = 'deal_economics' and s.field_source = 'deals.affordable';

update public.buy_box_signals s
set name = 'Rent gap to market',
    min_value = -10, max_value = 20, optimal_min = null, optimal_max = null,
    description = 'How far in-place rent sits below market rent for the asset''s class: CoStar effective rent in the submarket, or the Census tract median when no submarket is picked. Further below market means more room to push rents. 10% above market scores 0, 20% below scores 100.',
    updated_at = now()
from public.buy_box_pillars p
where p.id = s.pillar_id and p.key = 'value_add' and s.field_source = 'derived.rent_gap_pct';

update public.buy_box_signals s
set weight_within_pillar = 30,
    description = 'Analyst rating of renovation or operational upside: low, medium or high. Set it on the deal page.',
    updated_at = now()
from public.buy_box_pillars p
where p.id = s.pillar_id and p.key = 'value_add' and s.field_source = 'deals.value_add_potential';

update public.buy_box_signals s
set min_value = 40, max_value = 90, optimal_min = null, optimal_max = null,
    description = 'HelloData''s 0-100 score for building condition and amenities. 40 scores 0, 90 scores 100.',
    updated_at = now()
from public.buy_box_pillars p
where p.id = s.pillar_id and p.key = 'asset_quality' and s.field_source = 'deals.building_quality_score';

update public.buy_box_signals s
set field_source = 'derived.population_density_sqmi',
    description = 'Residents per square mile in the census tract. 500 scores 0, 15,000 scores 100.',
    updated_at = now()
from public.buy_box_pillars p
where p.id = s.pillar_id and p.key = 'market_demand' and s.field_source = 'deals.population_density_tract';

update public.buy_box_signals s
set field_source = 'derived.avg_price_change_pct',
    min_value = -4, max_value = 2, optimal_min = null, optimal_max = null,
    description = 'Change in average asking rent on listings near the property (HelloData), in percent. Falling asking rents mean a softening market. -4% scores 0, +2% scores 100.',
    updated_at = now()
from public.buy_box_pillars p
where p.id = s.pillar_id and p.key = 'market_supply' and s.field_source = 'deals.avg_price_change';

update public.buy_box_signals s
set min_value = 3, max_value = 4.5, optimal_min = null, optimal_max = null,
    description = 'Average online review rating for the property, a rough read on how the asset and area are perceived. 3.0 scores 0, 4.5 scores 100.',
    updated_at = now()
from public.buy_box_pillars p
where p.id = s.pillar_id and p.key = 'location' and s.field_source = 'deals.review_avg_rating';

insert into public.buy_box_signals
  (pillar_id, name, description, field_source, scoring_method, min_value, max_value, optimal_min, optimal_max, weight_within_pillar, is_active, sort_order)
select p.id, v.name, v.description, v.field_source, v.scoring_method, v.min_value, v.max_value, null, null, v.weight, true, v.sort_order
from (values
  ('value_add', 'Loss-to-lease',
   'How far current leases sit below the property''s own market rents on the rent roll. Upside you can capture at renewal without a renovation. 0% scores 0, 10% or more scores 100.',
   'derived.loss_to_lease_pct', 'higher_better', 0::numeric, 10::numeric, 25, 5),
  ('deal_economics', 'Going-in yield',
   'T12 NOI divided by asking price: the cap rate at the ask on trailing income. 4% scores 0, 7% or more scores 100.',
   'derived.going_in_yield_pct', 'higher_better', 4, 7, 30, 4),
  ('deal_economics', 'Expense ratio',
   'Operating expenses as a share of income on the T12. A high ratio can be upside under better management, but it is cost you buy on day one. 30% scores 100, 55% or more scores 0.',
   'derived.expense_ratio_pct', 'lower_better', 30, 55, 15, 5),
  ('asset_quality', 'Occupancy',
   'Share of units physically occupied, from the rent roll or the deal. 80% scores 0, 95% or more scores 100.',
   'derived.occupancy_pct', 'higher_better', 80, 95, 15, 5),
  ('asset_quality', 'Delinquency',
   'Balances owed by current residents as a share of one month''s rent roll. 0% scores 100, 10% or more scores 0.',
   'derived.delinquency_pct', 'lower_better', 0, 10, 10, 6)
) as v(pillar_key, name, description, field_source, scoring_method, min_value, max_value, weight, sort_order)
join public.buy_box_pillars p on p.key = v.pillar_key
where not exists (select 1 from public.buy_box_signals s where s.field_source = v.field_source);

-- Point the two "good when false" buybox booleans at their negated values.
--
-- "Not in lease-up" read deals.is_lease_up and "No revenue management" read
-- deals.uses_rev_management. A boolean signal scores true as 100, so both were
-- scored backwards: every stabilised asset got 0 on lease-up, and an asset
-- already on revenue management got 100 on a signal that exists to reward
-- operational upside. deal-score now derives the negations
-- (derived.not_lease_up, derived.no_rev_management), null when the flag is
-- unknown.
--
-- Safe in either order with the function deploy: an older deal-score resolves
-- an unknown derived.* path to undefined, so the signal drops out of its
-- pillar rather than scoring backwards. The inbox scorer (score-deals) never
-- resolved either field, before or after.
--
-- Changes config only. Stored ai_score values move when deals are rescored.

update public.buy_box_signals s
set field_source = 'derived.not_lease_up', updated_at = now()
from public.buy_box_pillars p
where p.id = s.pillar_id and p.key = 'asset_quality'
  and s.name = 'Not in lease-up' and s.field_source = 'deals.is_lease_up';

update public.buy_box_signals s
set field_source = 'derived.no_rev_management', updated_at = now()
from public.buy_box_pillars p
where p.id = s.pillar_id and p.key = 'value_add'
  and s.name = 'No revenue management' and s.field_source = 'deals.uses_rev_management';

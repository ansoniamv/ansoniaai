-- Concession spread: the average gap between advertised price and effective
-- price across available units, from HelloData's building_availability array.
--
-- This is the genuine signal that array supports. It is explicitly NOT wired
-- into the rent_lag factor: in_place_avg_rent is already derived from the same
-- array, so using it for market rent too would make both sides of the lag
-- identical and report a confident ~0% lag on every deal.
alter table public.deals add column if not exists concession_spread_pct numeric;

comment on column public.deals.concession_spread_pct is
  'Average (asking - effective) / asking across available units, as a percent. Derived from HelloData building_availability. Not an input to rent_lag — see scoreRentLag.';

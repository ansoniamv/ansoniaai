-- In-place cap rate and GRM, computed by the database on every deal.
--
-- Both columns were added in 20260630140644 and never written by anything —
-- not the edit form, HelloData, the document reader or any function — so on
-- 2026-10-21 they were empty on all 100 deals, the deal page showed blanks,
-- and Ask Atlas, which reads this table directly, saw no cap rates at all.
--
-- As generated columns they are recomputed whenever NOI, gross scheduled rent
-- or price changes, so every reader (deal page, pipeline list, exports, Atlas)
-- gets the same figure from one formula and none of them can go stale.
--
-- Units, matching how the deal page labels its inputs:
--   asking_price          $ millions  ("Asking Price ($M)")
--   t12_noi               annual $
--   gross_scheduled_rent  annual $
--   in_place_cap_rate     percent     (5.81 means 5.81%)
--   grm                   multiple    (9.27 means 9.27x)
--
-- Dropping the plain columns loses nothing: both were NULL on every row, and
-- no view, function or policy depends on them.

ALTER TABLE public.deals
  DROP COLUMN IF EXISTS in_place_cap_rate,
  DROP COLUMN IF EXISTS grm;

ALTER TABLE public.deals
  ADD COLUMN in_place_cap_rate numeric GENERATED ALWAYS AS (
    CASE WHEN t12_noi IS NOT NULL AND asking_price > 0
         THEN round(t12_noi / (asking_price * 1000000) * 100, 4)
    END
  ) STORED,
  ADD COLUMN grm numeric GENERATED ALWAYS AS (
    CASE WHEN gross_scheduled_rent > 0 AND asking_price > 0
         THEN round(asking_price * 1000000 / gross_scheduled_rent, 4)
    END
  ) STORED;

COMMENT ON COLUMN public.deals.in_place_cap_rate IS
  'Generated: T-12 NOI / (asking_price $M x 1,000,000) x 100, in percent. NULL until both inputs exist.';
COMMENT ON COLUMN public.deals.grm IS
  'Generated: asking_price $M x 1,000,000 / annual gross_scheduled_rent. NULL until both inputs exist.';

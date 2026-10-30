-- The deal page's Quick Underwrite card: T-12 NOI plus an optional adjustment,
-- capped at a rate the analyst can change, gives a back-of-envelope value to
-- read against the ask. These columns keep each deal's edits, so the whole team
-- sees the same numbers.
--
-- Units, matching the deal page's other columns:
--   quick_cap_rate             percent  (6 means 6%); NULL means the house
--                                       default, 6%, set in src/lib/quickUnderwrite.ts
--   quick_noi_adjustment       annual $, added to T-12 NOI (negative lowers it)
--   quick_noi_adjustment_note  why the adjustment was made

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS quick_cap_rate numeric
    CHECK (quick_cap_rate IS NULL OR (quick_cap_rate > 0 AND quick_cap_rate < 25)),
  ADD COLUMN IF NOT EXISTS quick_noi_adjustment numeric,
  ADD COLUMN IF NOT EXISTS quick_noi_adjustment_note text;

COMMENT ON COLUMN public.deals.quick_cap_rate IS
  'Quick Underwrite cap rate in percent (6 means 6%). NULL means the 6% house default.';
COMMENT ON COLUMN public.deals.quick_noi_adjustment IS
  'Quick Underwrite: annual $ added to T-12 NOI before capping. NULL means none.';
COMMENT ON COLUMN public.deals.quick_noi_adjustment_note IS
  'Quick Underwrite: why the NOI adjustment was made.';

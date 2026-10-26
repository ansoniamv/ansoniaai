-- Retire every pending warmth suggestion; Atlas no longer proposes warmth.
--
-- Warmth changes were rarely acted on and crowded the Atlas inbox. Since
-- 20261005220000, compute-partner-warmth wrote warmth directly but still filed a
-- pending suggestion for partners whose warmth was set by hand, and more partners
-- are hand-set now that every warmth edit locks the field. analyze-partner-emails
-- also proposed warmth from email tone. Both have stopped.
--
-- Only `pending` rows are touched: applied, rejected and superseded history stays
-- as it is.

update public.partner_suggestions
set status = 'superseded',
    reviewed_at = now()
where type = 'warmth_change'
  and status = 'pending';

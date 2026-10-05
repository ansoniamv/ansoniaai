-- Clear the pending warmth backlog; warmth is now applied directly.
--
-- compute-partner-warmth used to raise relationship_strength as a review item.
-- It never settled: the field only changed when a human applied a suggestion, so
-- the computed level kept differing from the stored one and every run re-proposed
-- for every partner — about 153 suggestions per run, every 30 minutes, each batch
-- superseding the last.
--
-- The result drowned the proposals that are worth reading. Measured across all of
-- Atlas's output: warmth_change was 321 suggestions with 1 applied and 5 rejected
-- (17% of those reviewed), and 287 of them simply proposed "Cold" across 143
-- partners. Everything drawn from what partners actually said ran at or near 100%
-- accepted — contact_add 34/34, profile_fact_add 4/4, capital_status_change 2/2,
-- avoided_market_add 2/2 — but was a small minority of the queue.
--
-- The function now writes relationship_strength directly where the field is not
-- manually locked, recording an `applied` row as the audit trail. Only a partner
-- whose warmth a human set by hand (2 of 233) still raises a real suggestion.
--
-- These pending rows carry nothing the next run will not recompute, so they are
-- retired rather than left for someone to work through. Only `pending` rows are
-- touched: applied, rejected and superseded history is evidence of past decisions
-- and stays exactly as it is.

update public.partner_suggestions
set status = 'superseded',
    reviewed_at = now()
where type = 'warmth_change'
  and status = 'pending';

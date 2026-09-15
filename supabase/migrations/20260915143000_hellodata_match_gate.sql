-- HelloData match gate.
--
-- Context: deals.address is NULL on every row, so fetch-hellodata's search was
-- always "City, State, Zip" and results[0] was accepted with no verification.
-- ~44% of enriched deals are matched to the wrong building. The gate refuses to
-- search without a street address and scores candidates before accepting one.
--
-- 'unmatched' is distinct from 'failed': failed means the call errored, unmatched
-- means we declined to guess. Both leave the queue; only unmatched is expected.

alter table public.deals drop constraint if exists deals_hellodata_status_check;

alter table public.deals
  add constraint deals_hellodata_status_check
  check (hellodata_status = any (array['pending'::text, 'fetched'::text, 'failed'::text, 'unmatched'::text]));

alter table public.deals add column if not exists hellodata_match_confidence numeric;
alter table public.deals add column if not exists hellodata_match_evidence jsonb;

comment on column public.deals.hellodata_match_confidence is
  'Percent confidence that hellodata_id is the right building. Null for matches made before the gate existed — those are unverified, not confident.';
comment on column public.deals.hellodata_match_evidence is
  'Per-signal record of why a match was accepted or refused: zip, street number, name tokens, unit count, asset-type flags. Silent acceptance is what produced the mismatch rate.';

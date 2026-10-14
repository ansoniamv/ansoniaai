-- Record that a suggested deal is already in the pipeline.
--
-- WHY A NEW COLUMN. sync-acquisitions-inbox matched new email only against
-- other inbox_deals rows, never against deals, so a broker re-sending a deal we
-- had already accepted — or one an analyst typed in by hand, which is 82 of our
-- 97 deals — arrived as a fresh suggestion every time.
--
-- The obvious cheap fix is to write gate_status = 'filtered', which already
-- routes a row into "Screened Out / Other Deals". It is the wrong field. The
-- gate is a judgement about whether the deal fits the buybox, it is recomputed
-- by gate-deals whenever the content hash changes, and a re-gate would quietly
-- un-hide the duplicate and overwrite the reason. Being a duplicate is a fact
-- about our own records, not an opinion about the deal, so it gets its own
-- column and survives re-gating.
--
-- NOT NULLABLE-AS-HIDDEN. duplicate_of_deal_id points at the deal we matched,
-- so a hidden row can always answer "which one?". ON DELETE SET NULL rather
-- than CASCADE: deleting a pipeline deal must not delete the broker email that
-- announced it. The row resurfaces, which is the correct outcome — the deal it
-- duplicated is gone.

alter table public.inbox_deals
  add column if not exists duplicate_of_deal_id uuid
    references public.deals(id) on delete set null,
  add column if not exists duplicate_reason text,
  add column if not exists duplicate_confidence text
    check (duplicate_confidence in ('exact', 'strong'));

comment on column public.inbox_deals.duplicate_of_deal_id is
  'The pipeline deal this suggestion duplicates. Set by sync-acquisitions-inbox at insert time. Routes the row to "Screened Out / Other Deals" instead of Strong/Medium/Awaiting.';
comment on column public.inbox_deals.duplicate_reason is
  'Plain-English reason, shown on the row. Never NULL when duplicate_of_deal_id is set.';
comment on column public.inbox_deals.duplicate_confidence is
  'exact = canonical property names equal. strong = equal after dropping a trailing generic word ("Apartments"), with the state corroborating.';

-- Partial, because the overwhelming majority of rows are not duplicates and the
-- only query that needs this asks for the ones that are.
create index if not exists inbox_deals_duplicate_idx
  on public.inbox_deals (duplicate_of_deal_id)
  where duplicate_of_deal_id is not null;

-- A reason is not optional. A row hidden from the inbox with nothing saying why
-- is indistinguishable from a row that was lost.
alter table public.inbox_deals
  drop constraint if exists inbox_deals_duplicate_needs_reason;
alter table public.inbox_deals
  add constraint inbox_deals_duplicate_needs_reason
  check (duplicate_of_deal_id is null or duplicate_reason is not null);

-- No backfill. Marking the existing rows would need the matcher to run over
-- live data, and this migration must not decide for anyone which of today's
-- suggestions disappear. Run the read-only query in the PR first, look at what
-- it would hide, and backfill deliberately if the list looks right.

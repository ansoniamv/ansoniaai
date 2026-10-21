-- Who set deals.costar_submarket_code.
--
-- assign-submarket now picks a submarket for every new deal with Claude. An
-- analyst needs to see which picks are a model's guess, and the auto-pick must
-- never overwrite or re-make a choice a person made — including the choice to
-- leave it blank. NULL source means nobody has decided yet.
alter table public.deals
  add column if not exists costar_submarket_source text
    check (costar_submarket_source in ('manual', 'ai')),
  add column if not exists costar_submarket_note text;

comment on column public.deals.costar_submarket_source is
  'manual = picked or cleared by a person on the deal page; ai = picked by assign-submarket. NULL = never decided, so assign-submarket may try.';
comment on column public.deals.costar_submarket_note is
  'assign-submarket''s one-line reason for its pick (or for declining to pick). NULL on manual picks.';

-- Every existing pick was made by hand on the deal page.
update public.deals
set costar_submarket_source = 'manual'
where costar_submarket_code is not null
  and costar_submarket_source is null;

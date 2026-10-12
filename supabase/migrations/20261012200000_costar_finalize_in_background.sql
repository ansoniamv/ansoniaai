-- Finish CoStar imports in a pg_cron job instead of inside the upload request.
--
-- The first real upload (2026 Q4, 69,175 rows) loaded every batch and then
-- failed in complete_market_data_import() with "canceling statement due to
-- statement timeout". Requests from signed-in users run as `authenticated`,
-- which Supabase stops after 8 s, and that function refreshed the signals
-- view (window functions over the whole series) and re-synced deals in the
-- same request. A cron job runs as postgres, which has no such limit.
--
-- So the work is split:
--   complete_market_data_import()   upload request: admin check + row-count
--                                   check, then status 'finalizing'. Milliseconds.
--   finalize_market_data_imports()  every minute via pg_cron: replace the
--                                   earlier load of the same vintage, mark
--                                   complete, refresh the view, sync deals.
-- The uploader polls the import row until it reads 'complete'.

alter table public.market_data_imports
  drop constraint if exists market_data_imports_status_check;
alter table public.market_data_imports
  add constraint market_data_imports_status_check
  check (status in ('loading', 'finalizing', 'complete'));

alter table public.market_data_imports
  add column if not exists replaced_imports integer,
  add column if not exists deals_updated    integer;

comment on column public.market_data_imports.status is
  'loading = rows being uploaded (never read); finalizing = row count verified, waiting for the cron job; complete = live.';

create or replace function public.complete_market_data_import(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  imp public.market_data_imports;
  loaded integer;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'only admins can complete a market data import';
  end if;

  select * into imp from public.market_data_imports where id = p_import_id for update;
  if not found then
    raise exception 'import % not found', p_import_id;
  end if;
  if imp.status <> 'loading' then
    raise exception 'import % is already %', p_import_id, imp.status;
  end if;

  select count(*) into loaded from public.costar_series where import_id = p_import_id;
  if loaded <> imp.row_count then
    raise exception 'import % has % rows but the file had %; not completing it', p_import_id, loaded, imp.row_count;
  end if;

  update public.market_data_imports set status = 'finalizing' where id = p_import_id;
  return jsonb_build_object('rows', loaded, 'status', 'finalizing');
end $$;

revoke all on function public.complete_market_data_import(uuid) from public, anon;
grant execute on function public.complete_market_data_import(uuid) to authenticated;

create or replace function public.finalize_market_data_imports()
returns integer language plpgsql security definer set search_path = public as $$
declare
  imp public.market_data_imports;
  replaced integer;
  synced integer;
  finished integer := 0;
begin
  -- Uploads that died part-way never reach 'finalizing' and are never read;
  -- clear their rows once they're clearly abandoned.
  delete from public.market_data_imports
  where status = 'loading' and created_at < now() - interval '6 hours';

  for imp in
    select * from public.market_data_imports
    where status = 'finalizing'
    order by created_at
    for update skip locked
  loop
    -- A second upload of the same vintage is a correction: it replaces the first.
    with gone as (
      delete from public.market_data_imports
      where source = imp.source and as_of = imp.as_of and id <> imp.id
        and status = 'complete' and geography_types && imp.geography_types
      returning 1
    ) select count(*) into replaced from gone;

    update public.market_data_imports
    set status = 'complete', completed_at = now(), replaced_imports = replaced
    where id = imp.id;
    finished := finished + 1;
  end loop;

  if finished = 0 then
    return 0;
  end if;

  refresh materialized view public.costar_submarket_signals;

  with s as (
    select geography_code, round((uc_pct * 100)::numeric, 2) as supply
    from public.costar_submarket_signals
    where scope = 'Combined' and uc_pct is not null
  ), upd as (
    update public.deals d
    set new_supply_pct_of_stock = s.supply, new_supply_source = 'costar_uc'
    from s
    where d.costar_submarket_code = s.geography_code
      and (d.new_supply_pct_of_stock is distinct from s.supply or d.new_supply_source is distinct from 'costar_uc')
    returning 1
  ) select count(*) into synced from upd;

  -- Reported on the newest import this run completed, which is the one the
  -- uploader is waiting on.
  update public.market_data_imports
  set deals_updated = synced
  where id = (select id from public.market_data_imports
              where status = 'complete' order by completed_at desc, created_at desc limit 1);

  return finished;
end $$;

revoke all on function public.finalize_market_data_imports() from public, anon, authenticated;

select cron.schedule(
  'finalize-market-data-imports',
  '* * * * *',
  $$select public.finalize_market_data_imports()$$
);

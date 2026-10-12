-- Nothing an uploader's request does may touch more than one row.
--
-- The second real upload (after 20261012200000) still failed with "canceling
-- statement due to statement timeout", and so did the browser's cleanup: the
-- import row stayed behind as 'loading'. What was left in the request was a
-- count(*) over the 69k rows just written and, on failure, a cascading delete
-- of them. Both are trivial on an idle database but evidently not within the
-- 8 s `authenticated` limit right after ~100 MB of inserts.
--
-- So the row-count check and every delete move into the pg_cron job, which
-- runs as postgres with no statement timeout:
--   complete_market_data_import()  loading → finalizing (one row)
--   discard_market_data_import()   loading → failed     (one row)
--   finalize_market_data_imports() counts rows; a mismatch marks the import
--                                  failed with the reason, a match completes
--                                  it as before; also deletes failed imports
--                                  and uploads abandoned for over an hour.

alter table public.market_data_imports
  drop constraint if exists market_data_imports_status_check;
alter table public.market_data_imports
  add constraint market_data_imports_status_check
  check (status in ('loading', 'finalizing', 'complete', 'failed'));

alter table public.market_data_imports
  add column if not exists error text;

comment on column public.market_data_imports.status is
  'loading = rows being uploaded (never read); finalizing = upload finished, waiting for the cron job to verify and publish it; complete = live; failed = rejected (see error), rows deleted by the cron job.';

create or replace function public.complete_market_data_import(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'only admins can complete a market data import';
  end if;
  update public.market_data_imports set status = 'finalizing'
  where id = p_import_id and status = 'loading';
  if not found then
    raise exception 'import % is not loading (missing, or already finished)', p_import_id;
  end if;
  return jsonb_build_object('status', 'finalizing');
end $$;

create or replace function public.discard_market_data_import(p_import_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'only admins can discard a market data import';
  end if;
  update public.market_data_imports
  set status = 'failed', error = coalesce(p_reason, 'upload abandoned')
  where id = p_import_id and status = 'loading';
end $$;

revoke all on function public.complete_market_data_import(uuid) from public, anon;
revoke all on function public.discard_market_data_import(uuid, text) from public, anon;
grant execute on function public.complete_market_data_import(uuid) to authenticated;
grant execute on function public.discard_market_data_import(uuid, text) to authenticated;

create or replace function public.finalize_market_data_imports()
returns integer language plpgsql security definer set search_path = public as $$
declare
  imp public.market_data_imports;
  loaded integer;
  replaced integer;
  synced integer;
  finished integer := 0;
begin
  -- Rejected imports keep their row (with the reason) for the history table;
  -- only their series rows go. Abandoned uploads go entirely.
  delete from public.costar_series s
  using public.market_data_imports i
  where s.import_id = i.id and i.status = 'failed';
  delete from public.market_data_imports
  where status = 'loading' and created_at < now() - interval '1 hour';

  for imp in
    select * from public.market_data_imports
    where status = 'finalizing'
    order by created_at
    for update skip locked
  loop
    select count(*) into loaded from public.costar_series where import_id = imp.id;
    if loaded <> imp.row_count then
      update public.market_data_imports
      set status = 'failed',
          error = format('the database holds %s rows but the file had %s; upload it again', loaded, imp.row_count)
      where id = imp.id;
      delete from public.costar_series where import_id = imp.id;
      continue;
    end if;

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

  update public.market_data_imports
  set deals_updated = synced
  where id = (select id from public.market_data_imports
              where status = 'complete' order by completed_at desc, created_at desc limit 1);

  return finished;
end $$;

revoke all on function public.finalize_market_data_imports() from public, anon, authenticated;

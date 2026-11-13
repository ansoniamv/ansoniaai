-- Every new deal is enriched on the server, without anyone keeping a tab open.
--
-- Until now the work after "Add to Pipeline" was fired from the browser:
-- Esri, schools, the score, the submarket pick and the deal agents, each a
-- fire-and-forget call that died with the tab, and HelloData not at all (the
-- insert trigger only marked it 'pending'; nothing drained the queue). Deals
-- created by hand or from Atlas got a different subset again.
--
-- Now an insert on deals queues one deal_onboarding row and asks onboard-deal
-- to run it. onboard-deal runs every step from the server and records each
-- step's outcome on the row, so the deal page can show what landed and what
-- did not. A sweep every 2 minutes picks up a row whose kickoff call was lost.

create table if not exists public.deal_onboarding (
  deal_id     uuid primary key references public.deals(id) on delete cascade,
  status      text not null default 'queued'
              check (status in ('queued', 'running', 'done', 'failed')),
  -- step name -> { status: ok | failed | skipped, detail, ms, at }
  steps       jsonb not null default '{}'::jsonb,
  attempts    integer not null default 0,
  queued_at   timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz,
  error       text
);

alter table public.deal_onboarding enable row level security;

drop policy if exists "approved users can select" on public.deal_onboarding;
create policy "approved users can select" on public.deal_onboarding
  for select to authenticated using (public.is_approved(auth.uid()));
-- Writes come only from onboard-deal (service role) and the trigger below.

-- ------------------------------------------------------------ kickoff

create or replace function public.queue_deal_onboarding()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.deal_onboarding (deal_id) values (new.id)
  on conflict (deal_id) do nothing;

  -- The call is queued by pg_net and sent after this transaction commits, so
  -- onboard-deal always finds the row. A failure here must never stop a deal
  -- being created: the sweep below runs anything this call did not reach.
  begin
    perform net.http_post(
      url := 'https://pyndxntvoixxndbwiawd.supabase.co/functions/v1/onboard-deal',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_shared_secret')),
      body := jsonb_build_object('action', 'run', 'deal_id', new.id),
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'deal onboarding kickoff failed for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists deals_queue_onboarding on public.deals;
create trigger deals_queue_onboarding
  after insert on public.deals
  for each row execute function public.queue_deal_onboarding();

-- ------------------------------------------------------------ sweep

select cron.unschedule('deal-onboarding-sweep')
where exists (select 1 from cron.job where jobname = 'deal-onboarding-sweep');

select cron.schedule(
  'deal-onboarding-sweep',
  '*/2 * * * *',
  $job$
  select net.http_post(
    url := 'https://pyndxntvoixxndbwiawd.supabase.co/functions/v1/onboard-deal',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
      'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_shared_secret')),
    body := '{"action":"sweep"}'::jsonb,
    timeout_milliseconds := 10000);
  $job$
);

-- ------------------------------------------------------------ document figures
-- parse-deal-document turns a document into proposals that a person applies.
-- A figure for a field the deal has no value for yet has nothing to be checked
-- against, so the server now fills those itself, with the same source citation
-- a manual apply writes. A figure that would CHANGE a value stays a proposal
-- for a person to decide. Service role only: the function is the only caller.

create or replace function public.fill_blank_fields_from_document(_document_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  allowed constant text[] := array[
    'unit_count', 'vintage_year', 'total_sqft', 'occupancy_pct',
    'in_place_avg_rent', 'gross_scheduled_rent', 't12_noi', 't12_opex',
    'expense_ratio', 'asking_price'
  ];
  p        public.deal_document_proposals%rowtype;
  doc      public.deal_documents%rowtype;
  prior    public.deal_document_proposals%rowtype;
  col_type text;
  cur_val  jsonb;
  filled   integer := 0;
begin
  select * into doc from public.deal_documents where id = _document_id;
  if not found then
    return 0;
  end if;

  for p in
    select * from public.deal_document_proposals
    where document_id = _document_id and status = 'pending' and field = any(allowed)
    for update
  loop
    -- Read under a row lock: a value set a moment ago, by a person or by
    -- another document, is seen here.
    execute format('select to_jsonb(%I) from public.deals where id = $1 for update', p.field)
      into cur_val using p.deal_id;

    if cur_val is not null and cur_val <> 'null'::jsonb then
      -- Not blank. The one value this may still replace is one filled here
      -- earlier from a LESS trusted document (an OM's NOI, then the T12's),
      -- and only while the deal still holds exactly that value. Anything a
      -- person applied or typed stays theirs.
      select * into prior from public.deal_document_proposals
      where deal_id = p.deal_id and field = p.field and status = 'applied'
      order by decided_at desc nulls last
      limit 1;
      if not found
         or prior.decided_by is not null
         or prior.rank >= p.rank
         or (prior.value #>> '{}')::numeric is distinct from (cur_val #>> '{}')::numeric then
        continue;
      end if;
    end if;

    select format_type(a.atttypid, a.atttypmod) into col_type
    from pg_attribute a
    where a.attrelid = 'public.deals'::regclass and a.attname = p.field and not a.attisdropped;

    execute format(
      'UPDATE public.deals SET %I = ($1 #>> ''{}'')::%s, field_sources = $3 WHERE id = $2',
      p.field, col_type
    ) using p.value, p.deal_id,
      jsonb_build_object(p.field, public.deal_document_field_source(p, doc, now()));

    update public.deal_document_proposals
       set status = 'applied', decided_at = now()
     where id = p.id;

    -- decided_by stays null: that is what marks a fill made here rather than
    -- by a person, and what lets a more trusted document replace it later.
    -- Other documents' pending figures for the field now propose a change to a
    -- value, which is a person's call; they stay pending.
    filled := filled + 1;
  end loop;

  return filled;
end;
$function$;

revoke all on function public.fill_blank_fields_from_document(uuid) from public, anon, authenticated;
grant execute on function public.fill_blank_fields_from_document(uuid) to service_role;

-- Property Research v2 — web research agent
--
-- Adds: a durable snapshot table, an async job table (research outlives the
-- HTTP request), and a cost governor so this feature can never repeat the
-- runaway spend that got it paused.

-- ---------------------------------------------------------------------------
-- 1. Snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.property_research (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid references public.deals(id) on delete cascade,
  address       text,
  property_name text,
  snapshot      jsonb not null,
  model         text,
  cost_usd      numeric(10,6),
  searches_used int,
  fetches_used  int,
  duration_ms   int,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);

create index if not exists property_research_deal_idx
  on public.property_research (deal_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Async jobs
--    Real multi-source research runs well past any browser or edge-function
--    request timeout. The button starts a job; the UI subscribes.
-- ---------------------------------------------------------------------------
create table if not exists public.property_research_jobs (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid references public.deals(id) on delete cascade,
  address       text,
  property_name text,
  depth         text not null default 'standard'
                  check (depth in ('quick','standard','deep')),
  status        text not null default 'queued'
                  check (status in ('queued','running','succeeded','failed','cancelled')),
  progress      text,
  snapshot      jsonb,
  research_id   uuid references public.property_research(id) on delete set null,
  error         text,
  model         text,
  cost_usd      numeric(10,6),
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);

create index if not exists property_research_jobs_deal_idx
  on public.property_research_jobs (deal_id, created_at desc);

-- Only one live job per deal. Prevents an impatient double-click from
-- buying the same research twice.
create unique index if not exists property_research_jobs_one_active
  on public.property_research_jobs (deal_id)
  where status in ('queued','running');

-- ---------------------------------------------------------------------------
-- 3. Cost governor
--    Single row. This is the control that replaces the hardcoded
--    `const isPaused = true` in the panel.
-- ---------------------------------------------------------------------------
create table if not exists public.property_research_settings (
  id                       int primary key default 1 check (id = 1),
  enabled                  boolean not null default false,
  monthly_budget_usd       numeric(10,2) not null default 100.00,
  max_cost_per_run_usd     numeric(10,2) not null default 2.00,
  default_depth            text not null default 'standard'
                             check (default_depth in ('quick','standard','deep')),
  cooldown_hours           int not null default 168,  -- re-research a deal at most weekly
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users(id)
);

insert into public.property_research_settings (id) values (1)
  on conflict (id) do nothing;

-- Month-to-date spend for this feature, read by the edge function before
-- every run. Reads ai_usage_log, which logUsage.ts already writes.
create or replace function public.property_research_mtd_spend()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(cost_usd), 0)::numeric
  from public.ai_usage_log
  where function_name = 'property-research'
    and created_at >= date_trunc('month', now());
$$;

-- ---------------------------------------------------------------------------
-- 4. Model pricing rows so cost logging is accurate
--    logUsage.ts reads ai_model_pricing by model id, so a row for the wrong
--    model logs cost_usd as 0. This feature runs on claude-sonnet-5 (see
--    const MODEL in the edge function), NOT Opus — an Opus row here would do
--    nothing for a Sonnet run.
--
--    claude-sonnet-5 is already present at these rates from 20260916190100;
--    this upsert is deliberate belt-and-braces so the migration is
--    self-contained rather than depending on that earlier file.
-- ---------------------------------------------------------------------------
insert into public.ai_model_pricing (model, provider, input_per_mtok, output_per_mtok, cached_input_per_mtok)
values ('claude-sonnet-5', 'anthropic', 2.00, 10.00, 0.20)
on conflict (model) do update
  set input_per_mtok        = excluded.input_per_mtok,
      output_per_mtok       = excluded.output_per_mtok,
      cached_input_per_mtok = excluded.cached_input_per_mtok,
      provider              = excluded.provider;

-- Server-side web search is billed per search, separately from tokens.
-- billing_type / per_call_usd exist on this table (added after the original
-- pricing migration), so this insert is valid as written.
insert into public.ai_model_pricing (model, provider, billing_type, per_call_usd)
values ('anthropic_web_search', 'anthropic', 'request', 0.01)
on conflict (model) do nothing;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
alter table public.property_research           enable row level security;
alter table public.property_research_jobs      enable row level security;
alter table public.property_research_settings  enable row level security;

-- Authenticated users read research and jobs. Writes happen only through the
-- edge function, which uses the service role and bypasses RLS.
create policy "read research" on public.property_research
  for select to authenticated using (true);

create policy "read jobs" on public.property_research_jobs
  for select to authenticated using (true);

create policy "read settings" on public.property_research_settings
  for select to authenticated using (true);

-- Admin-only. The source version used `using (true)`, which would let ANY
-- authenticated user raise monthly_budget_usd — the one control standing
-- between this feature and the runaway spend that got it paused. The predicate
-- is the same one five existing migrations use for admin-gated writes.
create policy "update settings" on public.property_research_settings
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Let the UI subscribe to job rows in realtime.
-- Guarded: adding a table already in the publication is an error, and every
-- other statement in this file is safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'property_research_jobs'
  ) then
    alter publication supabase_realtime add table public.property_research_jobs;
  end if;
end $$;

-- Scope the AI spend views to Anthropic.
--
-- 20260923223000 summed ai_usage_log without filtering by provider, so the
-- totals included Esri and HelloData — per-call enrichment APIs billed to
-- separate accounts, not to Anthropic Console credits. Measured immediately
-- after that migration applied: month_usd 198.56, today_usd 18.14, of which
-- $16.02 in a single day was esri-enrich.
--
-- The budget guard reads these figures. Against a $90 monthly cap, the unfiltered
-- total would have refused every AI call on the first request — a self-inflicted
-- outage caused by the control meant to prevent one. The caps govern Anthropic
-- credits, so the views must measure only Anthropic.
--
-- Esri and HelloData still need watching; they are simply a different budget,
-- and connectors.esri already carries its own monthly_cap_usd.

create or replace view public.ai_spend_today as
  select
    function_name,
    coalesce(model, '(unknown)') as model,
    count(*)                      as calls,
    sum(input_tokens)             as input_tokens,
    sum(output_tokens)            as output_tokens,
    round(sum(cost_usd)::numeric, 4) as cost_usd
  from public.ai_usage_log
  where provider = 'anthropic'
    and created_at >= date_trunc('day', now() at time zone 'utc')
  group by 1, 2;

create or replace view public.ai_spend_month as
  select
    function_name,
    coalesce(model, '(unknown)') as model,
    count(*)                      as calls,
    sum(input_tokens)             as input_tokens,
    sum(output_tokens)            as output_tokens,
    round(sum(cost_usd)::numeric, 4) as cost_usd
  from public.ai_usage_log
  where provider = 'anthropic'
    and created_at >= date_trunc('month', now() at time zone 'utc')
  group by 1, 2;

create or replace view public.ai_spend_week as
  select
    function_name,
    coalesce(model, '(unknown)') as model,
    count(*)                      as calls,
    round(sum(cost_usd)::numeric, 4) as cost_usd
  from public.ai_usage_log
  where provider = 'anthropic'
    and created_at >= now() - interval '7 days'
  group by 1, 2;

create or replace function public.ai_spend_totals(exempt_function_names text[] default '{}')
returns table (today_usd numeric, month_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(cost_usd) filter (
      where created_at >= date_trunc('day', now() at time zone 'utc')
        and not (function_name = any(exempt_function_names))
    ), 0)::numeric as today_usd,
    coalesce(sum(cost_usd) filter (
      where created_at >= date_trunc('month', now() at time zone 'utc')
    ), 0)::numeric as month_usd
  from public.ai_usage_log
  where provider = 'anthropic';
$$;

comment on function public.ai_spend_totals(text[]) is
  'Estimated ANTHROPIC spend for the current UTC day and month. Excludes Esri/HelloData, which bill to separate accounts. The day figure can exempt named functions (the backlog drain), which still count toward the month.';

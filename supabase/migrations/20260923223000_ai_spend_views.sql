-- Spend visibility for the AI budget caps.
--
-- The caps in _shared/aiBudget.ts read these, and api-status renders them. They
-- exist as views rather than as inline SQL in the edge function so the window
-- definitions ("today", "this month") live in one place and cannot drift between
-- the thing that enforces the cap and the thing that reports it.
--
-- Day boundary is UTC, deliberately: the edge functions have no local timezone,
-- and a cap that resets at a different instant from the one the status page
-- displays is a support ticket waiting to happen.

-- Per-function spend for the current UTC day.
create or replace view public.ai_spend_today as
  select
    function_name,
    coalesce(model, '(unknown)') as model,
    count(*)                      as calls,
    sum(input_tokens)             as input_tokens,
    sum(output_tokens)            as output_tokens,
    round(sum(cost_usd)::numeric, 4) as cost_usd
  from public.ai_usage_log
  where created_at >= date_trunc('day', now() at time zone 'utc')
  group by 1, 2;

-- Per-function spend for the current UTC calendar month.
create or replace view public.ai_spend_month as
  select
    function_name,
    coalesce(model, '(unknown)') as model,
    count(*)                      as calls,
    sum(input_tokens)             as input_tokens,
    sum(output_tokens)            as output_tokens,
    round(sum(cost_usd)::numeric, 4) as cost_usd
  from public.ai_usage_log
  where created_at >= date_trunc('month', now() at time zone 'utc')
  group by 1, 2;

-- Rolling 7 days, for the weekly figure on the status page.
create or replace view public.ai_spend_week as
  select
    function_name,
    coalesce(model, '(unknown)') as model,
    count(*)                      as calls,
    round(sum(cost_usd)::numeric, 4) as cost_usd
  from public.ai_usage_log
  where created_at >= now() - interval '7 days'
  group by 1, 2;

/*
 * The two totals the budget guard actually gates on.
 *
 * SECURITY DEFINER so the edge function can call it with the anon key if it ever
 * needs to, and so the numbers cannot be skewed by a caller's RLS view of
 * ai_usage_log. It returns two scalars and nothing identifying.
 *
 * `exempt_function_names` lets the backlog drain count toward the monthly total
 * while being excluded from the daily one — the drain is a deliberate one-off
 * that would otherwise trip a cap sized for steady state.
 */
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
  from public.ai_usage_log;
$$;

grant select on public.ai_spend_today, public.ai_spend_month, public.ai_spend_week to authenticated;
grant execute on function public.ai_spend_totals(text[]) to authenticated, anon, service_role;

comment on function public.ai_spend_totals(text[]) is
  'Estimated AI spend for the current UTC day and month. The day figure can exempt named functions (the backlog drain), which still count toward the month.';

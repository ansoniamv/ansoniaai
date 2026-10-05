-- Make the AI spend views respect RLS, and stop anon reading the spend total.
--
-- Two separate mistakes in 20260923223000, both mine.
--
-- 1. The three views were created without `security_invoker`, so they default to
--    the view owner's privileges and bypass row-level security on
--    ai_usage_log. The Supabase advisor flags this as a SECURITY DEFINER view.
--
--    Practical exposure today is small: the views emit only aggregated cost
--    telemetry (function_name, model, call and token counts, dollars) with no
--    deal_id, partner_id or any business data, and 20260715193453 already grants
--    SELECT on ai_usage_log to authenticated under a matching policy. So the
--    views bypass a policy that permits the same reads. The problem is that this
--    is SILENT: the day ai_usage_log gains per-user restrictions, these views
--    would keep ignoring them and nothing would say so.
--
--    Switching to invoker semantics is safe precisely because of that existing
--    grant — the check now runs as the caller, and for `authenticated` it still
--    passes. Edge functions are unaffected; they read with the service role.
--
-- 2. Worse, and NOT what the advisor flagged: execute on ai_spend_totals was
--    granted to `anon`. The function is SECURITY DEFINER and returns total
--    Anthropic spend for the day and month, and the publishable key ships in the
--    browser bundle — so that grant put the company's AI spend behind a key that
--    is, by design, public.
--
--    The stated reason ("so the edge function can call it with the anon key")
--    was wrong. Edge functions authenticate with the service role, which bypasses
--    grants entirely. The anon grant bought nothing.
--
-- The budget guard keeps working throughout: it calls ai_spend_totals as
-- service_role, whose grant is untouched.

alter view public.ai_spend_today set (security_invoker = on);
alter view public.ai_spend_month set (security_invoker = on);
alter view public.ai_spend_week  set (security_invoker = on);

revoke execute on function public.ai_spend_totals(text[]) from anon;

comment on view public.ai_spend_today is
  'Anthropic spend for the current UTC day, by function and model. security_invoker: RLS on ai_usage_log applies to the caller.';
comment on view public.ai_spend_month is
  'Anthropic spend for the current UTC month, by function and model. security_invoker: RLS on ai_usage_log applies to the caller.';
comment on view public.ai_spend_week is
  'Anthropic spend for the trailing 7 days, by function and model. security_invoker: RLS on ai_usage_log applies to the caller.';

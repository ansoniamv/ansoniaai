-- Actually stop anon executing ai_spend_totals.
--
-- 20261005160000 did `revoke execute ... from anon` and that was not enough.
-- Postgres grants EXECUTE on every new function to PUBLIC by default, so the
-- ACL read:
--
--   {=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--
-- The leading `=X/` is PUBLIC. Revoking from `anon` removed anon's explicit
-- entry while leaving the privilege it was actually using, so
-- has_function_privilege('anon', ...) still returned true afterwards. Revoking
-- from a role that was never the source of the privilege changes nothing.
--
-- Verified against the live database after 20261005160000 applied, which is the
-- only reason this was caught: the migration reported success and the advisor
-- finding it targeted was genuinely fixed, but this half of it had not worked.
--
-- Revoke from PUBLIC, then re-grant explicitly to the two roles that need it.
-- The explicit grants already exist; they are restated so this migration is
-- self-contained and correct if replayed against a rebuilt database.

revoke execute on function public.ai_spend_totals(text[]) from public;

grant execute on function public.ai_spend_totals(text[]) to authenticated, service_role;

comment on function public.ai_spend_totals(text[]) is
  'Estimated ANTHROPIC spend for the current UTC day and month. Excludes Esri/HelloData, which bill to separate accounts. The day figure can exempt named functions (the backlog drain), which still count toward the month. EXECUTE is revoked from PUBLIC: the publishable key ships in the browser bundle, so a PUBLIC grant would expose company spend to anyone.';

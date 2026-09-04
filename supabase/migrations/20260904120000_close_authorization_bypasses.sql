-- ============================================================================
-- Close authorization bypasses found in the September 2026 security audit.
--
-- 1. merge_partners / accept_inbox_deal: SECURITY DEFINER, granted to
--    `authenticated`, with no caller authorization check at all — a complete
--    bypass of the is_approved() gate that 20260727175345 built.
-- 2. recompute_deal_total_committed: never had an explicit grant, so Postgres
--    left EXECUTE to PUBLIC — an anonymous write path into public.deals.
-- 3. Eight tables were omitted from the lockdown migration's arrays and are
--    still USING (true) for any authenticated user; buy_box_criteria is open to
--    `public`, i.e. anon, for all four operations.
-- 4. ai_usage_daily lost security_invoker when 20260715195038 dropped and
--    recreated it five minutes after 20260715193529 had set the flag.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Authorization on the two SECURITY DEFINER RPCs.
--
-- Both are gated by wrapping rather than by re-declaring their bodies. The
-- merge logic in particular is ~180 lines of field-by-field reconciliation, and
-- a transcription slip there would silently corrupt capital-partner records;
-- wrapping leaves that logic byte-identical. The inner functions keep their
-- SECURITY DEFINER rights but lose EXECUTE for every client role, so the
-- wrapper is the only reachable entry point.
--
-- NOTE for future edits: a plain `CREATE OR REPLACE FUNCTION merge_partners`
-- would replace the wrapper and silently drop the guard. Change the
-- `_unguarded` body instead, and keep the wrapper intact.
-- ----------------------------------------------------------------------------

DO $do$
BEGIN
  -- Idempotent: only rename if the guarded wrapper is not already in place.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'merge_partners_unguarded'
  ) THEN
    ALTER FUNCTION public.merge_partners(uuid, uuid) RENAME TO merge_partners_unguarded;
  END IF;
END
$do$;

REVOKE ALL ON FUNCTION public.merge_partners_unguarded(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_partners_unguarded(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.merge_partners_unguarded(uuid, uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.merge_partners(_primary_id uuid, _duplicate_id uuid)
RETURNS public.partners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Repoints ten child tables, issues three DELETEs, overwrites the surviving
  -- partner, and returns the full merged row. Approved users only.
  IF NOT public.is_approved(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN public.merge_partners_unguarded(_primary_id, _duplicate_id);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_partners(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_partners(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.merge_partners(uuid, uuid) TO authenticated, service_role;


DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'accept_inbox_deal_unguarded'
  ) THEN
    ALTER FUNCTION public.accept_inbox_deal(uuid) RENAME TO accept_inbox_deal_unguarded;
  END IF;
END
$do$;

REVOKE ALL ON FUNCTION public.accept_inbox_deal_unguarded(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_inbox_deal_unguarded(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.accept_inbox_deal_unguarded(uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.accept_inbox_deal(_inbox_deal_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Promotes an inbox row into public.deals. Approved users only.
  IF NOT public.is_approved(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN public.accept_inbox_deal_unguarded(_inbox_deal_id);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_inbox_deal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_inbox_deal(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_inbox_deal(uuid) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 2. recompute_deal_total_committed is called only from triggers, which execute
--    as the table owner. No client role needs EXECUTE, and PUBLIC held it by
--    default, which made it an anonymous UPDATE path into public.deals (and an
--    oracle distinguishing valid deal ids from invalid ones).
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.recompute_deal_total_committed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_deal_total_committed(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.recompute_deal_total_committed(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_deal_total_committed(uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- 3. Bring the tables the lockdown migration missed behind is_approved().
--
-- These held the learned acquisition strategy (which is injected into every
-- gating and scoring prompt), the staff directory, connector configuration, AI
-- model pricing, the partner export log, and a deal-status backup — all
-- readable by any authenticated user, approved or not.
-- ----------------------------------------------------------------------------

-- buy_box_criteria is the worst of the set: all four policies are granted
-- TO public, which includes anon. Anyone holding the publishable key could read
-- and rewrite the buy-box criteria.
DO $do$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'buy_box_criteria'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.buy_box_criteria', pol.policyname);
  END LOOP;
END
$do$;

REVOKE ALL ON public.buy_box_criteria FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.buy_box_criteria TO authenticated;
GRANT ALL ON public.buy_box_criteria TO service_role;
ALTER TABLE public.buy_box_criteria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approved users can select" ON public.buy_box_criteria
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
CREATE POLICY "approved users can insert" ON public.buy_box_criteria
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can update" ON public.buy_box_criteria
  FOR UPDATE TO authenticated USING (public.is_approved(auth.uid()))
  WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can delete" ON public.buy_box_criteria
  FOR DELETE TO authenticated USING (public.is_approved(auth.uid()));


-- The remaining seven keep their existing admin-only write policies; only the
-- permissive `USING (true)` read policy is replaced with the approved gate.
DO $do$
DECLARE
  t text;
  tables text[] := ARRAY[
    'ai_model_pricing',
    'connectors',
    'learned_strategy',
    'learned_partner_strategy',
    'partner_pipeline_exports',
    'team_members',
    'deals_status_backup_20260818'
  ];
  pol record;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      CONTINUE;
    END IF;

    -- Drop only the unrestricted SELECT policies; admin write policies stay.
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND cmd = 'SELECT'
        AND coalesce(qual, '') IN ('true', '(true)')
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND policyname = 'approved users can select'
    ) THEN
      EXECUTE format(
        $p$CREATE POLICY "approved users can select" ON public.%I
             FOR SELECT TO authenticated USING (public.is_approved(auth.uid()))$p$, t);
    END IF;
  END LOOP;
END
$do$;


-- ----------------------------------------------------------------------------
-- 4. Restore security_invoker on ai_usage_daily. Without it the view runs with
--    its owner's rights, so it reads ai_usage_log regardless of that table's
--    RLS — re-opening what 20260715193529 had already closed.
-- ----------------------------------------------------------------------------

ALTER VIEW public.ai_usage_daily SET (security_invoker = true);


-- ----------------------------------------------------------------------------
-- 5. Post-conditions, reported rather than enforced.
--
-- These deliberately RAISE WARNING instead of EXCEPTION. The repo cannot be
-- diffed against the live schema from here, so an assertion that tripped on a
-- table this migration does not know about would abort the whole transaction
-- and none of the fixes above would land. Read these lines in the migration
-- output; anything listed still needs a follow-up migration.
-- ----------------------------------------------------------------------------

DO $do$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO offending
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

  IF offending IS NOT NULL THEN
    RAISE WARNING 'AUDIT: tables in public without RLS: %', offending;
  END IF;

  SELECT string_agg(DISTINCT table_name, ', ') INTO offending
  FROM information_schema.role_table_grants
  WHERE grantee = 'anon' AND table_schema = 'public';

  IF offending IS NOT NULL THEN
    RAISE WARNING 'AUDIT: anon still holds grants on: %', offending;
  END IF;

  -- Any remaining permissive read policy is a gate bypass.
  SELECT string_agg(format('%s.%s', tablename, policyname), ', ') INTO offending
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd = 'SELECT'
    AND coalesce(qual, '') IN ('true', '(true)');

  IF offending IS NOT NULL THEN
    RAISE WARNING 'AUDIT: permissive SELECT policies remain: %', offending;
  END IF;
END
$do$;

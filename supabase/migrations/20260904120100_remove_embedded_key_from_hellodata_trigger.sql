-- ============================================================================
-- trigger_fetch_hellodata embedded a Supabase JWT in cleartext in SQL, readable
-- by anyone who can run pg_get_functiondef. The token decodes to role "anon",
-- so it is public by design and needs no rotation — but a credential literal in
-- a function body is the wrong pattern, and the next person to copy it may not
-- be pasting a public key.
--
-- It also never worked. fetch-hellodata calls requireApprovedUser, which
-- rejects the anon key, so every deal insert since this trigger was deployed
-- has produced a 401 that nothing surfaced. Enrichment has in practice been
-- driven by the explicit UI action in DealDetail and by the cron chain.
--
-- Rather than move a real credential into SQL, the trigger now records intent
-- and lets an authorized caller do the work. Deals land with
-- hellodata_status = 'pending', which is the state the UI already renders and
-- the same state the trigger's failed call left behind.
--
-- To restore automatic enrichment, drain the queue from a trusted context —
-- either a pg_cron job that reads the service-role key from Supabase Vault
-- (never inline), or a scheduled edge function selecting
-- `deals WHERE hellodata_status = 'pending'`. Do not reintroduce a literal key.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trigger_fetch_hellodata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _enabled BOOLEAN;
BEGIN
  SELECT enabled INTO _enabled FROM public.connectors WHERE key = 'hellodata';
  IF COALESCE(_enabled, true) = false THEN
    RETURN NEW;
  END IF;

  -- Mark for enrichment instead of calling out with an embedded credential.
  IF NEW.hellodata_status IS NULL THEN
    NEW.hellodata_status := 'pending';
  END IF;

  RETURN NEW;
END;
$function$;

-- The function now mutates NEW, so it has to run BEFORE the row is written.
-- Recreate the trigger accordingly; the old AFTER timing would discard the
-- assignment silently.
DO $do$
DECLARE
  tg record;
BEGIN
  FOR tg IN
    SELECT t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND c.relname = 'deals'
      AND p.proname = 'trigger_fetch_hellodata'
      AND NOT t.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.deals', tg.tgname);
  END LOOP;
END
$do$;

CREATE TRIGGER deals_mark_hellodata_pending
BEFORE INSERT ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.trigger_fetch_hellodata();


-- ============================================================================
-- warmth_import_log is the audit trail for the bulk warmth import, which the UI
-- treats as admin-only (src/pages/WarmthImportPage.tsx gates the whole page on
-- isAdmin). The table's INSERT policy allowed any approved user, so the trail
-- could be written — or forged — by a non-admin going straight to PostgREST.
-- This table is written from nowhere else in the codebase, so restricting it to
-- admins matches its only caller.
--
-- KNOWN GAP, deliberately not closed here: the import's actual effect is an
-- UPDATE of partners.relationship_strength, and `partners` is gated only by
-- is_approved(). Any approved user can still rewrite warmth in bulk via the
-- API, bypassing the UI's admin check. Closing that properly means moving the
-- import loop into an admin-gated edge function (requireRole(req, 'admin')),
-- because a column-level trigger here would also block the partner_suggestions
-- acceptance flow, which legitimately writes this column as a non-admin. That
-- needs a decision about who may change warmth, so it is left explicit rather
-- than guessed at.
-- ============================================================================

DROP POLICY IF EXISTS "approved users can insert" ON public.warmth_import_log;

CREATE POLICY "admins can insert warmth import log"
  ON public.warmth_import_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

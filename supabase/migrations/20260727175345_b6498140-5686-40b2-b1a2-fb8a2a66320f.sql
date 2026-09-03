
-- ============================================================
-- PHASE 1: Lock down RLS. Require authenticated + approved users.
-- ============================================================

-- 1) Helper: is_approved(uuid) — SECURITY DEFINER, avoids RLS recursion.
CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND status = 'approved'::public.profile_status
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_approved(uuid) TO authenticated, service_role;

-- 2) Helper to drop-and-recreate a standard "approved user, full CRUD" policy set.
--    We do this inline per table for clarity and to remove stale legacy policies.

-- ---------- Tables previously wide-open to "public" role ----------
DO $do$
DECLARE
  t text;
  tables text[] := ARRAY[
    'deals','partners','partner_contacts','partner_interactions',
    'capital_raise_entries','capital_raise_engagements','notes','note_links',
    'tags','entity_tags','deal_enrichment','buy_box_pillars','buy_box_signals',
    'buy_box_thesis','permits_data','chat_threads','chat_messages','partner_attachments'
  ];
  pol record;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Drop ALL existing policies on the table (we're replacing wholesale)
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    -- Revoke any anon grants; keep authenticated + service_role
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Approved-user full CRUD
    EXECUTE format($p$CREATE POLICY "approved users can select" ON public.%I FOR SELECT TO authenticated USING (public.is_approved(auth.uid()))$p$, t);
    EXECUTE format($p$CREATE POLICY "approved users can insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()))$p$, t);
    EXECUTE format($p$CREATE POLICY "approved users can update" ON public.%I FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()))$p$, t);
    EXECUTE format($p$CREATE POLICY "approved users can delete" ON public.%I FOR DELETE TO authenticated USING (public.is_approved(auth.uid()))$p$, t);
  END LOOP;
END
$do$;

-- ---------- Tables previously "authenticated USING (true)" — tighten to approved-only ----------
DO $do$
DECLARE
  t text;
  tables text[] := ARRAY[
    'outlook_messages','outlook_message_deals','inbox_deals','deal_emails',
    'deal_pillar_scores','daily_digests','deal_feedback','capital_partner_feedback',
    'partner_suggestions','partner_tasks','partner_warmth_signals',
    'warmth_import_log','stage_change_events','roadmap_items','roadmap_events','ai_usage_log'
  ];
  pol record;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- SELECT for all approved users
    EXECUTE format($p$CREATE POLICY "approved users can select" ON public.%I FOR SELECT TO authenticated USING (public.is_approved(auth.uid()))$p$, t);
  END LOOP;
END
$do$;

-- Restore write privileges tuned per table (previously mostly USING(true))

-- Insert/update on the tables where the app writes from the client:
CREATE POLICY "approved users can insert" ON public.outlook_messages
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can update" ON public.outlook_messages
  FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can delete" ON public.outlook_messages
  FOR DELETE TO authenticated USING (public.is_approved(auth.uid()));

CREATE POLICY "approved users can insert" ON public.outlook_message_deals
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can delete" ON public.outlook_message_deals
  FOR DELETE TO authenticated USING (public.is_approved(auth.uid()));

CREATE POLICY "approved users can insert" ON public.inbox_deals
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can update" ON public.inbox_deals
  FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can delete" ON public.inbox_deals
  FOR DELETE TO authenticated USING (public.is_approved(auth.uid()));

CREATE POLICY "approved users can insert" ON public.deal_emails
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can update" ON public.deal_emails
  FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can delete" ON public.deal_emails
  FOR DELETE TO authenticated USING (public.is_approved(auth.uid()));

CREATE POLICY "approved users can insert" ON public.deal_pillar_scores
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can update" ON public.deal_pillar_scores
  FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can delete" ON public.deal_pillar_scores
  FOR DELETE TO authenticated USING (public.is_approved(auth.uid()));

CREATE POLICY "approved users can insert" ON public.daily_digests
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can update" ON public.daily_digests
  FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can delete" ON public.daily_digests
  FOR DELETE TO authenticated USING (public.is_approved(auth.uid()));

CREATE POLICY "approved users can insert" ON public.deal_feedback
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));

CREATE POLICY "approved users can insert" ON public.capital_partner_feedback
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));

CREATE POLICY "approved users can insert" ON public.partner_suggestions
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can update" ON public.partner_suggestions
  FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can delete" ON public.partner_suggestions
  FOR DELETE TO authenticated USING (public.is_approved(auth.uid()));

CREATE POLICY "approved users can insert" ON public.partner_tasks
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can update" ON public.partner_tasks
  FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can delete" ON public.partner_tasks
  FOR DELETE TO authenticated USING (public.is_approved(auth.uid()));

CREATE POLICY "approved users can insert" ON public.roadmap_items
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can update" ON public.roadmap_items
  FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can delete" ON public.roadmap_items
  FOR DELETE TO authenticated USING (public.is_approved(auth.uid()));

CREATE POLICY "approved users can insert" ON public.roadmap_events
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can update" ON public.roadmap_events
  FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "approved users can delete" ON public.roadmap_events
  FOR DELETE TO authenticated USING (public.is_approved(auth.uid()));

CREATE POLICY "approved users can insert" ON public.warmth_import_log
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));

-- partner_warmth_signals, stage_change_events, ai_usage_log stay read-only from the client
-- (they're populated by triggers / edge functions using service_role).

-- ---------- Storage: partner-attachments bucket ----------
DROP POLICY IF EXISTS "partner-attachments read"   ON storage.objects;
DROP POLICY IF EXISTS "partner-attachments insert" ON storage.objects;
DROP POLICY IF EXISTS "partner-attachments update" ON storage.objects;
DROP POLICY IF EXISTS "partner-attachments delete" ON storage.objects;

CREATE POLICY "partner-attachments read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'partner-attachments' AND public.is_approved(auth.uid()));

CREATE POLICY "partner-attachments insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'partner-attachments' AND public.is_approved(auth.uid()));

CREATE POLICY "partner-attachments update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'partner-attachments' AND public.is_approved(auth.uid()))
  WITH CHECK (bucket_id = 'partner-attachments' AND public.is_approved(auth.uid()));

CREATE POLICY "partner-attachments delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'partner-attachments' AND public.is_approved(auth.uid()));

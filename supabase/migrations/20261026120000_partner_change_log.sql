-- Partner change log: one row per tracked field that changed on a partner, for
-- the Capital Partners activity feed ("what did we change on existing firms").
--
-- partners only kept last_edited_at, so who changed what was not recorded
-- anywhere. A trigger now writes it. auth.uid() is the editing user for writes
-- from the app; it is null for service-role writes (compute-partner-warmth,
-- enrichment, other edge functions), which are logged as source 'system'.

CREATE TABLE IF NOT EXISTS public.partner_change_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id       uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  field            text NOT NULL,
  old_value        jsonb,
  new_value        jsonb,
  changed_by       uuid,
  changed_by_label text,
  source           text NOT NULL CHECK (source IN ('user', 'system', 'suggestion', 'import')),
  changed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_change_log_changed_at_idx ON public.partner_change_log (changed_at DESC);
CREATE INDEX IF NOT EXISTS partner_change_log_partner_idx ON public.partner_change_log (partner_id, changed_at DESC);

ALTER TABLE public.partner_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "approved users can select" ON public.partner_change_log;
CREATE POLICY "approved users can select" ON public.partner_change_log
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
GRANT SELECT ON public.partner_change_log TO authenticated;
GRANT ALL ON public.partner_change_log TO service_role;

-- Fields a person would want to be reminded of. Derived/bookkeeping columns
-- (profile_summary, organized_notes, enriched_*, manual_fields, timestamps) are
-- left out: they change on every enrichment pass and would bury the real edits.
CREATE OR REPLACE FUNCTION public.trg_partners_log_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tracked text[] := ARRAY[
    'name', 'firm_type', 'relationship_strength', 'ansonia_poc', 'website', 'headquarters',
    'status', 'archived_at',
    'capital_status', 'capital_status_detail', 'capital_available_from',
    'min_equity_m', 'max_equity_m', 'investor_type', 'hold_period', 'product_types',
    'geography', 'geography_avoid', 'urban_infill', 'suburban',
    'strategy_value_add', 'strategy_core_plus', 'strategy_workforce', 'strategy_affordable',
    'additional_notes'
  ];
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
  uid uuid := auth.uid();
  label text;
  k text;
BEGIN
  IF uid IS NOT NULL THEN
    SELECT coalesce(nullif(full_name, ''), email) INTO label FROM public.profiles WHERE id = uid;
  END IF;
  FOREACH k IN ARRAY tracked LOOP
    IF (o -> k) IS DISTINCT FROM (n -> k) THEN
      INSERT INTO public.partner_change_log (partner_id, field, old_value, new_value, changed_by, changed_by_label, source)
      VALUES (NEW.id, k, o -> k, n -> k, uid, label, CASE WHEN uid IS NULL THEN 'system' ELSE 'user' END);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partners_log_changes ON public.partners;
CREATE TRIGGER partners_log_changes
  AFTER UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.trg_partners_log_changes();

-- Backfill the history that was already recorded elsewhere, so the feed is not
-- empty on day one. Guarded so a re-run does not duplicate it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.partner_change_log WHERE source IN ('suggestion', 'import')) THEN
    -- Applied suggestions. reviewed_by is the approver's email; null means the
    -- writer applied it itself (compute-partner-warmth auto-writes).
    INSERT INTO public.partner_change_log (partner_id, field, old_value, new_value, changed_by_label, source, changed_at)
    SELECT s.partner_id, s.field, s.current_value, s.proposed_value, s.reviewed_by,
           CASE WHEN s.reviewed_by IS NULL THEN 'system' ELSE 'suggestion' END,
           s.applied_at
    FROM public.partner_suggestions s
    JOIN public.partners p ON p.id = s.partner_id
    WHERE s.status = 'applied' AND s.field IS NOT NULL AND s.applied_at IS NOT NULL;

    INSERT INTO public.partner_change_log (partner_id, field, old_value, new_value, changed_by_label, source, changed_at)
    SELECT w.partner_id, 'relationship_strength', to_jsonb(w.old_warmth), to_jsonb(w.new_warmth), w.applied_by, 'import', w.applied_at
    FROM public.warmth_import_log w
    JOIN public.partners p ON p.id = w.partner_id;
  END IF;
END $$;

-- What led to each partner change. enriched_fields only holds the source of a
-- field's CURRENT value, so once Atlas rewrote a field nobody could tell where
-- the earlier change came from ("X raised their minimum": which
-- note? which email?). The trigger now copies the field's provenance stamp
-- (note ids, quote, email message ids, deal id) onto the change row when the
-- same write updated it.

ALTER TABLE public.partner_change_log ADD COLUMN IF NOT EXISTS source_ref jsonb;

COMMENT ON COLUMN public.partner_change_log.source_ref IS
  'Provenance of the new value, copied from partners.enriched_fields->field when the same write set it: source, as_of, note_ids, quote, message_ids, deal_id. Null for plain edits.';

CREATE OR REPLACE FUNCTION public.trg_partners_log_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tracked text[] := ARRAY[
    'name', 'firm_type', 'relationship_strength', 'ansonia_poc', 'website', 'headquarters',
    'status', 'archived_at', 'blacklisted_at', 'blacklist_reason',
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
  ref jsonb;
BEGIN
  IF uid IS NOT NULL THEN
    SELECT coalesce(nullif(full_name, ''), email) INTO label FROM public.profiles WHERE id = uid;
  END IF;
  FOREACH k IN ARRAY tracked LOOP
    IF (o -> k) IS DISTINCT FROM (n -> k) THEN
      -- Only a stamp written in this same update describes the new value; an
      -- unchanged one belongs to the value being replaced.
      ref := n -> 'enriched_fields' -> k;
      IF ref IS NULL OR jsonb_typeof(ref) <> 'object' OR ref IS NOT DISTINCT FROM (o -> 'enriched_fields' -> k) THEN
        ref := NULL;
      ELSE
        ref := ref - 'suggested';
      END IF;
      INSERT INTO public.partner_change_log (partner_id, field, old_value, new_value, changed_by, changed_by_label, source, source_ref)
      VALUES (NEW.id, k, o -> k, n -> k, uid, label, CASE WHEN uid IS NULL THEN 'system' ELSE 'user' END, ref);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- Backfill: where an Atlas or approved-suggestion change is still the field's
-- current value, its stamp in enriched_fields is the one that wrote it.
UPDATE public.partner_change_log c
SET source_ref = (p.enriched_fields -> c.field) - 'suggested'
FROM public.partners p
WHERE p.id = c.partner_id
  AND c.source_ref IS NULL
  AND c.source IN ('system', 'suggestion')
  AND jsonb_typeof(p.enriched_fields -> c.field) = 'object'
  AND c.new_value IS NOT DISTINCT FROM (to_jsonb(p) -> c.field)
  AND c.changed_at = (
    SELECT max(c2.changed_at) FROM public.partner_change_log c2
    WHERE c2.partner_id = c.partner_id AND c2.field = c.field
  );

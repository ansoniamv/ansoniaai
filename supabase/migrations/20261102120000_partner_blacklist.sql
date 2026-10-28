-- Blacklisted capital partners: firms the team has decided not to do business
-- with. They stay in the CRM (so whoever comes across them next sees the flag
-- and the reason) but are dropped from deal matching.
--
-- blacklisted_at is the flag; null means not blacklisted. Who set it is stamped
-- by a trigger from auth.uid(), so the app never has to send it.

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS blacklisted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS blacklist_reason     text,
  ADD COLUMN IF NOT EXISTS blacklisted_by       uuid,
  ADD COLUMN IF NOT EXISTS blacklisted_by_label text;

CREATE OR REPLACE FUNCTION public.trg_partners_stamp_blacklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  label text;
BEGIN
  IF NEW.blacklisted_at IS NULL THEN
    NEW.blacklisted_by := NULL;
    NEW.blacklisted_by_label := NULL;
    NEW.blacklist_reason := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.blacklisted_at IS NULL THEN
    IF uid IS NOT NULL THEN
      SELECT coalesce(nullif(full_name, ''), email) INTO label FROM public.profiles WHERE id = uid;
    END IF;
    NEW.blacklisted_by := uid;
    NEW.blacklisted_by_label := label;
  ELSE
    -- Already blacklisted: editing the reason does not change who set the flag.
    NEW.blacklisted_by := OLD.blacklisted_by;
    NEW.blacklisted_by_label := OLD.blacklisted_by_label;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partners_stamp_blacklist ON public.partners;
CREATE TRIGGER partners_stamp_blacklist
  BEFORE INSERT OR UPDATE OF blacklisted_at, blacklist_reason, blacklisted_by, blacklisted_by_label
  ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.trg_partners_stamp_blacklist();

-- Same function as 20261026120000_partner_change_log.sql, with the blacklist
-- fields added so blacklisting shows in the activity feed.
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

COMMENT ON COLUMN public.partners.blacklisted_at IS
  'Set when the team decided not to do business with this firm. Do not engage or match to deals; see blacklist_reason.';

-- Default point of contact per capital partner, for outreach drafts.
--
-- is_primary: the contact a partner's outreach draft is addressed to. At most
-- one per partner; marking a contact primary clears the flag on the others, so
-- the app only ever sets the new one.
-- always_cc: copied on every outreach draft to that partner, beside the primary.
--
-- Partners with no primary keep the old behaviour (first contact with an email).

ALTER TABLE public.partner_contacts
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS always_cc  boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.trg_partner_contacts_single_primary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_primary THEN
    UPDATE public.partner_contacts
       SET is_primary = false
     WHERE partner_id = NEW.partner_id
       AND id <> NEW.id
       AND is_primary;
    -- The primary is already the To: line; copying them too would be a duplicate.
    NEW.always_cc := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partner_contacts_single_primary ON public.partner_contacts;
CREATE TRIGGER partner_contacts_single_primary
  BEFORE INSERT OR UPDATE OF is_primary, partner_id ON public.partner_contacts
  FOR EACH ROW EXECUTE FUNCTION public.trg_partner_contacts_single_primary();

CREATE UNIQUE INDEX IF NOT EXISTS partner_contacts_one_primary
  ON public.partner_contacts (partner_id) WHERE is_primary;

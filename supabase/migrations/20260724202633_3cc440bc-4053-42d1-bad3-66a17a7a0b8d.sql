
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.bump_partner_last_edited(_partner_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _partner_id IS NULL OR auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.partners SET last_edited_at = now() WHERE id = _partner_id;
END;$$;

CREATE OR REPLACE FUNCTION public.trg_partners_touch_last_edited()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.last_edited_at IS DISTINCT FROM OLD.last_edited_at
     AND (to_jsonb(NEW) - 'last_edited_at') = (to_jsonb(OLD) - 'last_edited_at') THEN
    RETURN NEW;
  END IF;
  NEW.last_edited_at := now();
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS partners_touch_last_edited ON public.partners;
CREATE TRIGGER partners_touch_last_edited
  BEFORE INSERT OR UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.trg_partners_touch_last_edited();

CREATE OR REPLACE FUNCTION public.trg_child_bump_partner_last_edited()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  _pid := CASE WHEN TG_OP = 'DELETE' THEN OLD.partner_id ELSE NEW.partner_id END;
  PERFORM public.bump_partner_last_edited(_pid);
  IF TG_OP = 'UPDATE' AND NEW.partner_id IS DISTINCT FROM OLD.partner_id THEN
    PERFORM public.bump_partner_last_edited(OLD.partner_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;$$;

DROP TRIGGER IF EXISTS partner_contacts_bump_last_edited ON public.partner_contacts;
CREATE TRIGGER partner_contacts_bump_last_edited
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_contacts
  FOR EACH ROW EXECUTE FUNCTION public.trg_child_bump_partner_last_edited();

DROP TRIGGER IF EXISTS partner_interactions_bump_last_edited ON public.partner_interactions;
CREATE TRIGGER partner_interactions_bump_last_edited
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_interactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_child_bump_partner_last_edited();

DROP TRIGGER IF EXISTS partner_attachments_bump_last_edited ON public.partner_attachments;
CREATE TRIGGER partner_attachments_bump_last_edited
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_attachments
  FOR EACH ROW EXECUTE FUNCTION public.trg_child_bump_partner_last_edited();

CREATE OR REPLACE FUNCTION public.trg_notes_bump_partner_last_edited()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _note_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  _note_id := COALESCE(NEW.id, OLD.id);
  UPDATE public.partners p
     SET last_edited_at = now()
   WHERE p.id IN (
     SELECT nl.linked_id FROM public.note_links nl
      WHERE nl.note_id = _note_id AND nl.linked_type = 'partner'
   );
  -- Also cover notes with entity_type='partner' directly on notes table
  IF COALESCE(NEW.entity_type, OLD.entity_type) = 'partner' THEN
    PERFORM public.bump_partner_last_edited(COALESCE(NEW.entity_id, OLD.entity_id));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;$$;

DROP TRIGGER IF EXISTS notes_bump_partner_last_edited ON public.notes;
CREATE TRIGGER notes_bump_partner_last_edited
  AFTER INSERT OR UPDATE OR DELETE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.trg_notes_bump_partner_last_edited();

CREATE OR REPLACE FUNCTION public.trg_note_links_bump_partner_last_edited()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' AND NEW.linked_type = 'partner' THEN
    PERFORM public.bump_partner_last_edited(NEW.linked_id);
  ELSIF TG_OP = 'DELETE' AND OLD.linked_type = 'partner' THEN
    PERFORM public.bump_partner_last_edited(OLD.linked_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;$$;

DROP TRIGGER IF EXISTS note_links_bump_partner_last_edited ON public.note_links;
CREATE TRIGGER note_links_bump_partner_last_edited
  AFTER INSERT OR DELETE ON public.note_links
  FOR EACH ROW EXECUTE FUNCTION public.trg_note_links_bump_partner_last_edited();

WITH agg AS (
  SELECT p.id,
    GREATEST(
      p.updated_at,
      COALESCE((SELECT MAX(n.updated_at) FROM public.notes n
                 LEFT JOIN public.note_links nl ON nl.note_id = n.id AND nl.linked_type = 'partner'
                WHERE nl.linked_id = p.id
                   OR (n.entity_type = 'partner' AND n.entity_id = p.id)), p.updated_at),
      COALESCE((SELECT MAX(updated_at) FROM public.partner_contacts WHERE partner_id = p.id), p.updated_at),
      COALESCE((SELECT MAX(created_at) FROM public.partner_interactions WHERE partner_id = p.id), p.updated_at),
      COALESCE((SELECT MAX(created_at) FROM public.partner_attachments WHERE partner_id = p.id), p.updated_at)
    ) AS le
  FROM public.partners p
)
UPDATE public.partners p SET last_edited_at = agg.le
  FROM agg WHERE p.id = agg.id;

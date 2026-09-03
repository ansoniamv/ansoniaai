CREATE TABLE IF NOT EXISTS public._partner_notes_import (id uuid PRIMARY KEY, notes text);
GRANT INSERT, SELECT, TRUNCATE ON public._partner_notes_import TO PUBLIC;

CREATE OR REPLACE FUNCTION public.apply_partner_notes_import()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  WITH upd AS (
    UPDATE public.partners AS p
    SET additional_notes = s.notes
    FROM public._partner_notes_import s
    WHERE p.id = s.id
    RETURNING p.id
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_partner_notes_import() TO PUBLIC;
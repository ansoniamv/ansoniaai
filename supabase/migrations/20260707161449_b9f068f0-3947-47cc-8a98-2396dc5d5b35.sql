ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS organized_notes text;

CREATE TABLE IF NOT EXISTS public._partner_organized_notes_import (
  id uuid PRIMARY KEY,
  notes text NOT NULL
);
GRANT INSERT, SELECT, TRUNCATE ON public._partner_organized_notes_import TO PUBLIC;

CREATE OR REPLACE FUNCTION public.apply_partner_organized_notes_import()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.partners p
  SET organized_notes = s.notes
  FROM public._partner_organized_notes_import s
  WHERE p.id = s.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_partner_organized_notes_import() TO PUBLIC;
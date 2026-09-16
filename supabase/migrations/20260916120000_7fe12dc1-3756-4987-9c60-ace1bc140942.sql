ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS partners_is_internal_idx
  ON public.partners (is_internal)
  WHERE is_internal = true;

UPDATE public.partners
  SET is_internal = true
  WHERE lower(name) LIKE 'ansonia%';

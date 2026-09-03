
CREATE TABLE public.learned_strategy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL DEFAULT '',
  example_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

GRANT SELECT ON public.learned_strategy TO authenticated;
GRANT ALL ON public.learned_strategy TO service_role;

ALTER TABLE public.learned_strategy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read learned strategy"
  ON public.learned_strategy FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can insert learned strategy"
  ON public.learned_strategy FOR INSERT
  TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update learned strategy"
  ON public.learned_strategy FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed a single empty row
INSERT INTO public.learned_strategy (content, example_count) VALUES ('', 0);

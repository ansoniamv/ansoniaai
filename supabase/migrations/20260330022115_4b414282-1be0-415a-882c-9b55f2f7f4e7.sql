
-- Buy box criteria table: stores configurable scoring rules
CREATE TABLE public.buy_box_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  criterion_name text NOT NULL,
  description text,
  flag_type text NOT NULL CHECK (flag_type IN ('red', 'yellow', 'green')),
  field_key text,
  operator text,
  threshold_value text,
  score_impact integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.buy_box_criteria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read access" ON public.buy_box_criteria FOR SELECT TO public USING (true);
CREATE POLICY "Allow all insert access" ON public.buy_box_criteria FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.buy_box_criteria FOR UPDATE TO public USING (true);
CREATE POLICY "Allow all delete access" ON public.buy_box_criteria FOR DELETE TO public USING (true);


-- Create enums for deal status and value add potential
CREATE TYPE public.deal_status AS ENUM ('Live', 'Best and Final', 'Under Contract', 'Pass', 'On Hold');
CREATE TYPE public.value_add_level AS ENUM ('High', 'Medium', 'Low');

-- Create deals table
CREATE TABLE public.deals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  property_name TEXT NOT NULL,
  broker TEXT,
  status deal_status NOT NULL DEFAULT 'Live',
  city TEXT,
  state TEXT,
  unit_count INTEGER,
  asking_price NUMERIC,
  affordable BOOLEAN DEFAULT false,
  vintage_year INTEGER,
  value_add_potential value_add_level,
  estimated_equity NUMERIC,
  area_median_income TEXT,
  annual_population_growth TEXT,
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

-- Allow all access for now (pre-auth phase)
CREATE POLICY "Allow all read access" ON public.deals FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.deals FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.deals FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.deals FOR DELETE USING (true);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_deals_updated_at
  BEFORE UPDATE ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

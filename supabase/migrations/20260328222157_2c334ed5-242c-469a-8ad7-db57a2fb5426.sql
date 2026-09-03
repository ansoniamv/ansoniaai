
-- Partners (firms) table
CREATE TABLE public.partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  firm_type TEXT,
  relationship_strength TEXT,
  investor_type TEXT[] DEFAULT '{}',
  min_equity_m NUMERIC,
  max_equity_m NUMERIC,
  hold_period TEXT[] DEFAULT '{}',
  geography TEXT[] DEFAULT '{}',
  urban_infill BOOLEAN DEFAULT false,
  suburban BOOLEAN DEFAULT false,
  strategy_value_add BOOLEAN DEFAULT false,
  strategy_core_plus BOOLEAN DEFAULT false,
  strategy_workforce BOOLEAN DEFAULT false,
  strategy_affordable BOOLEAN DEFAULT false,
  product_types TEXT[] DEFAULT '{}',
  ansonia_poc TEXT,
  additional_notes TEXT,
  data_source TEXT,
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partner contacts table
CREATE TABLE public.partner_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID REFERENCES public.partners(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  linkedin_url TEXT,
  firm_location TEXT,
  ansonia_poc TEXT,
  phone TEXT,
  role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partner interactions / notes table
CREATE TABLE public.partner_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID REFERENCES public.partners(id) ON DELETE CASCADE NOT NULL,
  contact_id UUID REFERENCES public.partner_contacts(id) ON DELETE SET NULL,
  interaction_type TEXT NOT NULL DEFAULT 'note',
  author TEXT,
  content TEXT NOT NULL,
  source TEXT,
  interaction_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_interactions ENABLE ROW LEVEL SECURITY;

-- Public access policies (matching deals table pattern)
CREATE POLICY "Allow all read access" ON public.partners FOR SELECT TO public USING (true);
CREATE POLICY "Allow all insert access" ON public.partners FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.partners FOR UPDATE TO public USING (true);
CREATE POLICY "Allow all delete access" ON public.partners FOR DELETE TO public USING (true);

CREATE POLICY "Allow all read access" ON public.partner_contacts FOR SELECT TO public USING (true);
CREATE POLICY "Allow all insert access" ON public.partner_contacts FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.partner_contacts FOR UPDATE TO public USING (true);
CREATE POLICY "Allow all delete access" ON public.partner_contacts FOR DELETE TO public USING (true);

CREATE POLICY "Allow all read access" ON public.partner_interactions FOR SELECT TO public USING (true);
CREATE POLICY "Allow all insert access" ON public.partner_interactions FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.partner_interactions FOR UPDATE TO public USING (true);
CREATE POLICY "Allow all delete access" ON public.partner_interactions FOR DELETE TO public USING (true);

-- Updated_at triggers
CREATE TRIGGER update_partners_updated_at BEFORE UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_partner_contacts_updated_at BEFORE UPDATE ON public.partner_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

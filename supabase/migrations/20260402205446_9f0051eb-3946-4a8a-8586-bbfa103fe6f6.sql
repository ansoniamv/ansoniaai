
-- Phase 5: Capital Raise Pipeline
CREATE TABLE public.capital_raise_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'Identified',
  equity_amount NUMERIC,
  assigned_poc TEXT,
  last_activity_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(deal_id, partner_id)
);

ALTER TABLE public.capital_raise_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read access" ON public.capital_raise_entries FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.capital_raise_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.capital_raise_entries FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.capital_raise_entries FOR DELETE USING (true);

-- Phase 6: Notes
CREATE TABLE public.notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  content TEXT NOT NULL,
  author TEXT,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read access" ON public.notes FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.notes FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.notes FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.notes FOR DELETE USING (true);

-- Phase 6: Tags
CREATE TABLE public.tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6aa3d8',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read access" ON public.tags FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.tags FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.tags FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.tags FOR DELETE USING (true);

-- Phase 6: Entity Tags junction
CREATE TABLE public.entity_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(tag_id, entity_type, entity_id)
);

ALTER TABLE public.entity_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read access" ON public.entity_tags FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.entity_tags FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.entity_tags FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.entity_tags FOR DELETE USING (true);

-- Triggers for updated_at
CREATE TRIGGER update_capital_raise_entries_updated_at
  BEFORE UPDATE ON public.capital_raise_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_notes_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for capital raise (for kanban drag updates)
ALTER PUBLICATION supabase_realtime ADD TABLE public.capital_raise_entries;

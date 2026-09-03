
CREATE TABLE public.note_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('deal','partner')),
  entity_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (note_id, entity_type, entity_id)
);

CREATE INDEX note_links_entity_idx ON public.note_links (entity_type, entity_id);
CREATE INDEX note_links_note_idx ON public.note_links (note_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_links TO anon;
GRANT ALL ON public.note_links TO service_role;

ALTER TABLE public.note_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read access" ON public.note_links FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON public.note_links FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update access" ON public.note_links FOR UPDATE USING (true);
CREATE POLICY "Allow all delete access" ON public.note_links FOR DELETE USING (true);

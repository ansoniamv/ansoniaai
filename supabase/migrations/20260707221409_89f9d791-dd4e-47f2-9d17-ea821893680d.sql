
ALTER TABLE public.note_links RENAME COLUMN entity_type TO linked_type;
ALTER TABLE public.note_links RENAME COLUMN entity_id TO linked_id;

DROP INDEX IF EXISTS public.note_links_entity_idx;
CREATE INDEX note_links_linked_idx ON public.note_links (linked_type, linked_id);

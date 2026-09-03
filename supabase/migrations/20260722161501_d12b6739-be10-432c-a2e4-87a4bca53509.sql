ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES public.partner_contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_notes_contact_id ON public.notes(contact_id);
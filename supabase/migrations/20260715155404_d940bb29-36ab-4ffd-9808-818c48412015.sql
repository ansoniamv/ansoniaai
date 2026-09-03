CREATE TABLE public.partner_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_size bigint,
  content_type text,
  label text,
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX partner_attachments_partner_id_idx ON public.partner_attachments(partner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_attachments TO anon, authenticated;
GRANT ALL ON public.partner_attachments TO service_role;

ALTER TABLE public.partner_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all select" ON public.partner_attachments FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON public.partner_attachments FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON public.partner_attachments FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all delete" ON public.partner_attachments FOR DELETE USING (true);

CREATE TABLE public.partner_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.partner_contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  assignee TEXT,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_tasks TO authenticated;
GRANT ALL ON public.partner_tasks TO service_role;

ALTER TABLE public.partner_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view partner tasks"
  ON public.partner_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert partner tasks"
  ON public.partner_tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update partner tasks"
  ON public.partner_tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete partner tasks"
  ON public.partner_tasks FOR DELETE TO authenticated USING (true);

CREATE TRIGGER partner_tasks_set_updated_at
  BEFORE UPDATE ON public.partner_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX partner_tasks_partner_id_idx ON public.partner_tasks(partner_id);
CREATE INDEX partner_tasks_due_date_idx ON public.partner_tasks(due_date) WHERE status = 'open';

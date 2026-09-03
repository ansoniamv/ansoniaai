
-- Team members directory
CREATE TABLE public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  avatar_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view team members"
  ON public.team_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert team members"
  ON public.team_members FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update team members"
  ON public.team_members FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete team members"
  ON public.team_members FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_team_members_updated_at
  BEFORE UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Deal assignment
ALTER TABLE public.deals
  ADD COLUMN assigned_to UUID REFERENCES public.team_members(id) ON DELETE SET NULL;
ALTER TABLE public.inbox_deals
  ADD COLUMN assigned_to UUID REFERENCES public.team_members(id) ON DELETE SET NULL;

CREATE INDEX idx_deals_assigned_to ON public.deals(assigned_to);
CREATE INDEX idx_inbox_deals_assigned_to ON public.inbox_deals(assigned_to);

-- Reviewed timestamp for time-to-review metric
ALTER TABLE public.inbox_deals
  ADD COLUMN reviewed_at TIMESTAMPTZ;

UPDATE public.inbox_deals SET reviewed_at = updated_at WHERE reviewed = true AND reviewed_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_inbox_reviewed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.reviewed IS DISTINCT FROM OLD.reviewed THEN
    NEW.reviewed_at := CASE WHEN NEW.reviewed THEN now() ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inbox_deals_reviewed_at
  BEFORE UPDATE OF reviewed ON public.inbox_deals
  FOR EACH ROW EXECUTE FUNCTION public.set_inbox_reviewed_at();

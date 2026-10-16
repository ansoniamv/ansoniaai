-- Change requests submitted by users from anywhere in the app. Admins review
-- them on the Roadmap page, where each one renders as a ready-to-paste
-- Claude Code prompt (built client-side from these columns).

CREATE TABLE public.roadmap_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  request_type text NOT NULL DEFAULT 'change' CHECK (request_type IN ('bug','change','feature')),
  page_label text,
  page_path text,
  current_behavior text,
  desired_behavior text NOT NULL CHECK (length(btrim(desired_behavior)) > 0),
  reason text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','queued','in_progress','done','declined')),
  admin_notes text,
  roadmap_item_id uuid REFERENCES public.roadmap_items(id) ON DELETE SET NULL,
  submitted_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  submitter_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX roadmap_change_requests_created_at_idx ON public.roadmap_change_requests (created_at DESC);

REVOKE ALL ON public.roadmap_change_requests FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roadmap_change_requests TO authenticated;
GRANT ALL ON public.roadmap_change_requests TO service_role;

ALTER TABLE public.roadmap_change_requests ENABLE ROW LEVEL SECURITY;

-- Everyone approved sees every request, so people can spot duplicates and
-- follow what happened to theirs.
CREATE POLICY "approved users can select" ON public.roadmap_change_requests
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));

-- Users submit as themselves only.
CREATE POLICY "approved users can insert own" ON public.roadmap_change_requests
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved(auth.uid()) AND submitted_by = auth.uid());

-- Triage (status, notes, linking to the roadmap) is admin-only.
CREATE POLICY "admins can update" ON public.roadmap_change_requests
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can delete" ON public.roadmap_change_requests
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_roadmap_change_requests_updated_at
  BEFORE UPDATE ON public.roadmap_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_change_requests;

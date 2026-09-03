CREATE TABLE public.deal_field_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  field text NOT NULL CHECK (field IN ('status','pipeline_stage')),
  from_value text,
  to_value text,
  changed_by uuid,
  source text NOT NULL DEFAULT 'manual',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_deal_field_events_deal ON public.deal_field_events (deal_id, created_at DESC);

GRANT SELECT, INSERT ON public.deal_field_events TO authenticated;
GRANT ALL ON public.deal_field_events TO service_role;

ALTER TABLE public.deal_field_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can read deal field events"
  ON public.deal_field_events FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

CREATE POLICY "Approved users can insert deal field events"
  ON public.deal_field_events FOR INSERT TO authenticated
  WITH CHECK (public.is_approved(auth.uid()));

CREATE OR REPLACE FUNCTION public.trg_log_deal_field_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _source text := CASE WHEN auth.uid() IS NULL THEN 'function' ELSE 'manual' END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.deal_field_events (deal_id, field, from_value, to_value, changed_by, source)
    VALUES (NEW.id, 'status', NULL, NEW.status::text, _uid, 'baseline'),
           (NEW.id, 'pipeline_stage', NULL, NEW.pipeline_stage, _uid, 'baseline');
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.deal_field_events (deal_id, field, from_value, to_value, changed_by, source)
    VALUES (NEW.id, 'status', OLD.status::text, NEW.status::text, _uid, _source);
  END IF;

  IF NEW.pipeline_stage IS DISTINCT FROM OLD.pipeline_stage THEN
    INSERT INTO public.deal_field_events (deal_id, field, from_value, to_value, changed_by, source)
    VALUES (NEW.id, 'pipeline_stage', OLD.pipeline_stage, NEW.pipeline_stage, _uid, _source);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER deals_log_field_events
AFTER INSERT OR UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.trg_log_deal_field_events();

INSERT INTO public.deal_field_events (deal_id, field, from_value, to_value, changed_by, source, reason, created_at)
SELECT d.id, 'status', NULL, d.status::text, NULL, 'baseline', 'Baseline snapshot at audit-trail launch', COALESCE(d.updated_at, d.created_at)
FROM public.deals d;

INSERT INTO public.deal_field_events (deal_id, field, from_value, to_value, changed_by, source, reason, created_at)
SELECT d.id, 'pipeline_stage', NULL, d.pipeline_stage, NULL, 'baseline', 'Baseline snapshot at audit-trail launch', COALESCE(d.updated_at, d.created_at)
FROM public.deals d;
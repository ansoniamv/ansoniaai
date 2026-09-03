
-- 1. Add new enum value BEFORE existing 'discussion_scheduled'
ALTER TYPE public.raise_engagement_stage ADD VALUE IF NOT EXISTS 'in_discussion' BEFORE 'discussion_scheduled';

-- 2. Manual-lock + audit metadata columns on engagements
ALTER TABLE public.capital_raise_engagements
  ADD COLUMN IF NOT EXISTS stage_locked_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stage_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS stage_last_auto_reason text,
  ADD COLUMN IF NOT EXISTS stage_last_auto_at timestamptz;

-- 3. Audit log table
CREATE TABLE IF NOT EXISTS public.stage_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES public.capital_raise_engagements(id) ON DELETE CASCADE,
  deal_id uuid,
  partner_id uuid,
  from_stage text,
  to_stage text NOT NULL,
  reason text NOT NULL,
  triggered_by uuid,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.stage_change_events TO authenticated;
GRANT ALL ON public.stage_change_events TO service_role;

ALTER TABLE public.stage_change_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view stage change events" ON public.stage_change_events;
CREATE POLICY "Authenticated can view stage change events"
  ON public.stage_change_events FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS stage_change_events_engagement_idx
  ON public.stage_change_events(engagement_id, created_at DESC);

-- 4. Trigger on capital_raise_engagements: auto-advance on commit / denial + log every stage change
CREATE OR REPLACE FUNCTION public.trg_engagement_stage_automation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  auto_reason text := NULL;
BEGIN
  -- Automation only fires when the row is not manually locked
  IF NOT COALESCE(NEW.stage_locked_manual, false) THEN
    -- Denial captured -> Passed
    IF NEW.pass_feedback IS NOT NULL
       AND btrim(NEW.pass_feedback) <> ''
       AND (OLD.pass_feedback IS DISTINCT FROM NEW.pass_feedback)
       AND NEW.stage <> 'passed'::public.raise_engagement_stage THEN
      NEW.stage := 'passed'::public.raise_engagement_stage;
      NEW.passed := true;
      auto_reason := 'auto_passed';
    -- Commitment entered -> Committed
    ELSIF NEW.committed_amount IS NOT NULL
       AND NEW.committed_amount > 0
       AND (OLD.committed_amount IS DISTINCT FROM NEW.committed_amount)
       AND NEW.stage NOT IN ('committed'::public.raise_engagement_stage, 'passed'::public.raise_engagement_stage) THEN
      NEW.stage := 'committed'::public.raise_engagement_stage;
      auto_reason := 'auto_committed';
    END IF;
  END IF;

  IF auto_reason IS NOT NULL THEN
    NEW.stage_last_auto_reason := auto_reason;
    NEW.stage_last_auto_at := now();
  END IF;

  -- Log any stage change (manual or auto)
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO public.stage_change_events (
      engagement_id, deal_id, partner_id, from_stage, to_stage, reason, triggered_by, context
    ) VALUES (
      NEW.id, NEW.deal_id, NEW.partner_id,
      OLD.stage::text, NEW.stage::text,
      COALESCE(auto_reason, CASE WHEN NEW.stage_locked_manual THEN 'manual' ELSE 'manual' END),
      auth.uid(),
      jsonb_build_object(
        'committed_amount', NEW.committed_amount,
        'pass_feedback_present', (NEW.pass_feedback IS NOT NULL AND btrim(NEW.pass_feedback) <> '')
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engagement_stage_automation ON public.capital_raise_engagements;
CREATE TRIGGER engagement_stage_automation
  BEFORE UPDATE ON public.capital_raise_engagements
  FOR EACH ROW EXECUTE FUNCTION public.trg_engagement_stage_automation();

-- 5. Trigger on outlook_messages: inbound partner reply -> In Discussion
CREATE OR REPLACE FUNCTION public.trg_outlook_advance_engagement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  eng_row public.capital_raise_engagements%ROWTYPE;
BEGIN
  IF NEW.partner_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.folder, '') <> 'inbox' THEN RETURN NEW; END IF;

  FOR eng_row IN
    SELECT * FROM public.capital_raise_engagements
     WHERE partner_id = NEW.partner_id
       AND stage_locked_manual = false
       AND stage IN (
         'initial_reachout'::public.raise_engagement_stage,
         'materials_shared'::public.raise_engagement_stage
       )
  LOOP
    UPDATE public.capital_raise_engagements
       SET stage = 'in_discussion'::public.raise_engagement_stage,
           last_contact_date = COALESCE(NEW.received_at::date, CURRENT_DATE),
           stage_last_auto_reason = 'auto_email_reply',
           stage_last_auto_at = now()
     WHERE id = eng_row.id;

    INSERT INTO public.stage_change_events (
      engagement_id, deal_id, partner_id, from_stage, to_stage, reason, context
    ) VALUES (
      eng_row.id, eng_row.deal_id, eng_row.partner_id,
      eng_row.stage::text, 'in_discussion',
      'auto_email_reply',
      jsonb_build_object(
        'outlook_message_id', NEW.id,
        'from_email', NEW.from_email,
        'received_at', NEW.received_at,
        'subject', NEW.subject
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outlook_advance_engagement ON public.outlook_messages;
CREATE TRIGGER outlook_advance_engagement
  AFTER INSERT ON public.outlook_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_outlook_advance_engagement();

-- Migrate 1 row from discussion_scheduled -> in_discussion, then rebuild enum with added_to_pipeline
UPDATE public.capital_raise_engagements SET stage = 'in_discussion' WHERE stage = 'discussion_scheduled';

ALTER TYPE public.raise_engagement_stage RENAME TO raise_engagement_stage_old;

CREATE TYPE public.raise_engagement_stage AS ENUM (
  'added_to_pipeline','initial_reachout','materials_shared',
  'in_discussion','serious_interest','committed','passed');

ALTER TABLE public.capital_raise_engagements ALTER COLUMN stage DROP DEFAULT;
ALTER TABLE public.capital_raise_engagements ALTER COLUMN stage TYPE public.raise_engagement_stage
  USING stage::text::public.raise_engagement_stage;
ALTER TABLE public.capital_raise_engagements ALTER COLUMN stage SET DEFAULT 'added_to_pipeline';

DROP TYPE public.raise_engagement_stage_old;

-- Rewrite trigger fn to remove reference to discussion_scheduled and include added_to_pipeline
CREATE OR REPLACE FUNCTION public.trg_outlook_advance_engagement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         'added_to_pipeline'::public.raise_engagement_stage,
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
$function$;
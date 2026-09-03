ALTER TYPE public.deal_status RENAME TO deal_status_old;

CREATE TYPE public.deal_status AS ENUM (
  'New',
  'Screening',
  'On Hold/Tracking',
  'Underwriting',
  'B&F',
  'Under Contract',
  'Pass'
);

ALTER TABLE public.deals ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.deals
  ALTER COLUMN status TYPE public.deal_status
  USING (
    CASE
      WHEN trim(coalesce(pipeline_stage, '')) IN
        ('New','Screening','On Hold/Tracking','Underwriting','B&F','Under Contract','Pass')
        THEN trim(pipeline_stage)
      WHEN status::text = 'Under Contract' THEN 'Under Contract'
      WHEN status::text = 'Pass'           THEN 'Pass'
      WHEN status::text = 'Best and Final' THEN 'B&F'
      WHEN status::text = 'Tracking'       THEN 'On Hold/Tracking'
      WHEN status::text = 'On Hold'        THEN 'On Hold/Tracking'
      WHEN status::text = 'Live'           THEN 'New'
      ELSE 'New'
    END
  )::public.deal_status;

ALTER TABLE public.deals ALTER COLUMN status SET DEFAULT 'New';

DROP TYPE public.deal_status_old;

CREATE OR REPLACE FUNCTION public.accept_inbox_deal(_inbox_deal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inbox   public.inbox_deals%ROWTYPE;
  v_deal_id uuid;
BEGIN
  SELECT * INTO v_inbox
  FROM public.inbox_deals
  WHERE id = _inbox_deal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inbox_deal % not found', _inbox_deal_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_inbox.accepted_deal_id IS NOT NULL THEN
    RETURN v_inbox.accepted_deal_id;
  END IF;

  INSERT INTO public.deals (
    property_name, status, broker, city, state, msa,
    unit_count, vintage_year, source, inbox_deal_id
  ) VALUES (
    COALESCE(v_inbox.property_name, 'Untitled property'),
    'New'::public.deal_status,
    v_inbox.broker_firm,
    v_inbox.location_city,
    v_inbox.location_state,
    v_inbox.msa,
    v_inbox.units,
    v_inbox.year_built,
    'pipeline',
    v_inbox.id
  )
  RETURNING id INTO v_deal_id;

  UPDATE public.inbox_deals
  SET accepted_deal_id = v_deal_id,
      reviewed = true
  WHERE id = _inbox_deal_id;

  RETURN v_deal_id;
END;
$function$;
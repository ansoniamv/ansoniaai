CREATE OR REPLACE FUNCTION public.accept_inbox_deal(_inbox_deal_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    'Live'::public.deal_status,
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
$$;

GRANT EXECUTE ON FUNCTION public.accept_inbox_deal(uuid) TO authenticated;
-- Stop throwing away extracted fields when an inbox deal is promoted.
--
-- accept_inbox_deal_unguarded copied ten columns into deals:
--
--   property_name, status, broker, city, state, msa,
--   unit_count, vintage_year, source, inbox_deal_id
--
-- asset_class, strategy, address and occupancy_pct are extracted from the broker
-- email, land in inbox_deals, and were then dropped at the moment the deal
-- entered the pipeline. The effect is stark:
--
--   asset_class   77% of inbox_deals   ->  14% of deals
--   strategy      44% of inbox_deals   ->  14% of deals
--
-- The 14% that did have values got them from HelloData enrichment later, not
-- from the email that announced the deal.
--
-- This matters because those two fields carry the buy box. asset_class holds
-- Multifamily 1176, Retail 24, Industrial 20, Office 13, Development 2 — the
-- whole "always avoid" rule. strategy holds Value-Add 570, Core-Plus 48, Core 35,
-- Opportunistic 10 — the investment-profile rule. Both were sitting one table
-- away from the scorer that needed them.
--
-- Everything else in the function is unchanged and deliberately so. FOR UPDATE
-- is the lock that stops two concurrent accepts creating two deals from one
-- inbox row; the early return on accepted_deal_id is what makes a repeat accept
-- idempotent; the no_data_found errcode is what the caller matches on. This
-- migration adds four columns to one INSERT and touches nothing else.
--
-- NOT carried, deliberately:
--   asking_price — text on inbox_deals, numeric on deals, and the scale is
--     ambiguous ("$31M" vs "31000000"). deals stores millions. Guessing wrong
--     writes a number that is silently believed, so it stays a manual field.
--   avg_sf       — no corresponding column on deals; total_sqft is a different
--     measure and deriving one from the other would be inventing data.
--   offers_due   — cfo_date is the plausible target, but "offers due" and "call
--     for offers" are not reliably the same date.

CREATE OR REPLACE FUNCTION public.accept_inbox_deal_unguarded(_inbox_deal_id uuid)
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
    unit_count, vintage_year, source, inbox_deal_id,
    asset_class, strategy, address, occupancy_pct
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
    v_inbox.id,
    NULLIF(btrim(v_inbox.asset_class), ''),
    NULLIF(btrim(v_inbox.strategy), ''),
    NULLIF(btrim(v_inbox.address), ''),
    v_inbox.occupancy_pct
  )
  RETURNING id INTO v_deal_id;

  UPDATE public.inbox_deals
  SET accepted_deal_id = v_deal_id,
      reviewed = true
  WHERE id = _inbox_deal_id;

  RETURN v_deal_id;
END;
$function$;

-- Backfill the deals already promoted. COALESCE only fills a NULL: a value set
-- by hand or by HelloData enrichment is a later and better-informed statement
-- than the email that announced the deal, and must not be overwritten by it.
UPDATE public.deals d
SET asset_class   = COALESCE(d.asset_class,   NULLIF(btrim(i.asset_class), '')),
    strategy      = COALESCE(d.strategy,      NULLIF(btrim(i.strategy), '')),
    address       = COALESCE(d.address,       NULLIF(btrim(i.address), '')),
    occupancy_pct = COALESCE(d.occupancy_pct, i.occupancy_pct)
FROM public.inbox_deals i
WHERE i.accepted_deal_id = d.id
  AND (d.asset_class IS NULL OR d.strategy IS NULL
       OR d.address IS NULL OR d.occupancy_pct IS NULL);

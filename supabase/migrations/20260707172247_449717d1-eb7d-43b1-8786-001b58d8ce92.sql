
CREATE OR REPLACE FUNCTION public.recompute_deal_total_committed(_deal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.deals d
     SET total_committed = COALESCE((
        SELECT SUM(committed_amount)
          FROM public.capital_raise_engagements
         WHERE deal_id = _deal_id
           AND committed_amount IS NOT NULL
     ), 0)
   WHERE d.id = _deal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_engagement_recompute_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_deal_total_committed(OLD.deal_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND NEW.deal_id IS DISTINCT FROM OLD.deal_id THEN
    PERFORM public.recompute_deal_total_committed(OLD.deal_id);
    PERFORM public.recompute_deal_total_committed(NEW.deal_id);
    RETURN NEW;
  ELSE
    PERFORM public.recompute_deal_total_committed(NEW.deal_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS engagement_recompute_total_ins ON public.capital_raise_engagements;
DROP TRIGGER IF EXISTS engagement_recompute_total_upd ON public.capital_raise_engagements;
DROP TRIGGER IF EXISTS engagement_recompute_total_del ON public.capital_raise_engagements;

CREATE TRIGGER engagement_recompute_total_ins
AFTER INSERT ON public.capital_raise_engagements
FOR EACH ROW EXECUTE FUNCTION public.trg_engagement_recompute_total();

CREATE TRIGGER engagement_recompute_total_upd
AFTER UPDATE OF committed_amount, deal_id ON public.capital_raise_engagements
FOR EACH ROW EXECUTE FUNCTION public.trg_engagement_recompute_total();

CREATE TRIGGER engagement_recompute_total_del
AFTER DELETE ON public.capital_raise_engagements
FOR EACH ROW EXECUTE FUNCTION public.trg_engagement_recompute_total();

-- Backfill existing deals
UPDATE public.deals d
   SET total_committed = COALESCE(sub.s, 0)
  FROM (
    SELECT deal_id, SUM(committed_amount) AS s
      FROM public.capital_raise_engagements
     WHERE committed_amount IS NOT NULL
     GROUP BY deal_id
  ) sub
 WHERE sub.deal_id = d.id;

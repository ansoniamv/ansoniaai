CREATE OR REPLACE FUNCTION public.merge_partners(_primary_id uuid, _duplicate_id uuid)
RETURNS public.partners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.partners%ROWTYPE;
  d public.partners%ROWTYPE;
  merged public.partners%ROWTYPE;
  sep text := E'\n\n--- merged from duplicate ---\n\n';
  e_dup public.capital_raise_engagements%ROWTYPE;
  e_pri public.capital_raise_engagements%ROWTYPE;
  x_dup public.capital_raise_entries%ROWTYPE;
  x_pri public.capital_raise_entries%ROWTYPE;
  stage_order text[] := ARRAY['added_to_pipeline','initial_reachout','materials_shared',
                              'in_discussion','serious_interest','committed','passed'];
BEGIN
  IF _primary_id IS NULL OR _duplicate_id IS NULL THEN
    RAISE EXCEPTION 'primary_id and duplicate_id are required';
  END IF;
  IF _primary_id = _duplicate_id THEN
    RAISE EXCEPTION 'cannot merge a partner into itself';
  END IF;

  SELECT * INTO p FROM public.partners WHERE id = _primary_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'primary partner % not found', _primary_id; END IF;
  SELECT * INTO d FROM public.partners WHERE id = _duplicate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'duplicate partner % not found', _duplicate_id; END IF;

  UPDATE public.partner_contacts       SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.partner_interactions   SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.partner_attachments    SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.partner_suggestions    SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.partner_warmth_signals SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.partner_tasks          SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.capital_partner_feedback SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.warmth_import_log      SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.outlook_messages       SET partner_id = _primary_id WHERE partner_id = _duplicate_id;

  FOR e_dup IN
    SELECT ce.* FROM public.capital_raise_engagements ce
     WHERE ce.partner_id = _duplicate_id
       AND EXISTS (SELECT 1 FROM public.capital_raise_engagements pe
                    WHERE pe.partner_id = _primary_id AND pe.deal_id = ce.deal_id)
  LOOP
    SELECT * INTO e_pri FROM public.capital_raise_engagements
      WHERE partner_id = _primary_id AND deal_id = e_dup.deal_id FOR UPDATE;

    UPDATE public.capital_raise_engagements SET
      stage = CASE
                WHEN e_dup.stage = 'passed' THEN e_pri.stage
                WHEN e_pri.stage = 'passed' THEN e_dup.stage
                WHEN array_position(stage_order, e_dup.stage::text)
                   > array_position(stage_order, e_pri.stage::text) THEN e_dup.stage
                ELSE e_pri.stage
              END,
      initial_reachout_date     = LEAST(e_pri.initial_reachout_date, e_dup.initial_reachout_date),
      materials_shared_date     = LEAST(e_pri.materials_shared_date, e_dup.materials_shared_date),
      materials_shared_items    = COALESCE(NULLIF(btrim(e_pri.materials_shared_items),''), e_dup.materials_shared_items),
      discussion_scheduled_date = GREATEST(e_pri.discussion_scheduled_date, e_dup.discussion_scheduled_date),
      last_contact_date         = GREATEST(e_pri.last_contact_date, e_dup.last_contact_date),
      next_action_date          = LEAST(e_pri.next_action_date, e_dup.next_action_date),
      next_action               = COALESCE(NULLIF(btrim(e_pri.next_action),''), e_dup.next_action),
      owner                     = COALESCE(NULLIF(btrim(e_pri.owner),''), e_dup.owner),
      serious_interest          = e_pri.serious_interest OR e_dup.serious_interest,
      passed                    = e_pri.passed AND e_dup.passed,
      pass_category             = COALESCE(NULLIF(btrim(e_pri.pass_category),''), e_dup.pass_category),
      pass_price_surmountable   = COALESCE(e_pri.pass_price_surmountable, e_dup.pass_price_surmountable),
      pass_feedback             = NULLIF(concat_ws(sep,
                                    NULLIF(btrim(e_pri.pass_feedback),''),
                                    NULLIF(btrim(e_dup.pass_feedback),'')), ''),
      indicated_amount          = COALESCE(e_pri.indicated_amount, e_dup.indicated_amount),
      committed_amount          = COALESCE(e_pri.committed_amount, e_dup.committed_amount),
      stage_locked_manual       = e_pri.stage_locked_manual OR e_dup.stage_locked_manual,
      stage_locked_at           = COALESCE(e_pri.stage_locked_at, e_dup.stage_locked_at),
      removed_at                = CASE
                                    WHEN e_pri.removed_at IS NULL OR e_dup.removed_at IS NULL THEN NULL
                                    ELSE GREATEST(e_pri.removed_at, e_dup.removed_at)
                                  END,
      notes = NULLIF(concat_ws(sep,
                NULLIF(btrim(e_pri.notes),''),
                NULLIF(btrim(e_dup.notes),''),
                'Merged from duplicate partner record; that record''s engagement was at stage '
                  || e_dup.stage::text), ''),
      updated_at = now()
    WHERE id = e_pri.id;

    UPDATE public.stage_change_events      SET engagement_id = e_pri.id WHERE engagement_id = e_dup.id;
    UPDATE public.capital_partner_feedback SET engagement_id = e_pri.id WHERE engagement_id = e_dup.id;
    UPDATE public.partner_suggestions      SET engagement_id = e_pri.id WHERE engagement_id = e_dup.id;

    DELETE FROM public.capital_raise_engagements WHERE id = e_dup.id;
  END LOOP;

  UPDATE public.capital_raise_engagements SET partner_id = _primary_id WHERE partner_id = _duplicate_id;

  FOR x_dup IN
    SELECT ce.* FROM public.capital_raise_entries ce
     WHERE ce.partner_id = _duplicate_id
       AND EXISTS (SELECT 1 FROM public.capital_raise_entries pe
                    WHERE pe.partner_id = _primary_id AND pe.deal_id = ce.deal_id)
  LOOP
    SELECT * INTO x_pri FROM public.capital_raise_entries
      WHERE partner_id = _primary_id AND deal_id = x_dup.deal_id FOR UPDATE;

    UPDATE public.capital_raise_entries SET
      stage              = COALESCE(NULLIF(btrim(x_pri.stage),''), x_dup.stage),
      equity_amount      = COALESCE(x_pri.equity_amount, x_dup.equity_amount),
      assigned_poc       = COALESCE(NULLIF(btrim(x_pri.assigned_poc),''), x_dup.assigned_poc),
      last_activity_date = GREATEST(x_pri.last_activity_date, x_dup.last_activity_date),
      notes              = NULLIF(concat_ws(sep,
                             NULLIF(btrim(x_pri.notes),''),
                             NULLIF(btrim(x_dup.notes),'')), ''),
      updated_at         = now()
    WHERE id = x_pri.id;

    DELETE FROM public.capital_raise_entries WHERE id = x_dup.id;
  END LOOP;

  UPDATE public.capital_raise_entries SET partner_id = _primary_id WHERE partner_id = _duplicate_id;

  UPDATE public.entity_tags SET entity_id = _primary_id
    WHERE entity_type = 'partner' AND entity_id = _duplicate_id
      AND NOT EXISTS (
        SELECT 1 FROM public.entity_tags e2
         WHERE e2.entity_type = 'partner' AND e2.entity_id = _primary_id AND e2.tag_id = public.entity_tags.tag_id
      );
  DELETE FROM public.entity_tags WHERE entity_type = 'partner' AND entity_id = _duplicate_id;

  UPDATE public.note_links SET linked_id = _primary_id
    WHERE linked_type = 'partner' AND linked_id = _duplicate_id
      AND NOT EXISTS (
        SELECT 1 FROM public.note_links nl2
         WHERE nl2.linked_type = 'partner' AND nl2.linked_id = _primary_id AND nl2.note_id = public.note_links.note_id
      );
  DELETE FROM public.note_links WHERE linked_type = 'partner' AND linked_id = _duplicate_id;

  UPDATE public.notes SET entity_id = _primary_id
    WHERE entity_type = 'partner' AND entity_id = _duplicate_id;

  UPDATE public.partners SET
    firm_type             = COALESCE(NULLIF(btrim(p.firm_type),''), d.firm_type),
    relationship_strength = COALESCE(NULLIF(btrim(p.relationship_strength),''), d.relationship_strength),
    headquarters          = COALESCE(NULLIF(btrim(p.headquarters),''), d.headquarters),
    website               = COALESCE(NULLIF(btrim(p.website),''), d.website),
    ansonia_poc           = COALESCE(NULLIF(btrim(p.ansonia_poc),''), d.ansonia_poc),
    data_source           = COALESCE(NULLIF(btrim(p.data_source),''), d.data_source),
    status                = COALESCE(NULLIF(btrim(p.status),''), d.status),
    organized_notes       = COALESCE(NULLIF(btrim(p.organized_notes),''), d.organized_notes),
    min_equity_m          = COALESCE(p.min_equity_m, d.min_equity_m),
    max_equity_m          = COALESCE(p.max_equity_m, d.max_equity_m),
    additional_notes = CASE
      WHEN COALESCE(btrim(d.additional_notes),'') = '' THEN p.additional_notes
      WHEN COALESCE(btrim(p.additional_notes),'') = '' THEN d.additional_notes
      ELSE p.additional_notes || sep || d.additional_notes
    END,
    investor_type   = ARRAY(SELECT DISTINCT unnest(COALESCE(p.investor_type,'{}') || COALESCE(d.investor_type,'{}'))),
    geography       = ARRAY(SELECT DISTINCT unnest(COALESCE(p.geography,'{}') || COALESCE(d.geography,'{}'))),
    geography_avoid = ARRAY(SELECT DISTINCT unnest(COALESCE(p.geography_avoid,'{}') || COALESCE(d.geography_avoid,'{}'))),
    hold_period     = ARRAY(SELECT DISTINCT unnest(COALESCE(p.hold_period,'{}') || COALESCE(d.hold_period,'{}'))),
    product_types   = ARRAY(SELECT DISTINCT unnest(COALESCE(p.product_types,'{}') || COALESCE(d.product_types,'{}'))),
    manual_fields   = ARRAY(SELECT DISTINCT unnest(COALESCE(p.manual_fields,'{}') || COALESCE(d.manual_fields,'{}'))),
    urban_infill        = COALESCE(p.urban_infill,false) OR COALESCE(d.urban_infill,false),
    suburban            = COALESCE(p.suburban,false) OR COALESCE(d.suburban,false),
    strategy_value_add  = COALESCE(p.strategy_value_add,false) OR COALESCE(d.strategy_value_add,false),
    strategy_core_plus  = COALESCE(p.strategy_core_plus,false) OR COALESCE(d.strategy_core_plus,false),
    strategy_workforce  = COALESCE(p.strategy_workforce,false) OR COALESCE(d.strategy_workforce,false),
    strategy_affordable = COALESCE(p.strategy_affordable,false) OR COALESCE(d.strategy_affordable,false),
    last_edited_at = now()
  WHERE id = _primary_id
  RETURNING * INTO merged;

  UPDATE public.partners SET archived_at = COALESCE(archived_at, now()), last_edited_at = now()
   WHERE id = _duplicate_id;

  RETURN merged;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_partners(uuid, uuid) TO authenticated, service_role;
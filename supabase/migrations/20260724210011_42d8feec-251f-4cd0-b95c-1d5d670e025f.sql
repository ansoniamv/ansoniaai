
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

  -- Re-point child records. Use ON CONFLICT DO NOTHING where junctions have unique keys.
  UPDATE public.partner_contacts       SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.partner_interactions   SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.partner_attachments    SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.partner_suggestions    SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.partner_warmth_signals SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.partner_tasks          SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.capital_raise_engagements SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.capital_raise_entries  SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.capital_partner_feedback SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.warmth_import_log      SET partner_id = _primary_id WHERE partner_id = _duplicate_id;
  UPDATE public.outlook_messages       SET partner_id = _primary_id WHERE partner_id = _duplicate_id;

  -- entity_tags: unique on (tag_id, entity_type, entity_id)? Just attempt and swallow dup via delete-after
  UPDATE public.entity_tags SET entity_id = _primary_id
    WHERE entity_type = 'partner' AND entity_id = _duplicate_id
      AND NOT EXISTS (
        SELECT 1 FROM public.entity_tags e2
         WHERE e2.entity_type = 'partner' AND e2.entity_id = _primary_id AND e2.tag_id = public.entity_tags.tag_id
      );
  DELETE FROM public.entity_tags WHERE entity_type = 'partner' AND entity_id = _duplicate_id;

  -- note_links
  UPDATE public.note_links SET linked_id = _primary_id
    WHERE linked_type = 'partner' AND linked_id = _duplicate_id
      AND NOT EXISTS (
        SELECT 1 FROM public.note_links nl2
         WHERE nl2.linked_type = 'partner' AND nl2.linked_id = _primary_id AND nl2.note_id = public.note_links.note_id
      );
  DELETE FROM public.note_links WHERE linked_type = 'partner' AND linked_id = _duplicate_id;

  -- notes rows with entity_type='partner'
  UPDATE public.notes SET entity_id = _primary_id
    WHERE entity_type = 'partner' AND entity_id = _duplicate_id;

  -- Merge partner fields: primary wins where set; else fill from duplicate.
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
    -- Array unions
    investor_type   = ARRAY(SELECT DISTINCT unnest(COALESCE(p.investor_type,'{}') || COALESCE(d.investor_type,'{}'))),
    geography       = ARRAY(SELECT DISTINCT unnest(COALESCE(p.geography,'{}') || COALESCE(d.geography,'{}'))),
    geography_avoid = ARRAY(SELECT DISTINCT unnest(COALESCE(p.geography_avoid,'{}') || COALESCE(d.geography_avoid,'{}'))),
    hold_period     = ARRAY(SELECT DISTINCT unnest(COALESCE(p.hold_period,'{}') || COALESCE(d.hold_period,'{}'))),
    product_types   = ARRAY(SELECT DISTINCT unnest(COALESCE(p.product_types,'{}') || COALESCE(d.product_types,'{}'))),
    manual_fields   = ARRAY(SELECT DISTINCT unnest(COALESCE(p.manual_fields,'{}') || COALESCE(d.manual_fields,'{}'))),
    -- Boolean OR
    urban_infill        = COALESCE(p.urban_infill,false) OR COALESCE(d.urban_infill,false),
    suburban            = COALESCE(p.suburban,false) OR COALESCE(d.suburban,false),
    strategy_value_add  = COALESCE(p.strategy_value_add,false) OR COALESCE(d.strategy_value_add,false),
    strategy_core_plus  = COALESCE(p.strategy_core_plus,false) OR COALESCE(d.strategy_core_plus,false),
    strategy_workforce  = COALESCE(p.strategy_workforce,false) OR COALESCE(d.strategy_workforce,false),
    strategy_affordable = COALESCE(p.strategy_affordable,false) OR COALESCE(d.strategy_affordable,false),
    last_edited_at = now()
  WHERE id = _primary_id
  RETURNING * INTO merged;

  -- Soft-delete duplicate
  UPDATE public.partners SET archived_at = COALESCE(archived_at, now()), last_edited_at = now()
   WHERE id = _duplicate_id;

  RETURN merged;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_partners(uuid, uuid) TO authenticated, service_role;

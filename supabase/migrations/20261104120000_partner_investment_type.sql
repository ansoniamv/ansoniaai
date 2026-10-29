-- Split "Investor Type" into two fields (change request fa5f3d35):
--   investor_type   — WHO the partner is: Individual, Family Office, Fund, Institution, ...
--   investment_type — HOW they invest with us: JV Equity, Preferred Equity, GP Equity, ...
--
-- investor_type used to hold both (JV, Sidecar and Large JV were the most
-- common tags). Existing tags are moved across with the mapping below, and the
-- old free-text firm_type is folded into investor_type ('Other' dropped). The
-- firm_type column is kept for now; the app no longer edits it.

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS investment_type text[] DEFAULT '{}';

-- One-off backfill. Guarded so a re-run does not reshuffle tags people have
-- set since. The change-log and last-edited triggers are paused: this is a
-- relabel, not news, and must not show up in the Capital Feed as ~150 edits.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.partners WHERE cardinality(investment_type) > 0) THEN
    RETURN;
  END IF;

  ALTER TABLE public.partners DISABLE TRIGGER partners_log_changes;
  ALTER TABLE public.partners DISABLE TRIGGER partners_touch_last_edited;

  WITH tag_map(old_value, field, new_value) AS (VALUES
    ('JV',                'investment', 'JV Equity'),
    ('JV Equity',         'investment', 'JV Equity'),
    ('Large JV',          'investment', 'Large JV'),
    ('Sidecar',           'investment', 'Sidecar'),
    ('Passive Co-Invest', 'investment', 'Passive Co-Invest'),
    ('GP Co-Invest',      'investment', 'GP Co-Invest'),
    ('GP',                'investment', 'GP Equity'),
    ('Co-GP',             'investment', 'GP Equity'),
    ('GP Equity',         'investment', 'GP Equity'),
    ('LP',                'investment', 'LP Equity'),
    ('LP Equity',         'investment', 'LP Equity'),
    ('Preferred Equity',  'investment', 'Preferred Equity'),
    ('Fund',              'investor',   'Fund'),
    ('PERE Fund',         'investor',   'Fund'),
    ('Institutional',     'investor',   'Institution'),
    ('Institution',       'investor',   'Institution'),
    ('HNW',               'investor',   'Individual'),
    ('Pension Fund',      'investor',   'Pension')
  ),
  -- firm_type goes first so it leads the investor_type list. Anything not in
  -- the map (Family Office, RIA, Pension, ...) stays an investor type as-is.
  raw AS (
    SELECT p.id, btrim(p.firm_type) AS v, 0::bigint AS ord
      FROM public.partners p
     WHERE nullif(btrim(p.firm_type), '') IS NOT NULL AND btrim(p.firm_type) <> 'Other'
    UNION ALL
    SELECT p.id, btrim(u.v), u.ord
      FROM public.partners p
     CROSS JOIN LATERAL unnest(p.investor_type) WITH ORDINALITY AS u(v, ord)
     WHERE nullif(btrim(u.v), '') IS NOT NULL
  ),
  mapped AS (
    SELECT r.id,
           coalesce(m.field, 'investor') AS field,
           coalesce(m.new_value, r.v)    AS value,
           min(r.ord)                    AS ord
      FROM raw r
      LEFT JOIN tag_map m ON m.old_value = r.v
     GROUP BY 1, 2, 3
  ),
  split AS (
    SELECT id,
           coalesce(array_agg(value ORDER BY ord) FILTER (WHERE field = 'investor'), '{}')   AS investor_type,
           coalesce(array_agg(value ORDER BY ord) FILTER (WHERE field = 'investment'), '{}') AS investment_type
      FROM mapped
     GROUP BY id
  )
  UPDATE public.partners p
     SET investor_type = s.investor_type,
         investment_type = s.investment_type
    FROM split s
   WHERE p.id = s.id;

  -- A hand-set investor_type was the source of both fields, so enrichment must
  -- leave the new one alone too, and its provenance carries over.
  UPDATE public.partners
     SET manual_fields = manual_fields || ARRAY['investment_type']
   WHERE 'investor_type' = ANY(manual_fields)
     AND NOT ('investment_type' = ANY(manual_fields));

  UPDATE public.partners
     SET enriched_fields = enriched_fields || jsonb_build_object('investment_type', enriched_fields -> 'investor_type')
   WHERE enriched_fields ? 'investor_type'
     AND NOT enriched_fields ? 'investment_type';

  ALTER TABLE public.partners ENABLE TRIGGER partners_log_changes;
  ALTER TABLE public.partners ENABLE TRIGGER partners_touch_last_edited;
END
$$;

-- Track the new field in the Capital Feed change log. Same body as
-- 20261102120000_partner_blacklist.sql plus 'investment_type'.
CREATE OR REPLACE FUNCTION public.trg_partners_log_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tracked text[] := ARRAY[
    'name', 'firm_type', 'relationship_strength', 'ansonia_poc', 'website', 'headquarters',
    'status', 'archived_at', 'blacklisted_at', 'blacklist_reason',
    'capital_status', 'capital_status_detail', 'capital_available_from',
    'min_equity_m', 'max_equity_m', 'investor_type', 'investment_type', 'hold_period', 'product_types',
    'geography', 'geography_avoid', 'urban_infill', 'suburban',
    'strategy_value_add', 'strategy_core_plus', 'strategy_workforce', 'strategy_affordable',
    'additional_notes'
  ];
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
  uid uuid := auth.uid();
  label text;
  k text;
BEGIN
  IF uid IS NOT NULL THEN
    SELECT coalesce(nullif(full_name, ''), email) INTO label FROM public.profiles WHERE id = uid;
  END IF;
  FOREACH k IN ARRAY tracked LOOP
    IF (o -> k) IS DISTINCT FROM (n -> k) THEN
      INSERT INTO public.partner_change_log (partner_id, field, old_value, new_value, changed_by, changed_by_label, source)
      VALUES (NEW.id, k, o -> k, n -> k, uid, label, CASE WHEN uid IS NULL THEN 'system' ELSE 'user' END);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- Partner merge unions the new field like the other tag arrays. Body is
-- 20260831201522's merge_partners, renamed to _unguarded by
-- 20260904120000_close_authorization_bypasses.sql; the guarded merge_partners
-- wrapper is left as it is.
CREATE OR REPLACE FUNCTION public.merge_partners_unguarded(_primary_id uuid, _duplicate_id uuid)
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
    investment_type = ARRAY(SELECT DISTINCT unnest(COALESCE(p.investment_type,'{}') || COALESCE(d.investment_type,'{}'))),
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

REVOKE ALL ON FUNCTION public.merge_partners_unguarded(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_partners_unguarded(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.merge_partners_unguarded(uuid, uuid) FROM authenticated;

COMMENT ON COLUMN public.partners.investor_type IS
  'Who the partner is: Individual, Family Office, RIA, Fund, Institution, Pension, ...';
COMMENT ON COLUMN public.partners.investment_type IS
  'How the partner invests with us: JV Equity, Preferred Equity, GP Equity, Passive Co-Invest, ...';

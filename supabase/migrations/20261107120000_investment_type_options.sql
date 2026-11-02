-- Investment Type option list cut to six:
--   JV Equity, Large JV, Preferred Equity, Co-Invest/Passive LP, Fund Investor, GP Fund Investor
-- Sidecar, LP Equity and Passive Co-Invest become Co-Invest/Passive LP;
-- GP Equity and GP Co-Invest become GP Fund Investor. Fund Investor is new.
--
-- The change-log and last-edited triggers are paused: this is a relabel, not
-- news, and must not show up in the Capital Feed as ~90 edits. Re-running is a
-- no-op because the old labels are gone after the first run.
DO $$
BEGIN
  ALTER TABLE public.partners DISABLE TRIGGER partners_log_changes;
  ALTER TABLE public.partners DISABLE TRIGGER partners_touch_last_edited;

  WITH tag_map(old_value, new_value) AS (VALUES
    ('Sidecar',           'Co-Invest/Passive LP'),
    ('LP Equity',         'Co-Invest/Passive LP'),
    ('Passive Co-Invest', 'Co-Invest/Passive LP'),
    ('GP Equity',         'GP Fund Investor'),
    ('GP Co-Invest',      'GP Fund Investor')
  ),
  -- Keep each partner's tag order; merged tags take the earliest position.
  mapped AS (
    SELECT p.id, coalesce(m.new_value, u.v) AS v, min(u.ord) AS ord
      FROM public.partners p
     CROSS JOIN LATERAL unnest(p.investment_type) WITH ORDINALITY AS u(v, ord)
      LEFT JOIN tag_map m ON m.old_value = u.v
     WHERE p.investment_type && ARRAY(SELECT old_value FROM tag_map)
     GROUP BY 1, 2
  ),
  relabelled AS (
    SELECT id, array_agg(v ORDER BY ord) AS investment_type
      FROM mapped
     GROUP BY id
  )
  UPDATE public.partners p
     SET investment_type = r.investment_type
    FROM relabelled r
   WHERE p.id = r.id;

  ALTER TABLE public.partners ENABLE TRIGGER partners_log_changes;
  ALTER TABLE public.partners ENABLE TRIGGER partners_touch_last_edited;
END $$;

COMMENT ON COLUMN public.partners.investment_type IS
  'How the partner invests with us: JV Equity, Large JV, Preferred Equity, Co-Invest/Passive LP, Fund Investor, GP Fund Investor';

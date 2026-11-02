-- Who typed each pass reason, and when.
--
-- summarize-partner-pass turns a pass reason ("too small, $50M minimum
-- investment") into partner criteria suggestions. When no email backs the
-- reason, the person who typed it is the only source, so the Atlas Inbox has
-- to be able to say who that was. Stamped by trigger so every save path (the
-- pass dialog, the inline edit, any future one) is covered.

ALTER TABLE public.capital_raise_engagements
  ADD COLUMN IF NOT EXISTS pass_feedback_by text,
  ADD COLUMN IF NOT EXISTS pass_feedback_at timestamptz;

COMMENT ON COLUMN public.capital_raise_engagements.pass_feedback_by IS
  'Name (or email) of the signed-in user who last changed pass_feedback; null when written by a service or before 2026-11-02.';
COMMENT ON COLUMN public.capital_raise_engagements.pass_feedback_at IS
  'When pass_feedback last changed.';

ALTER TABLE public.capital_partner_feedback
  ADD COLUMN IF NOT EXISTS created_by text;

-- The signed-in user's name, falling back to their email. Null for service
-- roles and cron, which have no auth.uid().
CREATE OR REPLACE FUNCTION public.current_user_label()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(trim(full_name), ''), email) FROM public.profiles WHERE id = auth.uid()
$$;

ALTER TABLE public.capital_partner_feedback
  ALTER COLUMN created_by SET DEFAULT public.current_user_label();

CREATE OR REPLACE FUNCTION public.trg_engagement_stamp_pass_feedback()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.pass_feedback IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.pass_feedback IS DISTINCT FROM OLD.pass_feedback) THEN
    NEW.pass_feedback_at := now();
    NEW.pass_feedback_by := public.current_user_label();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engagement_stamp_pass_feedback ON public.capital_raise_engagements;
CREATE TRIGGER engagement_stamp_pass_feedback
  BEFORE INSERT OR UPDATE ON public.capital_raise_engagements
  FOR EACH ROW EXECUTE FUNCTION public.trg_engagement_stamp_pass_feedback();

-- Existing reasons: the date can be recovered from the feedback log written
-- when the pass was recorded; the author cannot.
UPDATE public.capital_raise_engagements e
SET pass_feedback_at = f.created_at
FROM (
  SELECT DISTINCT ON (engagement_id) engagement_id, reason_text, created_at
  FROM public.capital_partner_feedback
  WHERE engagement_id IS NOT NULL
  ORDER BY engagement_id, created_at DESC
) f
WHERE f.engagement_id = e.id
  AND e.pass_feedback_at IS NULL
  AND e.pass_feedback IS NOT NULL
  AND f.reason_text IS NOT DISTINCT FROM e.pass_feedback;

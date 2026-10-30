-- Why each partner passed, in one line, and what it says about their criteria.
--
-- A pass is recorded on a capital_raise_engagements row, sometimes with the
-- analyst's notes (pass_feedback), sometimes with nothing at all (the status
-- dropdown). summarize-partner-pass reads the notes and the partner's emails
-- about the deal, writes a short reason onto the row, and turns a stated
-- standing preference ("we don't do suburban Chicago", "$50M minimum") into a
-- partner criteria change, or a suggestion when a person owns that field.
--
-- Kept current two ways: the trigger below queues a run whenever a pass is
-- recorded or its notes change, and a nightly sweep re-reads every pass so a
-- partner email that arrives later is picked up. The function skips any pass
-- whose inputs hash is unchanged, so the sweep costs nothing on a quiet night.

ALTER TABLE public.capital_raise_engagements
  ADD COLUMN IF NOT EXISTS pass_summary text,
  ADD COLUMN IF NOT EXISTS pass_summary_basis text,
  ADD COLUMN IF NOT EXISTS pass_summary_evidence jsonb,
  ADD COLUMN IF NOT EXISTS pass_summary_updates jsonb,
  ADD COLUMN IF NOT EXISTS pass_summary_hash text,
  ADD COLUMN IF NOT EXISTS pass_summary_at timestamptz,
  ADD COLUMN IF NOT EXISTS pass_summary_pending boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.capital_raise_engagements.pass_summary IS
  'AI one-liner: why the partner passed. Written by summarize-partner-pass.';
COMMENT ON COLUMN public.capital_raise_engagements.pass_summary_basis IS
  'partner = grounded in a verbatim quote from the pass notes or a partner email; inferred = the deal against their criteria, no stated reason; unknown = nothing to go on.';
COMMENT ON COLUMN public.capital_raise_engagements.pass_summary_evidence IS
  '{quote, source: "feedback" | outlook message id, date} behind the summary.';
COMMENT ON COLUMN public.capital_raise_engagements.pass_summary_updates IS
  'Criteria changes the pass led to: [{field, value, outcome: applied | suggested | unchanged | older, quote}].';
COMMENT ON COLUMN public.capital_raise_engagements.pass_summary_pending IS
  'True between a pass being recorded and summarize-partner-pass finishing; the UI polls while set.';

-- Queues summarize-partner-pass for this engagement. BEFORE so it can set the
-- pending flag on the same row; pg_net only sends after the transaction
-- commits, and a rollback drops the request with it.
--
-- Trigger order matters: Postgres fires BEFORE triggers by name, and
-- engagement_stage_automation (which flips stage to passed when pass_feedback
-- is entered) must run first so this one sees the final stage. Keep this
-- trigger's name sorting after it.
CREATE OR REPLACE FUNCTION public.trg_engagement_queue_pass_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage <> 'passed'::public.raise_engagement_stage OR NEW.removed_at IS NOT NULL THEN
    NEW.pass_summary_pending := false;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.stage IS NOT DISTINCT FROM NEW.stage
     AND OLD.pass_feedback IS NOT DISTINCT FROM NEW.pass_feedback
     AND OLD.pass_category IS NOT DISTINCT FROM NEW.pass_category
     AND OLD.removed_at IS NOT DISTINCT FROM NEW.removed_at THEN
    RETURN NEW;
  END IF;

  NEW.pass_summary_pending := true;
  PERFORM net.http_post(
    url := 'https://pyndxntvoixxndbwiawd.supabase.co/functions/v1/summarize-partner-pass',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret')),
    body := jsonb_build_object('engagement_id', NEW.id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engagement_stage_pass_summary ON public.capital_raise_engagements;
CREATE TRIGGER engagement_stage_pass_summary
  BEFORE INSERT OR UPDATE ON public.capital_raise_engagements
  FOR EACH ROW EXECUTE FUNCTION public.trg_engagement_queue_pass_summary();

-- Nightly sweep, after the 03:30 learn-from-feedback run: picks up partner
-- emails that arrived after the pass was recorded.
SELECT cron.unschedule('summarize-partner-passes-nightly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'summarize-partner-passes-nightly');

SELECT cron.schedule(
  'summarize-partner-passes-nightly',
  '45 3 * * *',
  $job$
  select net.http_post(
    url := 'https://pyndxntvoixxndbwiawd.supabase.co/functions/v1/summarize-partner-pass',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
      'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_shared_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000);
  $job$
);

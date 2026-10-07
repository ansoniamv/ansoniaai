-- Rebuild the learned strategy nightly instead of only when someone clicks.
--
-- learn-from-feedback distils analyst passes into the "How Ansonia decides" note
-- that is injected into every gate-deals and score-deals prompt. Nothing ran it
-- on a schedule, and it required an approved USER, so it could only ever be
-- triggered by hand. The note therefore sat frozen while passes accumulated —
-- 107 real denials in the last 30 days alone.
--
-- Runs at 03:30 UTC, half an hour before daily-digest, so the digest reports
-- against a freshly rebuilt note.
--
-- Scope note: this refreshes SOFT context only. The model weighs the note
-- alongside the thesis; it does not mutate buy_box_pillars, buy_box_signals or
-- any hard gate. That separation is deliberate. On current data a rule derived
-- automatically from passes would be actively wrong: Texas is the most-rejected
-- geography (19 passes) while the firm owns three Texas assets and the thesis
-- names Sunbelt expansion. Those passes are about submarkets, and at ~5 per
-- state there is not yet the resolution to tell which. Criteria stay human-owned
-- until the evidence supports otherwise.

select cron.schedule(
  'learn-from-feedback-nightly',
  '30 3 * * *',
  $job$
  select net.http_post(
    url := 'https://pyndxntvoixxndbwiawd.supabase.co/functions/v1/learn-from-feedback',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
      'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_shared_secret')),
    body := '{}'::jsonb);
  $job$
);

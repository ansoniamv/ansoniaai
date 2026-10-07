-- Schedule the acquisitions mailbox, and re-enable the digest.
--
-- Supersedes 20261005234500, which failed on its last statement:
--
--   update cron.job set active = true where jobname = 'daily-digest';
--   ERROR: permission denied for table job (SQLSTATE 42501)
--
-- The migration role may call cron.schedule but may not UPDATE cron.job
-- directly. The whole migration rolled back, so nothing from it landed. Here
-- both jobs are registered through cron.schedule, which re-registers an existing
-- job by name and leaves it active — no direct writes to the catalog.
--
-- Why these two jobs:
--
-- Only scheduled-atlas-run and daily-digest existed, and scheduled-atlas-run
-- syncs the ATLAS mailbox. Nothing synced acquisitions. It ran only when someone
-- opened the app and the frontend fired it, so when that stopped the mailbox fell
-- six days behind — 245 unread broker emails, recovered by hand on 2026-10-05.
-- That is the mailbox with the actual deal flow in it.
--
-- daily-digest carries a stale-mailbox alarm written for exactly this failure,
-- and it was the inactive job, which is why nothing said anything for six days.
-- An alarm that is switched off is worse than no alarm: it reads as coverage.
--
-- Every 30 minutes matches the Atlas cadence and is well inside Graph limits.
-- outlook-sync is idempotent on message_id, so an overlapping run re-upserts
-- rather than duplicating.

select cron.schedule(
  'acquisitions-mailbox-sync',
  '*/30 * * * *',
  $job$
  select net.http_post(
    url := 'https://pyndxntvoixxndbwiawd.supabase.co/functions/v1/outlook-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
      'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_shared_secret')),
    body := '{"mailbox":"acquisitions"}'::jsonb);
  $job$
);

-- Re-register daily-digest under the same name and schedule, which reactivates
-- it. Command copied verbatim from the existing job so nothing else changes.
select cron.schedule(
  'daily-digest',
  '0 4 * * *',
  $job$
  select net.http_post(
    url := 'https://pyndxntvoixxndbwiawd.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
      'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_shared_secret')),
    body := '{}'::jsonb);
  $job$
);

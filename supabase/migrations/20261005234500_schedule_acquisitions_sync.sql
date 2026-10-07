-- Put the acquisitions mailbox on a schedule, and turn the alarm back on.
--
-- Only two jobs existed: scheduled-atlas-run (which syncs the ATLAS mailbox) and
-- daily-digest (inactive). Nothing synced acquisitions. It ran only when someone
-- opened the app and the frontend fired it, so when that stopped happening the
-- mailbox silently fell six days behind — 245 unread broker emails, recovered by
-- hand on 2026-10-05. That is the mailbox with the actual deal flow in it.
--
-- daily-digest carries a stale-mailbox alarm written for exactly this failure.
-- It was the disabled job, which is why nothing said anything for six days. An
-- alarm that is switched off is worse than no alarm: it reads as coverage.
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

-- Re-enable the digest so a stale mailbox raises an alarm instead of going quiet.
update cron.job set active = true where jobname = 'daily-digest';

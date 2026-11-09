-- Collect CA runs nobody has open: the deal page checks a run every 20 s while
-- it is on screen, and this sweep checks the rest every 5 minutes (answering
-- verification-code requests and saving finished runs).
SELECT cron.unschedule('deal-agents-sweep')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'deal-agents-sweep');

SELECT cron.schedule(
  'deal-agents-sweep',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://pyndxntvoixxndbwiawd.supabase.co/functions/v1/deal-agents',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
      'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_shared_secret')),
    body := '{"action":"sweep"}'::jsonb,
    timeout_milliseconds := 120000);
  $job$
);

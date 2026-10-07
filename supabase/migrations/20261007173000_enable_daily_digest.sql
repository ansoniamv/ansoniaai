-- Make daily-digest active, in a way the migration role is allowed to do.
--
-- Two earlier attempts did not work:
--
--   update cron.job set active = true ...   -> permission denied for table job
--   select cron.schedule('daily-digest',..) -> succeeded, left active = false
--
-- cron.schedule re-registers the command and schedule but does not clear the
-- inactive flag, which is why the job still read active = false afterwards even
-- though the migration reported success. cron.alter_job is the supported path
-- and is permitted here.
--
-- Recorded as a migration because the flag was first flipped by hand while
-- establishing which call worked. Without this the change would not survive a
-- rebuild from migrations, and the schema history would not describe the live
-- database. Idempotent: setting active on an already-active job is a no-op.
--
-- Why it matters: daily-digest carries the stale-mailbox alarm. It was the
-- inactive job while the acquisitions mailbox sat six days behind, which is why
-- nothing raised it. It also runs the only sweep that scores deals outside the
-- gate fan-out.

do $$
declare
  _jobid bigint;
begin
  select jobid into _jobid from cron.job where jobname = 'daily-digest';
  if _jobid is null then
    raise notice 'daily-digest job not found; nothing to enable';
  else
    perform cron.alter_job(job_id := _jobid, active := true);
  end if;
end $$;

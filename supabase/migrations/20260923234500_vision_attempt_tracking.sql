-- Stop permanently-failing vision passes from being retried for ever.
--
-- summarize-emails selects on `vision_checked = false`, and its error handler
-- deliberately leaves that flag false so a transient failure retries. But the
-- failures we actually see are not transient: "This URL is disallowed by the
-- website's robots.txt file", "Only HTTPS URLs are supported", and base64
-- media-type mismatches will fail identically on every future attempt.
--
-- The result was a permanent retry loop. Measured over one drain: 368 vision
-- failures across 61 distinct emails — 6.03 attempts each — and every one of
-- those attempts first paid for a text-extraction call on the same row. That is
-- the reason cost per summary cleared came in at $0.0379 against a $0.0104
-- estimate.
--
-- These two columns let the selector distinguish "not tried yet" from "tried and
-- failed repeatedly", so a bad email costs at most two attempts instead of one
-- per batch for the rest of time.

alter table public.deal_emails
  add column if not exists vision_attempts integer not null default 0,
  add column if not exists vision_error text;

comment on column public.deal_emails.vision_attempts is
  'Vision passes attempted for this email. The selector skips rows at 2 or more, so a permanently unreadable image cannot be retried indefinitely.';
comment on column public.deal_emails.vision_error is
  'Last vision failure, verbatim and truncated. Present means the images could not be read; the text summary is still written.';

-- Rows already stuck in the loop: they have failed repeatedly and will keep
-- failing. Mark them so the next run does not pick them up again.
update public.deal_emails
set vision_attempts = 2,
    vision_error = 'Backfilled: repeatedly failed before attempt tracking existed.'
where vision_checked = false
  and id in (
    select distinct e.id
    from public.deal_emails e
    join public.ai_usage_log u
      on u.deal_id = e.deal_id
     and u.function_name = 'summarize-emails'
     and u.success = false
     and u.created_at > now() - interval '2 hours'
  );

-- Partial index: the selector's hot predicate is "needs a vision pass", which is
-- now two columns rather than one.
create index if not exists deal_emails_vision_pending_idx
  on public.deal_emails (received_at desc)
  where vision_checked = false and vision_attempts < 2;

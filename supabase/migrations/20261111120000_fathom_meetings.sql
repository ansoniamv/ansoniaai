-- Fathom meetings: each user can connect their own Fathom account; the platform
-- keeps a rolling 30 days of their external calls (summary, action items,
-- transcript) so Atlas can search what was said.
--
-- Visibility (decided 2026-11-09): every approved user can read every synced
-- meeting. Only calls with at least one external attendee are synced, which
-- keeps internal 1:1s out of the shared pool.
--
-- Credentials live in their own table with RLS on and no policies, so only the
-- service role (the fathom functions) can read them, and the values are
-- AES-GCM encrypted by the function before they are stored.

-- ---------- Connections (one per user) ----------
CREATE TABLE IF NOT EXISTS public.fathom_connections (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  auth_method    text NOT NULL CHECK (auth_method IN ('oauth', 'api_key')),
  -- NULL when Fathom refused the webhook; the 10-minute sync still covers it.
  webhook_id     text,
  status         text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'needs_reconnect', 'error')),
  last_error     text,
  last_synced_at timestamptz,
  connected_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- Credentials (service role only) ----------
CREATE TABLE IF NOT EXISTS public.fathom_credentials (
  user_id            uuid PRIMARY KEY REFERENCES public.fathom_connections(user_id) ON DELETE CASCADE,
  access_token_enc   text,
  refresh_token_enc  text,
  api_key_enc        text,
  webhook_secret_enc text,
  expires_at         timestamptz,
  -- Fathom refresh tokens are single-use. A refresh only saves its result when
  -- token_version still matches what it read, so two runs racing cannot leave
  -- the row holding a token Fathom has already burned.
  token_version      integer NOT NULL DEFAULT 0
);

-- ---------- OAuth state (one-time, 10 minutes) ----------
CREATE TABLE IF NOT EXISTS public.fathom_oauth_states (
  state        text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);

-- ---------- Meetings ----------
CREATE TABLE IF NOT EXISTS public.fathom_meetings (
  -- Fathom's recording id: a call two connected users both have is stored once.
  recording_id      bigint PRIMARY KEY,
  synced_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title             text NOT NULL,
  started_at        timestamptz,
  ended_at          timestamptz,
  recorded_by_name  text,
  recorded_by_email text,
  share_url         text,
  invitees          jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary_md        text,
  action_items      jsonb NOT NULL DEFAULT '[]'::jsonb,
  partner_ids       uuid[] NOT NULL DEFAULT '{}',
  content_status    text NOT NULL DEFAULT 'pending'
                    CHECK (content_status IN ('pending', 'ready', 'failed')),
  content_attempts  integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fathom_meetings_started_idx ON public.fathom_meetings (started_at DESC);
CREATE INDEX IF NOT EXISTS fathom_meetings_pending_idx ON public.fathom_meetings (content_status)
  WHERE content_status = 'pending';
CREATE INDEX IF NOT EXISTS fathom_meetings_partner_idx ON public.fathom_meetings USING gin (partner_ids);
CREATE INDEX IF NOT EXISTS fathom_meetings_synced_by_idx ON public.fathom_meetings (synced_by);

-- ---------- Transcript chunks ----------
CREATE TABLE IF NOT EXISTS public.fathom_transcript_chunks (
  recording_id bigint NOT NULL REFERENCES public.fathom_meetings(recording_id) ON DELETE CASCADE,
  seq          integer NOT NULL,
  -- Speakers in this chunk, in order of first appearance ("Jane Doe, Max V").
  speakers     text NOT NULL DEFAULT '',
  -- HH:MM:SS from the start of the call, of the chunk's first line.
  start_ts     text,
  content      text NOT NULL,
  search       tsvector GENERATED ALWAYS AS (to_tsvector('english', speakers || ' ' || content)) STORED,
  PRIMARY KEY (recording_id, seq)
);

CREATE INDEX IF NOT EXISTS fathom_transcript_chunks_search_idx
  ON public.fathom_transcript_chunks USING gin (search);

-- ---------- RLS ----------
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fathom_connections', 'fathom_credentials', 'fathom_oauth_states',
                           'fathom_meetings', 'fathom_transcript_chunks'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;

  -- Meetings and transcripts: readable by every approved user. No authenticated
  -- write policy: only the fathom functions (service role) write them.
  FOREACH t IN ARRAY ARRAY['fathom_meetings', 'fathom_transcript_chunks'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS "approved users can select" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "approved users can select" ON public.%I FOR SELECT TO authenticated USING (public.is_approved(auth.uid()))$p$, t);
  END LOOP;
END
$do$;

-- A user reads their own connection row (status, email, last sync). Writes go
-- through the fathom function.
GRANT SELECT ON public.fathom_connections TO authenticated;
DROP POLICY IF EXISTS "users read own connection" ON public.fathom_connections;
CREATE POLICY "users read own connection" ON public.fathom_connections
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- fathom_credentials and fathom_oauth_states: RLS on, no policies, no grants to
-- authenticated. Service role only.

-- ---------- Search ----------
-- With a query: full-text search over transcript chunks, plus a match on the
-- meeting's title and summary, best first.
-- Without a query: the most recent meetings matching the filters.
--
-- SECURITY INVOKER: the caller's RLS decides what they can read.
CREATE OR REPLACE FUNCTION public.search_fathom_meetings(
  _query      text DEFAULT NULL,
  _partner_id uuid DEFAULT NULL,
  _after      timestamptz DEFAULT NULL,
  _limit      integer DEFAULT 10
)
RETURNS TABLE (
  recording_id      bigint,
  title             text,
  started_at        timestamptz,
  recorded_by_name  text,
  invitees          jsonb,
  partner_ids       uuid[],
  share_url         text,
  speakers          text,
  start_ts          text,
  passage           text,
  rank              real
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  lim integer := least(greatest(coalesce(_limit, 10), 1), 25);
  tsq tsquery;
BEGIN
  IF coalesce(btrim(_query), '') = '' THEN
    RETURN QUERY
      SELECT m.recording_id, m.title, m.started_at, m.recorded_by_name, m.invitees,
             m.partner_ids, m.share_url, NULL::text, NULL::text,
             left(coalesce(m.summary_md, ''), 600), 0::real
      FROM public.fathom_meetings m
      WHERE (_partner_id IS NULL OR _partner_id = ANY (m.partner_ids))
        AND (_after IS NULL OR m.started_at >= _after)
      ORDER BY m.started_at DESC NULLS LAST
      LIMIT lim;
    RETURN;
  END IF;

  tsq := websearch_to_tsquery('english', _query);

  RETURN QUERY
    WITH hits AS (
      SELECT c.recording_id, c.speakers, c.start_ts,
             ts_headline('english', c.content, tsq,
                         'MaxWords=60, MinWords=20, MaxFragments=2, FragmentDelimiter=" … "') AS passage,
             ts_rank_cd(c.search, tsq) AS rank
      FROM public.fathom_transcript_chunks c
      WHERE c.search @@ tsq
      UNION ALL
      SELECT m.recording_id, 'Fathom summary', NULL,
             ts_headline('english', m.title || E'\n' || coalesce(m.summary_md, ''), tsq,
                         'MaxWords=60, MinWords=20, MaxFragments=2, FragmentDelimiter=" … "'),
             ts_rank_cd(to_tsvector('english', m.title || ' ' || coalesce(m.summary_md, '')), tsq) * 1.5
      FROM public.fathom_meetings m
      WHERE to_tsvector('english', m.title || ' ' || coalesce(m.summary_md, '')) @@ tsq
    )
    SELECT m.recording_id, m.title, m.started_at, m.recorded_by_name, m.invitees,
           m.partner_ids, m.share_url, h.speakers, h.start_ts, h.passage, h.rank
    FROM hits h
    JOIN public.fathom_meetings m ON m.recording_id = h.recording_id
    WHERE (_partner_id IS NULL OR _partner_id = ANY (m.partner_ids))
      AND (_after IS NULL OR m.started_at >= _after)
    ORDER BY h.rank DESC, m.started_at DESC NULLS LAST
    LIMIT lim;
END
$function$;

REVOKE ALL ON FUNCTION public.search_fathom_meetings(text, uuid, timestamptz, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.search_fathom_meetings(text, uuid, timestamptz, integer)
  TO authenticated, service_role;

-- ---------- Schedules ----------
-- Retention: keep 30 days of calls. Plain SQL, no function call. Transcript
-- chunks go with their meeting through the cascade.
SELECT cron.unschedule('fathom-retention')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fathom-retention');

SELECT cron.schedule(
  'fathom-retention',
  '0 3 * * *',
  $job$
  delete from public.fathom_meetings
  where coalesce(started_at, created_at) < now() - interval '30 days';
  delete from public.fathom_oauth_states where expires_at < now();
  $job$
);

-- Sync: picks up new meetings for every connection and fills in content for
-- meetings still pending. The webhook normally delivers a call within minutes;
-- this is the backstop, and it spreads a first sync over several runs.
SELECT cron.unschedule('fathom-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fathom-sync');

SELECT cron.schedule(
  'fathom-sync',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := 'https://pyndxntvoixxndbwiawd.supabase.co/functions/v1/fathom',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
      'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_shared_secret')),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 150000);
  $job$
);

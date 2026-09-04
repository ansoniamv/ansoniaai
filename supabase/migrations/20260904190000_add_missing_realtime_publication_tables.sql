-- ============================================================================
-- Two tables the frontend subscribes to were never added to the
-- supabase_realtime publication, so their live updates silently never fired.
--
--   src/hooks/useConnectorEnabled.ts:30-40  subscribes to public.connectors
--   src/hooks/useRoadmap.ts:84-88           subscribes to public.roadmap_events
--
-- The publication held only capital_raise_entries, inbox_deals and
-- roadmap_items. This was pre-existing (it predates the project migration);
-- it surfaced while verifying what a data-only dump does and does not carry.
-- Publication membership is schema state, not row data, so it is recorded here
-- rather than left as a dashboard-only change.
-- ============================================================================

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'connectors'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.connectors;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'roadmap_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_events;
  END IF;
END
$do$;

-- connectors is subscribed with a server-side filter (`key=eq.<key>`) and the
-- handler reads payload.new.enabled. REPLICA IDENTITY FULL puts every column in
-- the replication payload, so the filter resolves for UPDATE and DELETE too and
-- not just INSERT. The table holds 2 rows, so the extra WAL is immaterial. This
-- also matches inbox_deals, the one other filtered table in the publication.
ALTER TABLE public.connectors REPLICA IDENTITY FULL;

-- roadmap_events is deliberately left at REPLICA IDENTITY DEFAULT. Its handler
-- ignores the payload entirely and just invalidates a query, so the primary key
-- is sufficient, and it is an append-heavy audit table where FULL would add WAL
-- volume for nothing.

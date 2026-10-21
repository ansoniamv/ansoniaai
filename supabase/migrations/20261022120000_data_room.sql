-- Data Room: the platform's reference library about Ansonia itself — the
-- company website, pro formas, the investor deck, strategy memos, notes. Every
-- AI feature that judges a deal or answers a question reads from it.
--
-- Three layers, so the AI gets the right amount of it:
--   data_room_sources  one row per thing added (file, website, note), with an
--                      AI-written summary and key facts.
--   data_room_chunks   the source's full text in ~2,000-character passages with
--                      a full-text index. Ask Atlas searches these for detail
--                      (search_data_room) instead of reading whole documents.
--   data_room_brief    one compiled Company Brief built from the summaries.
--                      This is what scoring, the inbox gate, property research
--                      and Atlas carry in their prompts on every call.
--
-- Everyone approved can read it; only admins change it. It decides what the AI
-- believes about the firm, so it is curated rather than open to every upload.
-- Chunks are written only by process-data-room-source (service role).

-- ---------- Storage ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('data-room', 'data-room', false, 52428800)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "data-room read"   ON storage.objects;
DROP POLICY IF EXISTS "data-room insert" ON storage.objects;
DROP POLICY IF EXISTS "data-room update" ON storage.objects;
DROP POLICY IF EXISTS "data-room delete" ON storage.objects;

CREATE POLICY "data-room read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'data-room' AND public.is_approved(auth.uid()));

CREATE POLICY "data-room insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'data-room' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "data-room update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'data-room' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'data-room' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "data-room delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'data-room' AND public.has_role(auth.uid(), 'admin'));

-- ---------- Sources ----------
CREATE TABLE IF NOT EXISTS public.data_room_sources (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text NOT NULL CHECK (kind IN ('file', 'website', 'note')),
  title              text NOT NULL,
  category           text NOT NULL DEFAULT 'other'
                     CHECK (category IN ('company', 'strategy', 'pro_forma', 'investor_deck',
                                         'track_record', 'market', 'operations', 'other')),
  -- kind = 'file'
  storage_path       text UNIQUE,
  file_name          text,
  file_size          bigint,
  content_type       text,
  -- kind = 'website': the address entered; pages_read lists what was fetched.
  url                text,
  pages_read         jsonb,
  -- kind = 'note': written in the app.
  body               text,
  -- Off = searchable by Atlas but left out of the Company Brief.
  include_in_brief   boolean NOT NULL DEFAULT true,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error              text,
  -- Warnings from the read ("scanned PDF, read from page images", "truncated").
  notes              text,
  summary            text,
  key_facts          jsonb NOT NULL DEFAULT '[]'::jsonb,
  char_count         integer,
  model              text,
  -- Same claim-and-retry scheme as deal_documents: 'processing' older than a few
  -- minutes is a run that died, and may be claimed again.
  process_started_at timestamptz,
  processed_at       timestamptz,
  created_by         uuid DEFAULT auth.uid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_room_file_has_path   CHECK (kind <> 'file'    OR storage_path IS NOT NULL),
  CONSTRAINT data_room_website_has_url CHECK (kind <> 'website' OR url IS NOT NULL),
  CONSTRAINT data_room_note_has_body   CHECK (kind <> 'note'    OR body IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS data_room_sources_created_idx ON public.data_room_sources (created_at DESC);

DROP TRIGGER IF EXISTS data_room_sources_updated_at ON public.data_room_sources;
CREATE OR REPLACE FUNCTION public.data_room_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER data_room_sources_updated_at
  BEFORE UPDATE ON public.data_room_sources
  FOR EACH ROW EXECUTE FUNCTION public.data_room_touch_updated_at();

-- ---------- Chunks ----------
CREATE TABLE IF NOT EXISTS public.data_room_chunks (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.data_room_sources(id) ON DELETE CASCADE,
  ordinal   integer NOT NULL,
  -- Where in the source: "Page 4", "Sheet: Returns", "Slide 7", a page URL.
  locator   text,
  content   text NOT NULL,
  search    tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (source_id, ordinal)
);

CREATE INDEX IF NOT EXISTS data_room_chunks_search_idx ON public.data_room_chunks USING gin (search);

-- ---------- Brief ----------
-- One row. Rebuilt on request from the page; an admin may also edit the text by
-- hand. The page compares source_ids and built_at with the sources to show when
-- the brief is behind the library.
CREATE TABLE IF NOT EXISTS public.data_room_brief (
  id         smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  content    text NOT NULL,
  source_ids uuid[] NOT NULL DEFAULT '{}',
  model      text,
  built_at   timestamptz,
  built_by   uuid,
  edited_at  timestamptz,
  edited_by  uuid
);

-- ---------- RLS ----------
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['data_room_sources', 'data_room_chunks', 'data_room_brief'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "approved users can select" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "approved users can select" ON public.%I FOR SELECT TO authenticated USING (public.is_approved(auth.uid()))$p$, t);
  END LOOP;

  -- Admins write sources and the brief. Chunks have no authenticated write
  -- policy: only the processing function (service role) writes them, and a
  -- source's chunks go with it on delete through the cascade.
  FOREACH t IN ARRAY ARRAY['data_room_sources', 'data_room_brief'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS "admins can insert" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "admins can update" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "admins can delete" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "admins can insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'))$p$, t);
    EXECUTE format($p$CREATE POLICY "admins can update" ON public.%I FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'))$p$, t);
    EXECUTE format($p$CREATE POLICY "admins can delete" ON public.%I FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'))$p$, t);
  END LOOP;

  GRANT SELECT ON public.data_room_chunks TO authenticated;
END
$do$;

-- ---------- Search ----------
-- Full-text search over the passages of ready sources. websearch_to_tsquery
-- takes what a person or the model types: plain words (all must match),
-- "quoted phrases", OR, and -exclusions.
--
-- SECURITY INVOKER: the caller's RLS decides what they can read, so this is no
-- wider than selecting from the tables directly.
CREATE OR REPLACE FUNCTION public.search_data_room(_query text, _limit integer DEFAULT 8)
RETURNS TABLE (
  source_id uuid,
  title     text,
  category  text,
  kind      text,
  locator   text,
  content   text,
  headline  text,
  rank      real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH q AS (SELECT websearch_to_tsquery('english', coalesce(_query, '')) AS tsq)
  SELECT s.id, s.title, s.category, s.kind, c.locator, c.content,
         ts_headline('english', c.content, q.tsq,
                     'MaxWords=40, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "'),
         ts_rank_cd(c.search, q.tsq)
  FROM q
  JOIN public.data_room_chunks c ON c.search @@ q.tsq
  JOIN public.data_room_sources s ON s.id = c.source_id
  WHERE s.status = 'ready'
  ORDER BY ts_rank_cd(c.search, q.tsq) DESC, c.ordinal
  LIMIT least(greatest(coalesce(_limit, 8), 1), 25);
$function$;

REVOKE ALL ON FUNCTION public.search_data_room(text, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.search_data_room(text, integer) TO authenticated, service_role;

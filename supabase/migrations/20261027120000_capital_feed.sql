-- Capital Feed: comments and reactions on feed stories (partner notes and
-- criteria changes). Keyed by the story's key ("n-<note id>", "i-<quick note
-- id>", "c-<change group>") so any story can be discussed without a foreign key
-- per source table.

-- ── Comments and reactions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.capital_feed_comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key     text NOT NULL,
  body         text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  author_id    uuid NOT NULL DEFAULT auth.uid(),
  author_label text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capital_feed_comments_item_idx ON public.capital_feed_comments (item_key, created_at);

CREATE TABLE IF NOT EXISTS public.capital_feed_reactions (
  item_key   text NOT NULL,
  user_id    uuid NOT NULL DEFAULT auth.uid(),
  emoji      text NOT NULL CHECK (emoji IN ('👍', '🔥', '👀', '✅', '💡', '⚠️')),
  user_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_key, user_id, emoji)
);

-- Stamp who wrote it from the session, not the client, so names can't be
-- spoofed and readers don't need access to profiles.
CREATE OR REPLACE FUNCTION public.trg_capital_feed_stamp_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  label text;
BEGIN
  SELECT coalesce(nullif(full_name, ''), email) INTO label FROM public.profiles WHERE id = auth.uid();
  IF TG_TABLE_NAME = 'capital_feed_comments' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.author_id := auth.uid();
      NEW.author_label := label;
      NEW.created_at := now();
    ELSE
      NEW.author_id := OLD.author_id;
      NEW.author_label := OLD.author_label;
      NEW.item_key := OLD.item_key;
      NEW.created_at := OLD.created_at;
    END IF;
    NEW.updated_at := now();
  ELSE
    NEW.user_id := auth.uid();
    NEW.user_label := label;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capital_feed_comments_stamp ON public.capital_feed_comments;
CREATE TRIGGER capital_feed_comments_stamp
  BEFORE INSERT OR UPDATE ON public.capital_feed_comments
  FOR EACH ROW EXECUTE FUNCTION public.trg_capital_feed_stamp_author();

DROP TRIGGER IF EXISTS capital_feed_reactions_stamp ON public.capital_feed_reactions;
CREATE TRIGGER capital_feed_reactions_stamp
  BEFORE INSERT ON public.capital_feed_reactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_capital_feed_stamp_author();

ALTER TABLE public.capital_feed_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capital_feed_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "approved users can select" ON public.capital_feed_comments;
CREATE POLICY "approved users can select" ON public.capital_feed_comments
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "approved users can comment" ON public.capital_feed_comments;
CREATE POLICY "approved users can comment" ON public.capital_feed_comments
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "authors can edit" ON public.capital_feed_comments;
CREATE POLICY "authors can edit" ON public.capital_feed_comments
  FOR UPDATE TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
DROP POLICY IF EXISTS "authors can delete" ON public.capital_feed_comments;
CREATE POLICY "authors can delete" ON public.capital_feed_comments
  FOR DELETE TO authenticated USING (author_id = auth.uid());

DROP POLICY IF EXISTS "approved users can select" ON public.capital_feed_reactions;
CREATE POLICY "approved users can select" ON public.capital_feed_reactions
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "approved users can react" ON public.capital_feed_reactions;
CREATE POLICY "approved users can react" ON public.capital_feed_reactions
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "users can remove own reactions" ON public.capital_feed_reactions;
CREATE POLICY "users can remove own reactions" ON public.capital_feed_reactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.capital_feed_comments TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.capital_feed_reactions TO authenticated;
GRANT ALL ON public.capital_feed_comments TO service_role;
GRANT ALL ON public.capital_feed_reactions TO service_role;

-- Live updates: a comment from a teammate shows up without a refresh.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'capital_feed_comments') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.capital_feed_comments;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'capital_feed_reactions') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.capital_feed_reactions;
    END IF;
  END IF;
END $$;

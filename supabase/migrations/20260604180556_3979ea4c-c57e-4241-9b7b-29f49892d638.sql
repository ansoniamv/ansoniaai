CREATE TABLE public.chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_threads TO anon, authenticated;
GRANT ALL ON public.chat_threads TO service_role;
ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open chat_threads" ON public.chat_threads FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER chat_threads_updated_at BEFORE UPDATE ON public.chat_threads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  role text NOT NULL,
  message jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_thread_idx ON public.chat_messages(thread_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO anon, authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open chat_messages" ON public.chat_messages FOR ALL USING (true) WITH CHECK (true);
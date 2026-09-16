ALTER TABLE public.outlook_messages
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

CREATE INDEX IF NOT EXISTS outlook_messages_pinned_at_idx
  ON public.outlook_messages (pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

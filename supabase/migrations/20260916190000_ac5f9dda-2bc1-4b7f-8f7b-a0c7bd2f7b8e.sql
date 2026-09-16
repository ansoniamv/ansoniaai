-- Clean up orphaned chat turns left by the old handler.
--
-- chat/index.ts used to insert the user's message BEFORE calling the model, so
-- every failed call (and the Lovable gateway failed on every call once it went
-- away) stranded a user message with no reply. The handler now writes nothing
-- until an answer exists; this removes the damage already in the table.
--
-- "Orphaned" means: a user row with no assistant row later in the same thread.
-- Ordering is by created_at with id as the tiebreaker, matching the order the
-- UI reads messages in.

DELETE FROM public.chat_messages u
WHERE u.role = 'user'
  AND NOT EXISTS (
    SELECT 1
    FROM public.chat_messages a
    WHERE a.thread_id = u.thread_id
      AND a.role = 'assistant'
      AND (a.created_at, a.id) > (u.created_at, u.id)
  );

-- Threads that held nothing but those orphans are now empty; drop them so the
-- sidebar does not list conversations with no content.
DELETE FROM public.chat_threads t
WHERE NOT EXISTS (
  SELECT 1 FROM public.chat_messages m WHERE m.thread_id = t.id
);

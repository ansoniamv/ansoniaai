ALTER PUBLICATION supabase_realtime ADD TABLE public.inbox_deals;
ALTER TABLE public.inbox_deals REPLICA IDENTITY FULL;
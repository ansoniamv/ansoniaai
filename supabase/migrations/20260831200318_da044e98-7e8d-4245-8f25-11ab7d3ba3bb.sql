GRANT SELECT, INSERT, UPDATE, DELETE ON public.deals TO authenticated;
NOTIFY pgrst, 'reload schema';
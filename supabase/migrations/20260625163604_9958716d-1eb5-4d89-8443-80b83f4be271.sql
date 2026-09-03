ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

UPDATE public.team_members SET sort_order = 1 WHERE full_name = 'Daniel Stevens';
UPDATE public.team_members SET sort_order = 2 WHERE full_name = 'Phillip Vdovets';
UPDATE public.team_members SET sort_order = 3 WHERE full_name = 'Chase Kaplan';
UPDATE public.team_members SET sort_order = 4 WHERE full_name = 'Maxym Vasylechko';
-- ============================================================================
-- Allow self-service signup, restricted to @ansoniaproperties.com.
--
-- Enforcement lives HERE, in the trigger, not in the UI. AuthPage validates the
-- domain too, but that is only for a fast error message — anyone can POST
-- straight to /auth/v1/signup with the publishable key, so a client-side check
-- is decoration. Raising in this trigger aborts the auth.users insert itself,
-- so a non-company address cannot create an account by any route.
--
-- Company addresses are auto-approved rather than left pending, because email
-- confirmation is required (mailer_autoconfirm is off): the person must control
-- the @ansoniaproperties.com inbox to complete signup, which is the same proof
-- an admin would be checking for. To switch back to manual approval instead,
-- change the status expression below to 'pending' and approvals happen in
-- /admin/users as before.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email        text := LOWER(COALESCE(NEW.email, ''));
  _is_company   BOOLEAN;
  _is_seed_admin BOOLEAN;
BEGIN
  _is_company    := _email LIKE '%@ansoniaproperties.com';
  _is_seed_admin := _email = 'dstevens@ansoniaproperties.com';

  -- Hard gate: only company addresses may hold an account at all.
  IF NOT _is_company THEN
    RAISE EXCEPTION 'Accounts are limited to @ansoniaproperties.com email addresses.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, status, approved_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    'approved'::public.profile_status,
    now()
  );

  IF _is_seed_admin THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Defence in depth: even if the trigger were replaced or dropped by a future
-- migration, a non-company profile row cannot exist.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_company_email_only;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_company_email_only
  CHECK (LOWER(email) LIKE '%@ansoniaproperties.com') NOT VALID;

-- NOT VALID so the constraint applies to new/updated rows without re-checking
-- history; every existing row already satisfies it, validated here explicitly.
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_company_email_only;

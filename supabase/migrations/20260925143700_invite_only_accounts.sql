-- ============================================================================
-- Invite-only accounts. Supersedes the self-service signup of 20260909210000.
--
-- Accounts are now created only by an admin through the admin-invite-user edge
-- function, which approves the profile once the invite is sent. Public signup is
-- switched off in Supabase Auth settings ("Allow new users to sign up"), which
-- blocks POST /auth/v1/signup while leaving admin invites working.
--
-- This trigger is the safety net for when that setting is ever flipped back on,
-- or a user is added by hand in the dashboard: any auth user the invite function
-- did not approve is created 'pending', and a pending profile fails is_approved()
-- and so every data policy. An admin can still approve them in /admin/users.
--
-- The company-domain gate and the profiles_company_email_only constraint from
-- 20260909210000 are unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email         text := LOWER(COALESCE(NEW.email, ''));
  _is_seed_admin BOOLEAN := _email = 'dstevens@ansoniaproperties.com';
BEGIN
  -- Hard gate: only company addresses may hold an account at all.
  IF _email NOT LIKE '%@ansoniaproperties.com' THEN
    RAISE EXCEPTION 'Accounts are limited to @ansoniaproperties.com email addresses.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, status, approved_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    CASE WHEN _is_seed_admin THEN 'approved' ELSE 'pending' END::public.profile_status,
    CASE WHEN _is_seed_admin THEN now() END
  );

  IF _is_seed_admin THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

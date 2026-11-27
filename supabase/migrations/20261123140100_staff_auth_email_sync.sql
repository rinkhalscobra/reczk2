-- Staff sign in with their Auth email. Keep all displayed staff addresses in
-- sync atomically with Auth, including changes made in the Supabase dashboard.
-- Client contact emails remain separate from their internal login identities.
CREATE OR REPLACE FUNCTION public.sync_auth_login_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE previous_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  -- GoTrue database transactions do not carry PostgREST JWT claims. This
  -- revoked trigger function is the trusted bridge from Auth to protected CRM
  -- fields; restore the claim immediately after its internal profile update.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.profiles profile
  SET login_email = NEW.email,
      email = CASE WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role IN ('admin','group_admin','supervisor','agent'))
        THEN NEW.email ELSE profile.email END,
      display_email = CASE WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role IN ('admin','group_admin','supervisor','agent'))
        THEN NEW.email ELSE profile.display_email END
  WHERE profile.id = NEW.id;
  PERFORM set_config('request.jwt.claim.role', coalesce(previous_role, ''), true);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_auth_login_email() FROM PUBLIC, anon, authenticated;

-- Repair existing staff profiles whose displayed address drifted from Auth.
DO $$
DECLARE previous_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.profiles profile
  SET email = account.email, display_email = account.email, login_email = account.email
  FROM auth.users account
  WHERE account.id = profile.id
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = profile.id AND role IN ('admin','group_admin','supervisor','agent'))
    AND (profile.email IS DISTINCT FROM account.email OR profile.display_email IS DISTINCT FROM account.email
      OR profile.login_email IS DISTINCT FROM account.email);
  PERFORM set_config('request.jwt.claim.role', coalesce(previous_role, ''), true);
END;
$$;

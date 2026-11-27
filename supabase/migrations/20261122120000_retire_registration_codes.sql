-- Registration creates clients with case numbers. Assignments and staff roles
-- are managed through the CRM, never through public signup metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_email, first_name, last_name, platform)
  VALUES (NEW.id, NEW.email, coalesce(NEW.raw_user_meta_data->>'display_email', NEW.email),
    NEW.raw_user_meta_data->>'first_name', NEW.raw_user_meta_data->>'last_name', 'brightfund');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Keep historical records while disabling the retired feature for all website
-- roles. Existing clients, staff roles, groups, and agent assignments are intact.
DROP TRIGGER IF EXISTS ensure_agent_signup_code_trg ON public.user_roles;
REVOKE ALL ON public.promocodes, public.agent_signup_codes FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_promocode(p_code text)
RETURNS TABLE (is_valid boolean, message text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT false, 'Registration codes are no longer supported'::text;
$$;
REVOKE ALL ON FUNCTION public.validate_promocode(text) FROM PUBLIC, anon, authenticated;

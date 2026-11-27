-- Cases identify clients. Staff accounts retain email/password access.
ALTER TABLE public.profiles ALTER COLUMN case_number DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.set_profile_case_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_requested text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = NEW.id AND role IN ('admin', 'group_admin', 'supervisor', 'agent')
  ) THEN
    NEW.case_number := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT raw_user_meta_data->>'case_number' INTO v_requested FROM auth.users WHERE id = NEW.id;
  END IF;
  NEW.case_number := upper(btrim(coalesce(
    nullif(btrim(NEW.case_number), ''), nullif(btrim(v_requested), ''), public.allocate_client_case_number()
  )));
  RETURN NEW;
END;
$$;

-- Profile creation precedes role assignment. Keep the final case value correct
-- for staff creation, invitations, promotions and demotions using trusted roles.
CREATE FUNCTION public.sync_role_case_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE public.profiles SET case_number = case_number
    WHERE id = OLD.user_id AND EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE public.profiles SET case_number = case_number
    WHERE id = NEW.user_id AND EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.user_id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_role_case_number() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER sync_role_case_number
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.sync_role_case_number();

UPDATE public.profiles profile SET case_number = NULL
WHERE EXISTS (
  SELECT 1 FROM public.user_roles role_row
  WHERE role_row.user_id = profile.id AND role_row.role IN ('admin', 'group_admin', 'supervisor', 'agent')
);

-- Resolve staff by their real contact address, including clients promoted to
-- staff whose Auth identity was previously derived from a client case.
CREATE FUNCTION public.get_staff_login_account(p_email text)
RETURNS TABLE (id uuid, login_email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT profile.id, profile.login_email
  FROM public.profiles profile
  JOIN public.user_roles role_row ON role_row.user_id = profile.id
  WHERE lower(btrim(profile.email)) = lower(btrim(p_email))
    AND role_row.role IN ('admin', 'group_admin', 'supervisor', 'agent')
  ORDER BY profile.id
  LIMIT 2;
$$;
REVOKE ALL ON FUNCTION public.get_staff_login_account(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_staff_login_account(text) TO service_role;

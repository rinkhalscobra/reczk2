-- Contact addresses may be shared. Each profile still belongs to one Auth user.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS login_email text;

UPDATE public.profiles profile
SET login_email = account.email
FROM auth.users account
WHERE account.id = profile.id;

CREATE INDEX IF NOT EXISTS profiles_login_email_idx ON public.profiles (login_email);

-- Derive login identities from Auth, never from editable profile or user metadata.
CREATE OR REPLACE FUNCTION public.set_profile_login_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  SELECT email INTO NEW.login_email FROM auth.users WHERE id = NEW.id;
  IF TG_OP = 'INSERT' THEN
    NEW.email := lower(btrim(coalesce(nullif(NEW.display_email, ''), NEW.login_email)));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_profile_login_email
BEFORE INSERT OR UPDATE OF login_email ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_profile_login_email();

CREATE OR REPLACE FUNCTION public.sync_auth_login_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles SET login_email = NEW.email WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_auth_login_email
AFTER UPDATE OF email ON auth.users
FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION public.sync_auth_login_email();

REVOKE ALL ON FUNCTION public.set_profile_login_email() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_auth_login_email() FROM PUBLIC, anon, authenticated;

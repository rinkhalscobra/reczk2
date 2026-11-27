-- A contact email may have multiple accounts, with one account per case number.
CREATE SEQUENCE public.client_case_number_seq;

CREATE FUNCTION public.allocate_client_case_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_case text;
BEGIN
  LOOP
    v_case := 'CX-' || lpad(nextval('public.client_case_number_seq'::regclass)::text, 8, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE upper(btrim(case_number)) = v_case);
  END LOOP;
  RETURN v_case;
END;
$$;
REVOKE ALL ON SEQUENCE public.client_case_number_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_client_case_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_client_case_number() TO service_role;

-- Preserve valid existing case numbers. Fill gaps and separate legacy duplicate
-- email/case pairs before installing the constraint; never merge their records.
DO $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.profiles
    WHERE case_number IS NULL OR btrim(case_number) = '' OR length(btrim(case_number)) > 100 OR case_number ~ '[[:cntrl:]]'
    ORDER BY created_at, id
  LOOP
    UPDATE public.profiles SET case_number = public.allocate_client_case_number() WHERE id = v_id;
  END LOOP;

  UPDATE public.profiles SET case_number = upper(btrim(case_number));
  FOR v_id IN
    SELECT id FROM (
      SELECT id, row_number() OVER (PARTITION BY lower(btrim(email)), case_number ORDER BY created_at, id) AS position
      FROM public.profiles WHERE email IS NOT NULL
    ) duplicates WHERE position > 1
  LOOP
    UPDATE public.profiles SET case_number = public.allocate_client_case_number() WHERE id = v_id;
  END LOOP;
END;
$$;

CREATE FUNCTION public.set_profile_case_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_requested text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT raw_user_meta_data->>'case_number' INTO v_requested FROM auth.users WHERE id = NEW.id;
    NEW.case_number := upper(btrim(coalesce(nullif(NEW.case_number, ''), nullif(v_requested, ''), public.allocate_client_case_number())));
  ELSE
    NEW.case_number := upper(btrim(NEW.case_number));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_profile_case_number() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER set_profile_case_number BEFORE INSERT OR UPDATE OF case_number ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_profile_case_number();

ALTER TABLE public.profiles ALTER COLUMN case_number SET NOT NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_case_number_valid
  CHECK (length(case_number) BETWEEN 1 AND 100 AND case_number = upper(btrim(case_number)) AND case_number !~ '[[:cntrl:]]');
CREATE UNIQUE INDEX profiles_email_case_number_idx ON public.profiles (lower(btrim(email)), case_number);

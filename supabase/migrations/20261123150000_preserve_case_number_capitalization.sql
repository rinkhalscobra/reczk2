-- Preserve the user's capitalization. Existing identifiers stay unchanged;
-- uniqueness and client sign-in remain case-insensitive.
ALTER TABLE public.profiles DROP CONSTRAINT profiles_case_number_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_case_number_valid
  CHECK (length(case_number) BETWEEN 1 AND 100 AND case_number = btrim(case_number) AND case_number !~ '[[:cntrl:]]');
DROP INDEX public.profiles_email_case_number_idx;
CREATE UNIQUE INDEX profiles_email_case_number_idx
  ON public.profiles (lower(btrim(email)), upper(btrim(case_number)));

ALTER TABLE public.agent_signup_codes DROP CONSTRAINT agent_case_code_format;
ALTER TABLE public.agent_signup_codes ADD CONSTRAINT agent_case_code_format
  CHECK (length(code) BETWEEN 1 AND 100 AND code = btrim(code) AND code !~ '[[:cntrl:]]');
CREATE UNIQUE INDEX agent_case_code_case_insensitive_idx ON public.agent_signup_codes (upper(code));

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
  NEW.case_number := btrim(coalesce(
    nullif(btrim(NEW.case_number), ''), nullif(btrim(v_requested), ''), public.allocate_client_case_number()
  ));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_profile_case_number() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_agent_case_code(p_agent_id uuid, p_case_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_code text := btrim(p_case_code);
BEGIN
  PERFORM 1 FROM public.profiles agent JOIN public.user_roles role_row ON role_row.user_id = agent.id
    WHERE agent.id = p_agent_id AND NOT agent.is_archived AND role_row.role = 'agent'
    FOR UPDATE OF agent, role_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent not found'; END IF;
  IF NOT (coalesce(auth.role() = 'service_role', false) OR (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','group_admin','supervisor'))
    AND public.can_manage_account(auth.uid(), p_agent_id)
  )) THEN RAISE EXCEPTION 'Agent is outside your permitted scope' USING ERRCODE = '42501'; END IF;
  IF v_code IS NULL OR length(v_code) NOT BETWEEN 1 AND 100 OR v_code ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Agent case number must contain 1 to 100 characters without control characters';
  END IF;
  INSERT INTO public.agent_signup_codes(agent_id, code) VALUES (p_agent_id, v_code)
    ON CONFLICT (agent_id) DO UPDATE SET code = EXCLUDED.code;
  RETURN v_code;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Agent case number is already in use' USING ERRCODE = '23505';
END;
$$;
REVOKE ALL ON FUNCTION public.set_agent_case_code(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_agent_case_code(uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_client_case_number(p_customer_id uuid, p_case_number text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_case text := btrim(p_case_number); v_saved text;
BEGIN
  IF NOT public.can_manage_customer(auth.uid(), p_customer_id) THEN
    RAISE EXCEPTION 'Client is outside your permitted scope' USING ERRCODE = '42501';
  END IF;
  IF v_case IS NULL OR length(v_case) NOT BETWEEN 1 AND 100 OR v_case ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Case number must contain 1 to 100 characters without control characters';
  END IF;
  UPDATE public.profiles SET case_number = v_case
    WHERE id = p_customer_id AND NOT is_archived AND public.can_manage_customer(auth.uid(), id)
    RETURNING case_number INTO v_saved;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client is outside your permitted scope' USING ERRCODE = '42501'; END IF;
  RETURN v_saved;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This email and case number are already registered' USING ERRCODE = '23505';
END;
$$;
REVOKE ALL ON FUNCTION public.set_client_case_number(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_case_number(uuid,text) TO authenticated;

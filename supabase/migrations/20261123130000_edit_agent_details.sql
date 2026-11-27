-- Agent case identifiers are editable CRM identifiers, separate from client login cases.
ALTER TABLE public.agent_signup_codes DROP CONSTRAINT IF EXISTS agent_signup_codes_code_check;
ALTER TABLE public.agent_signup_codes ADD CONSTRAINT agent_case_code_format
  CHECK (length(code) BETWEEN 1 AND 100 AND code = upper(btrim(code)) AND code !~ '[[:cntrl:]]');

CREATE FUNCTION public.set_agent_case_code(p_agent_id uuid, p_case_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_code text := upper(btrim(p_case_code));
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

CREATE FUNCTION public.update_managed_agent(
  p_agent_id uuid, p_first_name text, p_last_name text, p_username text,
  p_group_id uuid, p_supervisor_id uuid, p_case_code text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_agent public.profiles%ROWTYPE;
BEGIN
  SELECT agent.* INTO v_agent FROM public.profiles agent
    JOIN public.user_roles role_row ON role_row.user_id = agent.id AND role_row.role = 'agent'
    WHERE agent.id = p_agent_id AND NOT agent.is_archived FOR UPDATE OF agent, role_row;
  IF NOT FOUND OR NOT public.can_manage_account(auth.uid(), p_agent_id)
    OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','group_admin','supervisor')) THEN
    RAISE EXCEPTION 'Agent is outside your permitted scope' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS DISTINCT FROM v_agent.group_id AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Only Superior Admin can move an agent to another group' USING ERRCODE = '42501';
  END IF;
  IF public.has_role(auth.uid(),'supervisor') AND p_supervisor_id IS DISTINCT FROM v_agent.supervisor_id THEN
    RAISE EXCEPTION 'Only Superior or Group Admin can assign supervisors' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.groups WHERE id = p_group_id AND platform = v_agent.platform) THEN
    RAISE EXCEPTION 'Choose a group on the same platform';
  END IF;
  -- This transaction rolls back the code and every profile/assignment change on any failure.
  PERFORM public.set_agent_case_code(p_agent_id, p_case_code);
  UPDATE public.profiles SET first_name = nullif(btrim(p_first_name), ''), last_name = nullif(btrim(p_last_name), ''),
    username = nullif(btrim(p_username), ''), group_id = p_group_id, supervisor_id = p_supervisor_id
    WHERE id = p_agent_id;
END;
$$;
REVOKE ALL ON FUNCTION public.update_managed_agent(uuid,text,text,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_managed_agent(uuid,text,text,text,uuid,uuid,text) TO authenticated;

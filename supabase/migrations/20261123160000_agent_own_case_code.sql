-- Agents may read their own assigned identifier. Manager access retains the
-- existing office/supervisor scope; the underlying table stays private.
CREATE OR REPLACE FUNCTION public.get_agent_case_codes(p_agent_ids uuid[])
RETURNS TABLE (agent_id uuid, case_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT code.agent_id, code.code
  FROM public.agent_signup_codes code
  JOIN public.profiles agent ON agent.id = code.agent_id
  JOIN public.user_roles agent_role ON agent_role.user_id = agent.id AND agent_role.role = 'agent'
  WHERE code.agent_id = ANY(p_agent_ids) AND agent.is_archived = false
    AND EXISTS (SELECT 1 FROM public.user_roles actor_role
      WHERE actor_role.user_id = auth.uid() AND (
        actor_role.role IN ('admin', 'group_admin', 'supervisor')
        OR (actor_role.role = 'agent' AND code.agent_id = auth.uid())
      ))
    AND public.can_access_account(auth.uid(), agent.id);
$$;
REVOKE ALL ON FUNCTION public.get_agent_case_codes(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_case_codes(uuid[]) TO authenticated;

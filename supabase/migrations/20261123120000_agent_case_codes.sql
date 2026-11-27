-- Persistent agent identifiers. Historical AGT values remain unchanged;
-- identifiers cannot be redeemed during public registration.
CREATE FUNCTION public.ensure_agent_case_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.role = 'agent'::public.app_role THEN
    INSERT INTO public.agent_signup_codes (agent_id) VALUES (NEW.user_id)
    ON CONFLICT (agent_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_agent_case_code() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ensure_agent_case_code_trg
AFTER INSERT OR UPDATE OF role ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.ensure_agent_case_code();

INSERT INTO public.agent_signup_codes (agent_id)
SELECT user_id FROM public.user_roles WHERE role = 'agent'::public.app_role
ON CONFLICT (agent_id) DO NOTHING;

-- The table remains inaccessible to browser roles. This read-only endpoint
-- binds authorization to the caller and the existing group/supervisor subtree.
CREATE FUNCTION public.get_agent_case_codes(p_agent_ids uuid[])
RETURNS TABLE (agent_id uuid, case_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT code.agent_id, code.code
  FROM public.agent_signup_codes code
  JOIN public.profiles agent ON agent.id = code.agent_id
  JOIN public.user_roles agent_role ON agent_role.user_id = agent.id AND agent_role.role = 'agent'
  WHERE code.agent_id = ANY(p_agent_ids) AND agent.is_archived = false
    AND EXISTS (SELECT 1 FROM public.user_roles actor_role
      WHERE actor_role.user_id = auth.uid() AND actor_role.role IN ('admin', 'group_admin', 'supervisor'))
    AND public.can_access_account(auth.uid(), agent.id);
$$;
REVOKE ALL ON FUNCTION public.get_agent_case_codes(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_case_codes(uuid[]) TO authenticated;

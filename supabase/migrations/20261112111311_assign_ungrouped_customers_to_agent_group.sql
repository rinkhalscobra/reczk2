-- Public signup creates clients outside a CRM group. Their first assignment
-- by an administrator must establish the group as well as the agent.
CREATE OR REPLACE FUNCTION public.validate_profile_agent_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_group uuid;
  v_agent_platform text;
BEGIN
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT agent.group_id, agent.platform
  INTO v_agent_group, v_agent_platform
  FROM public.profiles agent
  JOIN public.user_roles role_row
    ON role_row.user_id = agent.id
   AND role_row.role = 'agent'::public.app_role
  WHERE agent.id = NEW.assigned_to;

  IF NOT FOUND OR v_agent_platform IS DISTINCT FROM NEW.platform THEN
    RAISE EXCEPTION 'Customers can only be assigned to an agent in the same group and platform' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.group_id IS NULL
     AND NEW.group_id IS NULL
     AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND v_agent_group IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles WHERE user_id = NEW.id
     )
     AND (
       auth.role() = 'service_role'
       OR public.has_role(auth.uid(), 'admin'::public.app_role)
     ) THEN
    NEW.group_id := v_agent_group;
  END IF;

  IF v_agent_group IS DISTINCT FROM NEW.group_id THEN
    RAISE EXCEPTION 'Customers can only be assigned to an agent in the same group and platform' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

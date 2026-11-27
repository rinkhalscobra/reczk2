-- Administrators can place clients in a CRM group independently of assignment.
-- Keep the current agent only when they remain valid in the destination group.
CREATE OR REPLACE FUNCTION public.set_customer_group(
  p_customer_id uuid,
  p_group_id uuid
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer public.profiles%ROWTYPE;
  v_group_platform text;
  v_assigned_to uuid;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only administrators can move customers between groups' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_customer
  FROM public.profiles
  WHERE id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer was not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_customer_id) THEN
    RAISE EXCEPTION 'Only client accounts can be moved with this action' USING ERRCODE = '42501';
  END IF;

  IF p_group_id IS NOT NULL THEN
    SELECT platform INTO v_group_platform
    FROM public.groups
    WHERE id = p_group_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected group does not exist' USING ERRCODE = 'P0002';
    END IF;
    IF v_group_platform IS DISTINCT FROM v_customer.platform THEN
      RAISE EXCEPTION 'Customers can only be moved to a group on the same platform' USING ERRCODE = '23514';
    END IF;

    SELECT agent.id INTO v_assigned_to
    FROM public.profiles agent
    JOIN public.user_roles role_row
      ON role_row.user_id = agent.id AND role_row.role = 'agent'::public.app_role
    WHERE agent.id = v_customer.assigned_to
      AND agent.group_id = p_group_id
      AND agent.platform IS NOT DISTINCT FROM v_customer.platform;
  END IF;

  UPDATE public.profiles
  SET group_id = p_group_id,
      assigned_to = v_assigned_to
  WHERE id = p_customer_id
  RETURNING * INTO v_customer;

  RETURN v_customer;
END;
$$;

REVOKE ALL ON FUNCTION public.set_customer_group(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_customer_group(uuid, uuid) TO authenticated;

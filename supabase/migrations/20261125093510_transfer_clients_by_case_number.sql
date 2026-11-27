-- An explicit client case edit selects its active agent. Keep this in the
-- profile trigger so the case editor and full profile editor behave identically.
CREATE OR REPLACE FUNCTION public.set_profile_case_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_requested text; v_code text; v_destination record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role IN ('admin','group_admin','supervisor','agent')) THEN
    NEW.case_number := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.case_number IS DISTINCT FROM OLD.case_number
     AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to
     AND NEW.group_id IS NOT DISTINCT FROM OLD.group_id
     AND NEW.platform IS NOT DISTINCT FROM OLD.platform THEN
    SELECT agent.id, code.code, agent.group_id, agent.platform INTO v_destination
    FROM public.agent_signup_codes code
    JOIN public.profiles agent ON agent.id = code.agent_id
    JOIN public.user_roles role_row ON role_row.user_id = agent.id AND role_row.role = 'agent'
    JOIN public.groups office ON office.id = agent.group_id AND office.platform = agent.platform
    WHERE upper(code.code) = upper(btrim(NEW.case_number))
      AND code.is_active AND agent.status = 'active' AND NOT agent.is_archived
    FOR SHARE OF code, agent, role_row, office;

    IF FOUND THEN
      IF NEW.is_archived THEN
        RAISE EXCEPTION 'Restore this client before changing their agent case number' USING ERRCODE = '22023';
      END IF;
      IF v_destination.platform IS DISTINCT FROM NEW.platform THEN
        RAISE EXCEPTION 'Choose an agent on the same platform as the client' USING ERRCODE = '42501';
      END IF;
      -- This trigger runs after the generic profile protection trigger. Check
      -- every assignment it introduces, including writes through profile PATCH.
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        IF NOT public.can_manage_customer(auth.uid(), OLD.id) THEN
          RAISE EXCEPTION 'Client is outside your permitted scope' USING ERRCODE = '42501';
        END IF;
        IF v_destination.id IS DISTINCT FROM OLD.assigned_to
           OR v_destination.group_id IS DISTINCT FROM OLD.group_id THEN
          IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','group_admin','supervisor'))
             OR NOT public.can_manage_account(auth.uid(), v_destination.id) THEN
            RAISE EXCEPTION 'Agent is outside your permitted scope for client transfers' USING ERRCODE = '42501';
          END IF;
        END IF;
      END IF;
      NEW.assigned_to := v_destination.id;
      NEW.group_id := v_destination.group_id;
      NEW.case_number := v_destination.code;
      RETURN NEW;
    END IF;

    IF EXISTS (SELECT 1 FROM public.agent_signup_codes WHERE upper(code) = upper(btrim(NEW.case_number))) THEN
      RAISE EXCEPTION 'This case number belongs to an inactive or unavailable agent' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.active_agent_case(NEW.assigned_to)) THEN
      RAISE EXCEPTION 'Enter an active agent case number to transfer this client, or change the current agent case number' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT active.case_code INTO v_code FROM public.active_agent_case(NEW.assigned_to) active
    WHERE active.group_id = NEW.group_id AND active.platform = NEW.platform;
  IF v_code IS NOT NULL THEN
    NEW.case_number := v_code;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT raw_user_meta_data->>'case_number' INTO v_requested FROM auth.users WHERE id = NEW.id;
  END IF;
  NEW.case_number := btrim(coalesce(nullif(btrim(NEW.case_number), ''), nullif(btrim(v_requested), ''), public.allocate_client_case_number()));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_profile_case_number() FROM PUBLIC, anon, authenticated;

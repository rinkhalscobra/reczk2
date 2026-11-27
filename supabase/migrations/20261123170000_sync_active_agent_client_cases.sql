-- An active agent's case code is authoritative for its linked clients. Updating
-- profiles also publishes the change to signed-in clients through Realtime.
CREATE FUNCTION public.active_agent_case(p_agent_id uuid)
RETURNS TABLE (agent_id uuid, case_code text, group_id uuid, platform text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT agent.id, code.code, agent.group_id, agent.platform
  FROM public.agent_signup_codes code
  JOIN public.profiles agent ON agent.id = code.agent_id
  JOIN public.user_roles role_row ON role_row.user_id = agent.id AND role_row.role = 'agent'
  JOIN public.groups office ON office.id = agent.group_id AND office.platform = agent.platform
  WHERE agent.id = p_agent_id AND code.is_active AND agent.status = 'active' AND NOT agent.is_archived;
$$;
REVOKE ALL ON FUNCTION public.active_agent_case(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_profile_case_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_requested text; v_code text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role IN ('admin','group_admin','supervisor','agent')) THEN
    NEW.case_number := NULL;
    RETURN NEW;
  END IF;
  SELECT active.case_code INTO v_code FROM public.active_agent_case(NEW.assigned_to) active
    WHERE active.group_id = NEW.group_id AND active.platform = NEW.platform;
  IF v_code IS NOT NULL THEN
    IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to
       AND NEW.case_number IS DISTINCT FROM OLD.case_number AND NEW.case_number IS DISTINCT FROM v_code THEN
      RAISE EXCEPTION 'Change the case number on the active agent to update this client' USING ERRCODE = '22023';
    END IF;
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
DROP TRIGGER set_profile_case_number ON public.profiles;
CREATE TRIGGER set_profile_case_number
BEFORE INSERT OR UPDATE OF case_number, assigned_to, group_id, platform ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_profile_case_number();

-- Signup accepts the case number as the link to an active agent. Neither office,
-- platform, role nor agent identity is trusted from public user metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_case text := nullif(btrim(NEW.raw_user_meta_data->>'case_number'), '');
  v_agent uuid; v_group uuid; v_platform text := 'brightfund'; v_code text;
BEGIN
  SELECT agent.id, agent.group_id, agent.platform, code.code INTO v_agent, v_group, v_platform, v_code
  FROM public.agent_signup_codes code
  JOIN public.profiles agent ON agent.id = code.agent_id
  JOIN public.user_roles role_row ON role_row.user_id = agent.id AND role_row.role = 'agent'
  JOIN public.groups office ON office.id = agent.group_id AND office.platform = agent.platform
  WHERE upper(code.code) = upper(v_case) AND code.is_active AND agent.status = 'active' AND NOT agent.is_archived
  FOR SHARE OF code, agent, role_row, office;
  INSERT INTO public.profiles (id, email, display_email, first_name, last_name, platform, group_id, assigned_to, case_number)
  VALUES (NEW.id, NEW.email, coalesce(NEW.raw_user_meta_data->>'display_email', NEW.email),
    NEW.raw_user_meta_data->>'first_name', NEW.raw_user_meta_data->>'last_name', coalesce(v_platform, 'brightfund'), v_group, v_agent, coalesce(v_code, v_case));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.sync_agent_case_clients(p_agent_id uuid, p_previous_code text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE active record; previous_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  SELECT * INTO active FROM public.active_agent_case(p_agent_id);
  IF NOT FOUND THEN RETURN; END IF;
  -- Only this private, trusted operation may update protected assignment fields.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.profiles client
  SET assigned_to = active.agent_id, group_id = active.group_id, case_number = active.case_code
  WHERE NOT client.is_archived AND client.platform = active.platform
    AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = client.id)
    AND (
      (client.assigned_to = active.agent_id AND client.group_id = active.group_id)
      OR (client.assigned_to IS NULL AND (client.group_id IS NULL OR client.group_id = active.group_id)
        AND (upper(client.case_number) = upper(active.case_code) OR upper(client.case_number) = upper(p_previous_code)))
    )
    AND (client.assigned_to IS DISTINCT FROM active.agent_id OR client.group_id IS DISTINCT FROM active.group_id
      OR client.case_number IS DISTINCT FROM active.case_code);
  PERFORM set_config('request.jwt.claim.role', coalesce(previous_role, ''), true);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This agent case number would create duplicate client sign-ins for the same email. Resolve duplicate client accounts first.' USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION public.sync_agent_case_clients(uuid,text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.sync_agent_case_code_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.sync_agent_case_clients(NEW.agent_id,
    CASE WHEN TG_OP = 'UPDATE' AND OLD.is_active THEN OLD.code ELSE NULL END);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_agent_case_code_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER sync_agent_case_code_change AFTER INSERT OR UPDATE OF code, is_active ON public.agent_signup_codes
FOR EACH ROW EXECUTE FUNCTION public.sync_agent_case_code_change();

CREATE FUNCTION public.sync_active_agent_case_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.sync_agent_case_clients(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_active_agent_case_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER sync_active_agent_case_change AFTER UPDATE OF status, is_archived, group_id, platform ON public.profiles
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.is_archived IS DISTINCT FROM NEW.is_archived
  OR OLD.group_id IS DISTINCT FROM NEW.group_id OR OLD.platform IS DISTINCT FROM NEW.platform)
EXECUTE FUNCTION public.sync_active_agent_case_change();

-- Connect earlier unassigned registrations using their matching active code;
-- never move clients already owned by another agent or another office/platform.
DO $$
DECLARE agent record;
BEGIN
  FOR agent IN SELECT agent_id FROM public.agent_signup_codes LOOP
    PERFORM public.sync_agent_case_clients(agent.agent_id);
  END LOOP;
END;
$$;

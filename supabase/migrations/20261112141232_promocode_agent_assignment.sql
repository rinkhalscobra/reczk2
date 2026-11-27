-- Custom customer promocodes can assign an agent, independently of choosing a group.
ALTER TABLE public.promocodes
  ALTER COLUMN group_id DROP NOT NULL,
  ADD COLUMN agent_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT promocodes_assignment_target CHECK (group_id IS NOT NULL OR agent_id IS NOT NULL),
  ADD CONSTRAINT promocodes_agent_customer_only CHECK (agent_id IS NULL OR role_type = 'user'::public.app_role);

CREATE INDEX promocodes_agent_id_idx ON public.promocodes (agent_id) WHERE agent_id IS NOT NULL;

CREATE FUNCTION public.validate_promocode_agent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent_group uuid;
BEGIN
  IF NEW.agent_id IS NULL THEN RETURN NEW; END IF;
  SELECT agent.group_id INTO v_agent_group
  FROM public.profiles agent
  JOIN public.user_roles role_row ON role_row.user_id = agent.id AND role_row.role = 'agent'::public.app_role
  WHERE agent.id = NEW.agent_id AND agent.status = 'active'::public.user_status AND NOT agent.is_archived
  FOR SHARE OF agent, role_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active agent' USING ERRCODE = '23514'; END IF;

  -- Administrators may select any agent. Other group staff retain their scope.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    IF NOT (public.has_role(auth.uid(), 'group_admin'::public.app_role) OR public.has_role(auth.uid(), 'supervisor'::public.app_role))
       OR v_agent_group IS NULL OR v_agent_group IS DISTINCT FROM public.get_user_group(auth.uid()) THEN
      RAISE EXCEPTION 'You may only create agent promocodes for your own group' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.group_id := v_agent_group;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_promocode_agent() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER validate_promocode_agent_trg
BEFORE INSERT OR UPDATE OF agent_id, group_id, role_type ON public.promocodes
FOR EACH ROW EXECUTE FUNCTION public.validate_promocode_agent();

CREATE OR REPLACE FUNCTION public.validate_promocode(p_code text)
RETURNS TABLE (is_valid boolean, message text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_code text := upper(trim(p_code));
  v_promo public.promocodes%ROWTYPE;
BEGIN
  IF v_code LIKE 'AGT-%' THEN
    IF EXISTS (
      SELECT 1 FROM public.agent_signup_codes signup_code
      JOIN public.profiles agent ON agent.id = signup_code.agent_id
      JOIN public.user_roles role_row ON role_row.user_id = agent.id AND role_row.role = 'agent'::public.app_role
      WHERE signup_code.code = v_code AND signup_code.is_active
        AND agent.status = 'active'::public.user_status AND NOT agent.is_archived
    ) THEN
      RETURN QUERY SELECT true, 'Valid promotional code'::text;
    ELSE
      RETURN QUERY SELECT false, 'The promotional code is invalid or its agent is unavailable'::text;
    END IF;
    RETURN;
  END IF;

  SELECT * INTO v_promo FROM public.promocodes WHERE code = v_code;
  IF NOT FOUND OR NOT coalesce(v_promo.is_active, false) THEN
    RETURN QUERY SELECT false, 'The promocode is invalid or inactive'::text;
  ELSIF v_promo.expires_at IS NOT NULL AND v_promo.expires_at <= now() THEN
    RETURN QUERY SELECT false, 'The promocode has expired'::text;
  ELSIF v_promo.usage_limit IS NOT NULL AND coalesce(v_promo.times_used, 0) >= v_promo.usage_limit THEN
    RETURN QUERY SELECT false, 'The promocode usage limit has been reached'::text;
  ELSIF v_promo.role_type NOT IN ('user'::public.app_role, 'agent'::public.app_role, 'supervisor'::public.app_role) THEN
    RETURN QUERY SELECT false, 'The promocode contains a forbidden role'::text;
  ELSIF v_promo.agent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles agent
    JOIN public.user_roles role_row ON role_row.user_id = agent.id AND role_row.role = 'agent'::public.app_role
    WHERE agent.id = v_promo.agent_id AND agent.status = 'active'::public.user_status AND NOT agent.is_archived
  ) THEN
    RETURN QUERY SELECT false, 'The promotional code agent is unavailable'::text;
  ELSE
    RETURN QUERY SELECT true, 'Valid promocode'::text;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_code text := upper(trim(coalesce(NEW.raw_user_meta_data->>'promocode', '')));
  v_promo public.promocodes%ROWTYPE;
  v_group_id uuid;
  v_assigned_to uuid;
  v_platform text := 'brightfund';
BEGIN
  IF v_code LIKE 'AGT-%' THEN
    SELECT agent.id, agent.group_id, agent.platform INTO v_assigned_to, v_group_id, v_platform
    FROM public.agent_signup_codes signup_code
    JOIN public.profiles agent ON agent.id = signup_code.agent_id
    JOIN public.user_roles role_row ON role_row.user_id = agent.id AND role_row.role = 'agent'::public.app_role
    WHERE signup_code.code = v_code AND signup_code.is_active
      AND agent.status = 'active'::public.user_status AND NOT agent.is_archived
    FOR SHARE OF signup_code, agent, role_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The promotional code is invalid or its agent is unavailable' USING ERRCODE = '22023';
    END IF;
  ELSIF v_code <> '' THEN
    -- Lock the code through account creation to enforce usage limits atomically.
    SELECT * INTO v_promo FROM public.promocodes WHERE code = v_code FOR UPDATE;
    IF NOT FOUND OR NOT coalesce(v_promo.is_active, false)
       OR (v_promo.expires_at IS NOT NULL AND v_promo.expires_at <= now())
       OR (v_promo.usage_limit IS NOT NULL AND coalesce(v_promo.times_used, 0) >= v_promo.usage_limit)
       OR v_promo.role_type NOT IN ('user'::public.app_role, 'agent'::public.app_role, 'supervisor'::public.app_role) THEN
      RAISE EXCEPTION 'Invalid, expired, or fully used promocode' USING ERRCODE = '22023';
    END IF;
    IF v_promo.agent_id IS NOT NULL THEN
      SELECT agent.id, agent.group_id, agent.platform INTO v_assigned_to, v_group_id, v_platform
      FROM public.profiles agent
      JOIN public.user_roles role_row ON role_row.user_id = agent.id AND role_row.role = 'agent'::public.app_role
      WHERE agent.id = v_promo.agent_id AND agent.status = 'active'::public.user_status AND NOT agent.is_archived
      FOR SHARE OF agent, role_row;
      IF NOT FOUND THEN RAISE EXCEPTION 'The promotional code agent is unavailable' USING ERRCODE = '22023'; END IF;
    ELSE
      v_group_id := v_promo.group_id;
      SELECT coalesce(groups.platform, 'brightfund') INTO v_platform FROM public.groups WHERE id = v_group_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Promocode group was not found' USING ERRCODE = 'P0002'; END IF;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, email, display_email, first_name, last_name, platform, group_id, assigned_to)
  VALUES (NEW.id, NEW.email, coalesce(NEW.raw_user_meta_data->>'display_email', NEW.email),
    NEW.raw_user_meta_data->>'first_name', NEW.raw_user_meta_data->>'last_name', v_platform, v_group_id, v_assigned_to);

  IF v_promo.id IS NOT NULL THEN
    IF v_promo.role_type <> 'user'::public.app_role THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_promo.role_type);
    END IF;
    UPDATE public.promocodes SET times_used = coalesce(times_used, 0) + 1 WHERE id = v_promo.id;
  END IF;
  RETURN NEW;
END;
$$;

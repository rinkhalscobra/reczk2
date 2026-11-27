-- Each agent has one persistent customer signup code. Codes never grant a role.
CREATE TABLE public.agent_signup_codes (
  agent_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE DEFAULT ('AGT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)))
    CHECK (code ~ '^AGT-[A-F0-9]{12}$'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_signup_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_signup_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agent_signup_codes TO authenticated;

CREATE POLICY "Administrators can read agent signup codes"
ON public.agent_signup_codes FOR SELECT TO authenticated
USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

CREATE POLICY "Agents can read their own signup code"
ON public.agent_signup_codes FOR SELECT TO authenticated
USING (agent_id = (SELECT auth.uid()) AND public.has_role((SELECT auth.uid()), 'agent'::public.app_role));

-- Keep the code namespace separate from existing group invitation codes.
ALTER TABLE public.promocodes ADD CONSTRAINT promocodes_agent_prefix_reserved
  CHECK (code NOT ILIKE 'AGT-%');

CREATE FUNCTION public.ensure_agent_signup_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'agent'::public.app_role THEN
    INSERT INTO public.agent_signup_codes (agent_id) VALUES (NEW.user_id)
    ON CONFLICT (agent_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_agent_signup_code() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ensure_agent_signup_code_trg
AFTER INSERT OR UPDATE OF role ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.ensure_agent_signup_code();

INSERT INTO public.agent_signup_codes (agent_id)
SELECT user_id FROM public.user_roles WHERE role = 'agent'::public.app_role;

-- Administrators may choose any agent, without changing the client's group
-- or platform. Other staff still use their existing assignment boundaries.
CREATE OR REPLACE FUNCTION public.validate_profile_agent_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent_group uuid;
  v_agent_platform text;
BEGIN
  IF NEW.assigned_to IS NULL THEN RETURN NEW; END IF;

  SELECT agent.group_id, agent.platform INTO v_agent_group, v_agent_platform
  FROM public.profiles agent
  JOIN public.user_roles role_row ON role_row.user_id = agent.id AND role_row.role = 'agent'::public.app_role
  WHERE agent.id = NEW.assigned_to;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The assigned account must be an agent' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id)
     AND (auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin'::public.app_role)) THEN
    RETURN NEW;
  END IF;

  IF v_agent_group IS DISTINCT FROM NEW.group_id OR v_agent_platform IS DISTINCT FROM NEW.platform THEN
    RAISE EXCEPTION 'Customers can only be assigned to an agent in the same group and platform' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY "Agents can view assigned customers" ON public.profiles;
CREATE POLICY "Agents can view assigned customers" ON public.profiles FOR SELECT
USING (public.has_role(auth.uid(), 'agent'::public.app_role) AND assigned_to = auth.uid());

-- Group changes are independent of an administrator's chosen agent.
CREATE OR REPLACE FUNCTION public.set_customer_group(p_customer_id uuid, p_group_id uuid)
RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_customer public.profiles%ROWTYPE;
  v_group_platform text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only administrators can move customers between groups' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_customer FROM public.profiles WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer was not found' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_customer_id) THEN
    RAISE EXCEPTION 'Only client accounts can be moved with this action' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NOT NULL THEN
    SELECT platform INTO v_group_platform FROM public.groups WHERE id = p_group_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected group does not exist' USING ERRCODE = 'P0002'; END IF;
    IF v_group_platform IS DISTINCT FROM v_customer.platform THEN
      RAISE EXCEPTION 'Customers can only be moved to a group on the same platform' USING ERRCODE = '23514';
    END IF;
  END IF;
  UPDATE public.profiles SET group_id = p_group_id WHERE id = p_customer_id RETURNING * INTO v_customer;
  RETURN v_customer;
END;
$$;

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
    SELECT * INTO v_promo FROM public.promocodes WHERE code = v_code FOR UPDATE;
    IF NOT FOUND OR NOT coalesce(v_promo.is_active, false)
       OR (v_promo.expires_at IS NOT NULL AND v_promo.expires_at <= now())
       OR (v_promo.usage_limit IS NOT NULL AND coalesce(v_promo.times_used, 0) >= v_promo.usage_limit)
       OR v_promo.role_type NOT IN ('user'::public.app_role, 'agent'::public.app_role, 'supervisor'::public.app_role) THEN
      RAISE EXCEPTION 'Invalid, expired, or fully used promocode' USING ERRCODE = '22023';
    END IF;
    v_group_id := v_promo.group_id;
    SELECT coalesce(groups.platform, 'brightfund') INTO v_platform FROM public.groups WHERE id = v_group_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Promocode group was not found' USING ERRCODE = 'P0002'; END IF;
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

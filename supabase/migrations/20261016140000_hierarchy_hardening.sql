-- Make the CRM hierarchy deterministic and remove legacy policies that bypass
-- group/assignment boundaries.

-- One account has exactly one effective role. Accounts without a row are clients.
WITH ranked_roles AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY CASE role
        WHEN 'admin'::public.app_role THEN 1
        WHEN 'group_admin'::public.app_role THEN 2
        WHEN 'supervisor'::public.app_role THEN 3
        WHEN 'agent'::public.app_role THEN 4
        ELSE 5
      END,
      created_at,
      id
    ) AS position
  FROM public.user_roles
)
DELETE FROM public.user_roles roles
USING ranked_roles ranked
WHERE roles.id = ranked.id
  AND ranked.position > 1;

-- Clients are represented by the absence of a role row. Normalize legacy
-- explicit `user` rows so every authorization check uses the same model.
DELETE FROM public.user_roles
WHERE role = 'user'::public.app_role;

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_user_id_key;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);

-- Public signup may supply a promocode, but never a trusted group or role.
-- The trigger validates and consumes the code under a row lock so limits
-- cannot be bypassed with concurrent registrations.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := upper(trim(coalesce(NEW.raw_user_meta_data->>'promocode', '')));
  v_promo public.promocodes%ROWTYPE;
  v_group_id uuid;
  v_platform text := 'brightfund';
BEGIN
  IF v_code <> '' THEN
    SELECT * INTO v_promo
    FROM public.promocodes
    WHERE code = v_code
    FOR UPDATE;

    IF NOT FOUND
       OR NOT coalesce(v_promo.is_active, false)
       OR (v_promo.expires_at IS NOT NULL AND v_promo.expires_at <= now())
       OR (v_promo.usage_limit IS NOT NULL AND coalesce(v_promo.times_used, 0) >= v_promo.usage_limit)
       OR v_promo.role_type NOT IN ('user'::public.app_role, 'agent'::public.app_role, 'supervisor'::public.app_role) THEN
      RAISE EXCEPTION 'Invalid, expired, or fully used promocode' USING ERRCODE = '22023';
    END IF;

    v_group_id := v_promo.group_id;
    SELECT coalesce(groups.platform, 'brightfund') INTO v_platform
    FROM public.groups
    WHERE groups.id = v_group_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Promocode group was not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.profiles (
    id, email, display_email, first_name, last_name, platform, group_id
  ) VALUES (
    NEW.id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data->>'display_email', NEW.email),
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    v_platform,
    v_group_id
  );

  IF v_code <> '' THEN
    IF v_promo.role_type <> 'user'::public.app_role THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, v_promo.role_type);
    END IF;

    UPDATE public.promocodes
    SET times_used = coalesce(times_used, 0) + 1,
        updated_at = now()
    WHERE id = v_promo.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_promocode(p_code text)
RETURNS TABLE (is_valid boolean, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promo public.promocodes%ROWTYPE;
BEGIN
  SELECT * INTO v_promo
  FROM public.promocodes
  WHERE code = upper(trim(p_code));

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

REVOKE ALL ON FUNCTION public.validate_promocode(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_promocode(text) TO anon, authenticated;

-- Bind the helper to the real caller and only allow staff to manage clients.
CREATE OR REPLACE FUNCTION public.can_manage_customer(p_actor uuid, p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_actor = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles target_role
      WHERE target_role.user_id = p_customer_id
    )
    AND (
      public.has_role(p_actor, 'admin'::public.app_role)
      OR (
        (
          public.has_role(p_actor, 'group_admin'::public.app_role)
          OR public.has_role(p_actor, 'supervisor'::public.app_role)
        )
        AND public.is_same_group(p_actor, p_customer_id)
      )
      OR (
        public.has_role(p_actor, 'agent'::public.app_role)
        AND EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = p_customer_id AND assigned_to = p_actor
        )
      )
    )
$$;

-- Resolve a role deterministically for legacy callers.
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
$$;

-- All role changes go through one hierarchy-aware operation.
CREATE OR REPLACE FUNCTION public.set_managed_user_role(
  p_user_id uuid,
  p_role public.app_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_role public.app_role;
  v_target_role public.app_role;
  v_actor_group uuid;
  v_target_group uuid;
  v_actor_platform text;
  v_target_platform text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_actor = p_user_id THEN
    RAISE EXCEPTION 'You cannot change your own role' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.user_roles
  WHERE user_id = v_actor;

  SELECT role INTO v_target_role
  FROM public.user_roles
  WHERE user_id = p_user_id;

  SELECT group_id, platform INTO v_actor_group, v_actor_platform
  FROM public.profiles
  WHERE id = v_actor;

  SELECT group_id, platform INTO v_target_group, v_target_platform
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user was not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role = 'admin'::public.app_role THEN
    IF v_target_role = 'admin'::public.app_role
       AND p_role <> 'admin'::public.app_role
       AND (SELECT count(*) FROM public.user_roles WHERE role = 'admin'::public.app_role) <= 1 THEN
      RAISE EXCEPTION 'The last administrator cannot be demoted' USING ERRCODE = '42501';
    END IF;
  ELSIF v_actor_role = 'group_admin'::public.app_role THEN
    IF v_actor_group IS NULL
       OR v_actor_group IS DISTINCT FROM v_target_group
       OR v_actor_platform IS DISTINCT FROM v_target_platform
       OR v_target_role IN ('admin'::public.app_role, 'group_admin'::public.app_role)
       OR p_role NOT IN ('user'::public.app_role, 'agent'::public.app_role, 'supervisor'::public.app_role) THEN
      RAISE EXCEPTION 'Group administrators can only manage clients, agents, and supervisors in their own group' USING ERRCODE = '42501';
    END IF;
  ELSIF v_actor_role = 'supervisor'::public.app_role THEN
    IF v_actor_group IS NULL
       OR v_actor_group IS DISTINCT FROM v_target_group
       OR v_actor_platform IS DISTINCT FROM v_target_platform
       OR v_target_role IN ('admin'::public.app_role, 'group_admin'::public.app_role, 'supervisor'::public.app_role)
       OR p_role NOT IN ('user'::public.app_role, 'agent'::public.app_role) THEN
      RAISE EXCEPTION 'Supervisors can only promote clients to agents or demote agents in their own group' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to change roles' USING ERRCODE = '42501';
  END IF;

  -- A no-op role selection must not delete/reinsert an agent row, because the
  -- delete trigger correctly clears that agent's client assignments.
  IF v_target_role = p_role
     OR (v_target_role IS NULL AND p_role = 'user'::public.app_role) THEN
    RETURN;
  END IF;

  -- An account that stops being an agent must not retain customer assignments.
  IF v_target_role = 'agent'::public.app_role AND p_role <> 'agent'::public.app_role THEN
    UPDATE public.profiles
    SET assigned_to = NULL
    WHERE assigned_to = p_user_id;
  END IF;

  DELETE FROM public.user_roles WHERE user_id = p_user_id;

  IF p_role <> 'user'::public.app_role THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, p_role);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_managed_user_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_managed_user_role(uuid, public.app_role) TO authenticated;

-- Prevent authenticated callers from bypassing the hierarchy checks with
-- direct table writes. Service-role maintenance code remains responsible for
-- its own administrator authorization.
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;
DROP POLICY IF EXISTS "Group Admins can insert group member roles" ON public.user_roles;
DROP POLICY IF EXISTS "Group Admins can update group member roles" ON public.user_roles;
DROP POLICY IF EXISTS "Group Admins can delete group member roles" ON public.user_roles;

-- Preserve the same invariants even if a privileged caller edits user_roles
-- directly instead of using the RPC.
CREATE OR REPLACE FUNCTION public.protect_role_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'admin'::public.app_role THEN
    IF TG_OP = 'DELETE'
       AND (SELECT count(*) FROM public.user_roles WHERE role = 'admin'::public.app_role) <= 1 THEN
      RAISE EXCEPTION 'The last administrator cannot be removed' USING ERRCODE = '42501';
    ELSIF TG_OP = 'UPDATE'
       AND NEW.role <> 'admin'::public.app_role
       AND (SELECT count(*) FROM public.user_roles WHERE role = 'admin'::public.app_role) <= 1 THEN
      RAISE EXCEPTION 'The last administrator cannot be removed' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_role_hierarchy_trg ON public.user_roles;
CREATE TRIGGER protect_role_hierarchy_trg
BEFORE UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.protect_role_hierarchy();

CREATE OR REPLACE FUNCTION public.clear_invalid_agent_assignments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'agent'::public.app_role AND TG_OP = 'DELETE' THEN
    UPDATE public.profiles SET assigned_to = NULL WHERE assigned_to = OLD.user_id;
  ELSIF OLD.role = 'agent'::public.app_role
     AND TG_OP = 'UPDATE'
     AND NEW.role <> 'agent'::public.app_role THEN
    UPDATE public.profiles SET assigned_to = NULL WHERE assigned_to = OLD.user_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_invalid_agent_assignments_trg ON public.user_roles;
CREATE TRIGGER clear_invalid_agent_assignments_trg
AFTER UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.clear_invalid_agent_assignments();

-- Remove policies whose permissive OR semantics bypass scoped policies.
DROP POLICY IF EXISTS "Staff can manage balances" ON public.customer_balances;
DROP POLICY IF EXISTS "Group Admins can manage group balances" ON public.customer_balances;

DROP POLICY IF EXISTS "Group Admins can view group balances" ON public.customer_balances;
CREATE POLICY "Group Admins can view group balances"
ON public.customer_balances FOR SELECT
USING (
  public.has_role(auth.uid(), 'group_admin'::public.app_role)
  AND public.is_same_group(auth.uid(), customer_id)
);

DROP POLICY IF EXISTS "Staff can manage notifications" ON public.notifications;

DROP POLICY IF EXISTS "Admins can view all notifications" ON public.notifications;
CREATE POLICY "Admins can view all notifications"
ON public.notifications FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Supervisors can view group notifications" ON public.notifications;
CREATE POLICY "Supervisors can view group notifications"
ON public.notifications FOR SELECT
USING (
  public.has_role(auth.uid(), 'supervisor'::public.app_role)
  AND public.is_same_group(auth.uid(), user_id)
);

DROP POLICY IF EXISTS "Agents can view assigned customer notifications" ON public.notifications;
CREATE POLICY "Agents can view assigned customer notifications"
ON public.notifications FOR SELECT
USING (
  public.has_role(auth.uid(), 'agent'::public.app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = notifications.user_id
      AND profiles.assigned_to = auth.uid()
  )
);

-- The generic message policy previously let every authenticated user message
-- every other account. Clients may only initiate messages with their agent.
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
CREATE POLICY "Clients can send messages to assigned agent"
ON public.messages FOR INSERT
WITH CHECK (
  auth.uid() = sender_id
  AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid())
  AND recipient_id = (
    SELECT assigned_to FROM public.profiles WHERE id = auth.uid()
  )
);

-- Existing assignments to administrators/supervisors/clients are invalid.
UPDATE public.profiles customer
SET assigned_to = NULL
WHERE customer.assigned_to IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles agent
    JOIN public.user_roles role_row
      ON role_row.user_id = agent.id
     AND role_row.role = 'agent'::public.app_role
    WHERE agent.id = customer.assigned_to
      AND agent.group_id IS NOT DISTINCT FROM customer.group_id
      AND agent.platform IS NOT DISTINCT FROM customer.platform
  );

CREATE OR REPLACE FUNCTION public.validate_profile_agent_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles agent
    JOIN public.user_roles role_row
      ON role_row.user_id = agent.id
     AND role_row.role = 'agent'::public.app_role
    WHERE agent.id = NEW.assigned_to
      AND agent.group_id IS NOT DISTINCT FROM NEW.group_id
      AND agent.platform IS NOT DISTINCT FROM NEW.platform
  ) THEN
    RAISE EXCEPTION 'Customers can only be assigned to an agent in the same group and platform' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_profile_agent_assignment_trg ON public.profiles;
CREATE TRIGGER validate_profile_agent_assignment_trg
BEFORE INSERT OR UPDATE OF assigned_to, group_id, platform ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_profile_agent_assignment();

-- Staff status does not grant unrestricted privilege-field edits.
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role'
     OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.is_super IS DISTINCT FROM OLD.is_super
     OR NEW.group_id IS DISTINCT FROM OLD.group_id
     OR NEW.platform IS DISTINCT FROM OLD.platform
     OR NEW.is_archived IS DISTINCT FROM OLD.is_archived
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Not allowed to modify protected profile fields' USING ERRCODE = '42501';
  END IF;

  IF public.has_role(auth.uid(), 'agent'::public.app_role)
     AND (
       NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
       OR NEW.subscription IS DISTINCT FROM OLD.subscription
     ) THEN
    RAISE EXCEPTION 'Agents cannot change assignment or subscription fields' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'group_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'supervisor'::public.app_role)
    OR public.has_role(auth.uid(), 'agent'::public.app_role)
  ) AND auth.uid() = NEW.id THEN
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
       OR NEW.subscription IS DISTINCT FROM OLD.subscription
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.case_phase IS DISTINCT FROM OLD.case_phase
       OR NEW.case_number IS DISTINCT FROM OLD.case_number THEN
      RAISE EXCEPTION 'Not allowed to modify protected profile fields' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Password reset requests contain intent only. A new password is supplied by
-- the approving staff member directly to the authenticated Edge Function.
ALTER TABLE public.password_reset_requests
  DROP COLUMN IF EXISTS new_password_hash;

-- Access tokens do not belong in an application audit table. Erase the legacy
-- values and expose only non-secret session metadata through the scoped RPC.
DROP FUNCTION IF EXISTS public.get_user_sessions_for_staff(uuid);
ALTER TABLE public.user_sessions DROP COLUMN IF EXISTS access_token;

CREATE FUNCTION public.get_user_sessions_for_staff(target_user_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  login_time timestamptz,
  is_active boolean,
  login_ip text,
  user_agent text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT session.id, session.user_id, session.login_time, session.is_active,
         session.login_ip, session.user_agent
  FROM public.user_sessions session
  WHERE session.user_id = target_user_id
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (
        public.has_role(auth.uid(), 'group_admin'::public.app_role)
        AND public.is_same_group(auth.uid(), target_user_id)
      )
      OR (
        public.has_role(auth.uid(), 'supervisor'::public.app_role)
        AND public.is_same_group(auth.uid(), target_user_id)
      )
      OR (
        public.has_role(auth.uid(), 'agent'::public.app_role)
        AND EXISTS (
          SELECT 1 FROM public.profiles
          WHERE profiles.id = target_user_id
            AND profiles.assigned_to = auth.uid()
        )
      )
      OR auth.uid() = target_user_id
    )
$$;

REVOKE ALL ON FUNCTION public.get_user_sessions_for_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_sessions_for_staff(uuid) TO authenticated;

-- Non-admin reset requests may target clients only.
DROP POLICY IF EXISTS "Group Admins can create requests for group users" ON public.password_reset_requests;
CREATE POLICY "Group Admins can create requests for group clients"
ON public.password_reset_requests FOR INSERT
WITH CHECK (
  public.has_role(auth.uid(), 'group_admin'::public.app_role)
  AND public.is_same_group(auth.uid(), target_user_id)
  AND requested_by = auth.uid()
  AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = target_user_id)
);

DROP POLICY IF EXISTS "Supervisors can create requests for group users" ON public.password_reset_requests;
CREATE POLICY "Supervisors can create requests for group clients"
ON public.password_reset_requests FOR INSERT
WITH CHECK (
  public.has_role(auth.uid(), 'supervisor'::public.app_role)
  AND public.is_same_group(auth.uid(), target_user_id)
  AND requested_by = auth.uid()
  AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = target_user_id)
);

DROP POLICY IF EXISTS "Agents can create requests for assigned customers" ON public.password_reset_requests;
CREATE POLICY "Agents can create requests for assigned clients"
ON public.password_reset_requests FOR INSERT
WITH CHECK (
  public.has_role(auth.uid(), 'agent'::public.app_role)
  AND requested_by = auth.uid()
  AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = target_user_id)
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = target_user_id
      AND profiles.assigned_to = auth.uid()
  )
);

COMMENT ON FUNCTION public.set_managed_user_role(uuid, public.app_role) IS
  'Changes one account role while enforcing the admin/group-admin/supervisor hierarchy.';

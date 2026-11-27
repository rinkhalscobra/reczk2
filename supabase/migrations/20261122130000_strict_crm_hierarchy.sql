-- admin is the existing database role for Superior Admin.
ALTER TABLE public.profiles ADD COLUMN supervisor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX profiles_supervisor_id_idx ON public.profiles(supervisor_id) WHERE supervisor_id IS NOT NULL;
CREATE INDEX profiles_assigned_to_group_idx ON public.profiles(assigned_to, group_id);

UPDATE public.profiles staff SET assigned_to = NULL WHERE assigned_to IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = staff.id);

-- Backfill only a known supervisor/agent relationship; never guess ownership.
UPDATE public.profiles agent SET supervisor_id = supervisor.id
FROM public.profiles supervisor
WHERE agent.created_by = supervisor.id
  AND agent.group_id = supervisor.group_id AND agent.platform = supervisor.platform
  AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = agent.id AND role = 'agent')
  AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = supervisor.id AND role = 'supervisor');

-- Legacy cross-group assignments no longer represent a valid hierarchy.
UPDATE public.profiles client SET assigned_to = NULL
WHERE assigned_to IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.profiles agent JOIN public.user_roles r ON r.user_id = agent.id AND r.role = 'agent'
  WHERE agent.id = client.assigned_to AND agent.group_id = client.group_id AND agent.platform = client.platform
);

-- Bind browser calls to their own identity. Verified Edge Functions may check
-- their authenticated actor through the service role using this same predicate.
CREATE FUNCTION public.can_access_account(p_actor uuid, p_target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(
    (p_actor = auth.uid() OR auth.role() = 'service_role') AND EXISTS (
      SELECT 1 FROM public.profiles actor JOIN public.profiles target ON target.id = p_target
      LEFT JOIN public.user_roles actor_role ON actor_role.user_id = actor.id
      LEFT JOIN public.user_roles target_role ON target_role.user_id = target.id
      WHERE actor.id = p_actor AND (
        actor.id = target.id OR actor_role.role = 'admin' OR (
          actor.group_id IS NOT NULL AND actor.group_id = target.group_id AND actor.platform = target.platform
          AND target_role.role IS DISTINCT FROM 'admin'::public.app_role AND (
            actor_role.role = 'group_admin' OR (
              actor_role.role = 'supervisor' AND (
                (target_role.role = 'agent' AND target.supervisor_id = actor.id) OR (
                  target_role.role IS NULL AND EXISTS (
                    SELECT 1 FROM public.profiles agent JOIN public.user_roles r ON r.user_id = agent.id AND r.role = 'agent'
                    WHERE agent.id = target.assigned_to AND agent.supervisor_id = actor.id
                      AND agent.group_id = actor.group_id AND agent.platform = actor.platform
                  )
                )
              )
            ) OR (actor_role.role = 'agent' AND target_role.role IS NULL AND target.assigned_to = actor.id)
          )
        )
      )
    ), false);
$$;

CREATE FUNCTION public.can_manage_account(p_actor uuid, p_target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p_actor <> p_target AND public.can_access_account(p_actor, p_target)
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_actor AND role IN ('admin', 'group_admin', 'supervisor', 'agent'));
$$;

CREATE OR REPLACE FUNCTION public.can_manage_customer(p_actor uuid, p_customer_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.can_manage_account(p_actor, p_customer_id)
    AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_customer_id);
$$;

REVOKE ALL ON FUNCTION public.can_access_account(uuid, uuid), public.can_manage_account(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_account(uuid, uuid), public.can_manage_account(uuid, uuid) TO authenticated, service_role;

-- Restrictive policies intersect every legacy permissive policy. No older
-- group-wide policy can widen a supervisor's subtree or an agent's clients.
DO $$
DECLARE v_table text; v_column text;
BEGIN
  FOR v_table, v_column IN SELECT * FROM (VALUES
    ('profiles', 'id'), ('user_roles', 'user_id'), ('user_sessions', 'user_id'),
    ('notifications', 'user_id'), ('portfolio_items', 'user_id'), ('watchlist_items', 'user_id'),
    ('customer_balances', 'customer_id'), ('crypto_balance_adjustments', 'customer_id'),
    ('customer_notes', 'customer_id'), ('case_timeline', 'customer_id'),
    ('client_payment_details', 'customer_id'), ('kyc_submissions', 'customer_id'),
    ('transaction_requests', 'customer_id'), ('recovery_funds', 'customer_id'),
    ('password_reset_requests', 'target_user_id'), ('ip_validation_logs', 'user_id')
  ) AS scope(table_name, account_column)
  LOOP
    EXECUTE format('CREATE POLICY strict_account_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.has_role(auth.uid(), ''admin'') OR public.can_access_account(auth.uid(), %I)) WITH CHECK (public.has_role(auth.uid(), ''admin'') OR public.can_access_account(auth.uid(), %I))', v_table, v_column, v_column);
  END LOOP;
END;
$$;

CREATE POLICY "Staff manage scoped watchlists" ON public.watchlist_items FOR ALL TO authenticated
USING (public.can_manage_account(auth.uid(), user_id))
WITH CHECK (public.can_manage_account(auth.uid(), user_id));

CREATE POLICY strict_group_scope ON public.groups AS RESTRICTIVE FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR id = public.get_user_group(auth.uid()))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR id = public.get_user_group(auth.uid()));
CREATE POLICY "Group admin can update own group" ON public.groups FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'group_admin') AND id = public.get_user_group(auth.uid()))
WITH CHECK (public.has_role(auth.uid(), 'group_admin') AND id = public.get_user_group(auth.uid()));
CREATE POLICY strict_ip_rule_scope ON public.ip_whitelist AS RESTRICTIVE FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR (public.has_role(auth.uid(), 'group_admin') AND group_id = public.get_user_group(auth.uid()) AND (user_id IS NULL OR public.can_access_account(auth.uid(), user_id))))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR (public.has_role(auth.uid(), 'group_admin') AND group_id = public.get_user_group(auth.uid()) AND (user_id IS NULL OR public.can_access_account(auth.uid(), user_id))));
CREATE POLICY "Group admin can update own IP rules" ON public.ip_whitelist FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'group_admin') AND group_id = public.get_user_group(auth.uid()))
WITH CHECK (public.has_role(auth.uid(), 'group_admin') AND group_id = public.get_user_group(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.ip_validation_logs FROM anon, authenticated;

CREATE FUNCTION public.can_access_conversation(p_actor uuid, p_sender uuid, p_recipient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT (p_actor = auth.uid() OR auth.role() = 'service_role') AND (
    public.has_role(p_actor, 'admin') OR (
      public.can_access_account(p_actor, p_sender) AND public.can_access_account(p_actor, p_recipient)
    ) OR (
      -- Superior Admin can participate in any group's conversation without
      -- hiding that group's own client correspondence from its managers.
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_actor AND role IN ('group_admin', 'supervisor', 'agent')) AND (
        (public.can_access_account(p_actor, p_sender) AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_recipient AND role = 'admin')) OR
        (public.can_access_account(p_actor, p_recipient) AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_sender AND role = 'admin'))
      )
    ) OR (
      -- Clients can read their own conversation with their currently assigned
      -- agent, and anyone can receive a message from Superior Admin.
      (p_actor = p_sender OR p_actor = p_recipient) AND EXISTS (
        SELECT 1 FROM public.profiles actor JOIN public.profiles other
          ON other.id = CASE WHEN p_actor = p_sender THEN p_recipient ELSE p_sender END
        WHERE actor.id = p_actor AND (
          EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = other.id AND role = 'admin') OR (
            NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = actor.id)
            AND actor.assigned_to = other.id AND actor.group_id = other.group_id AND actor.platform = other.platform
            AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = other.id AND role = 'agent')
          )
        )
      )
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_conversation(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_conversation(uuid, uuid, uuid) TO authenticated, service_role;
CREATE POLICY strict_conversation_scope ON public.messages AS RESTRICTIVE FOR ALL TO authenticated
USING (public.can_access_conversation(auth.uid(), sender_id, recipient_id))
WITH CHECK (public.can_access_conversation(auth.uid(), sender_id, recipient_id));

-- Assignment integrity applies even to service-role writes.
CREATE OR REPLACE FUNCTION public.validate_profile_agent_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) THEN
    RAISE EXCEPTION 'Only clients can be assigned to agents' USING ERRCODE = '23514';
  END IF;
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles agent JOIN public.user_roles r ON r.user_id = agent.id AND r.role = 'agent'
    WHERE agent.id = NEW.assigned_to AND agent.group_id = NEW.group_id AND agent.platform = NEW.platform
  ) THEN
    RAISE EXCEPTION 'The assigned account must be an agent in the same group and platform' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.validate_agent_supervisor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.supervisor_id IS NOT NULL AND (
    NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role = 'agent') OR NOT EXISTS (
      SELECT 1 FROM public.profiles supervisor JOIN public.user_roles r ON r.user_id = supervisor.id AND r.role = 'supervisor'
      WHERE supervisor.id = NEW.supervisor_id AND supervisor.group_id = NEW.group_id AND supervisor.platform = NEW.platform
    )
  ) THEN
    RAISE EXCEPTION 'Select a supervisor in the agent group and platform' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id
     AND auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'group_admin') THEN
    RAISE EXCEPTION 'Only Superior Admin or Group Admin can assign supervisors' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_agent_supervisor BEFORE INSERT OR UPDATE OF supervisor_id, group_id, platform ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_agent_supervisor();
REVOKE ALL ON FUNCTION public.validate_agent_supervisor() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_agent_supervisor(p_agent_id uuid, p_supervisor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_agent public.profiles%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'group_admin')) THEN
    RAISE EXCEPTION 'Only Superior Admin or Group Admin can assign supervisors' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_agent FROM public.profiles WHERE id = p_agent_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_account(auth.uid(), p_agent_id)
    OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_agent_id AND role = 'agent') THEN
    RAISE EXCEPTION 'Agent is outside your permitted scope' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles SET supervisor_id = p_supervisor_id WHERE id = p_agent_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_agent_supervisor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agent_supervisor(uuid, uuid) TO authenticated;

CREATE FUNCTION public.set_agents_supervisor(p_agent_ids uuid[], p_supervisor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_agent uuid;
BEGIN
  IF coalesce(cardinality(p_agent_ids), 0) = 0 OR cardinality(p_agent_ids) > 500 THEN
    RAISE EXCEPTION 'Select between 1 and 500 agents' USING ERRCODE = '22023';
  END IF;
  FOREACH v_agent IN ARRAY p_agent_ids LOOP
    PERFORM public.set_agent_supervisor(v_agent, p_supervisor_id);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.set_agents_supervisor(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agents_supervisor(uuid[], uuid) TO authenticated;

CREATE FUNCTION public.clear_hierarchy_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.role = NEW.role AND OLD.user_id = NEW.user_id THEN RETURN NEW; END IF;
  IF OLD.role = 'agent' THEN UPDATE public.profiles SET supervisor_id = NULL WHERE id = OLD.user_id; END IF;
  IF OLD.role = 'supervisor' THEN UPDATE public.profiles SET supervisor_id = NULL WHERE supervisor_id = OLD.user_id; END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER clear_hierarchy_links AFTER DELETE OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.clear_hierarchy_links();
REVOKE ALL ON FUNCTION public.clear_hierarchy_links() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.clear_staff_client_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles SET assigned_to = NULL WHERE id = NEW.user_id AND assigned_to IS NOT NULL;
  RETURN NEW;
END;
$$;
CREATE TRIGGER clear_staff_client_assignment AFTER INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.clear_staff_client_assignment();
REVOKE ALL ON FUNCTION public.clear_staff_client_assignment() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin') THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.login_email IS DISTINCT FROM OLD.login_email OR NEW.display_email IS DISTINCT FROM OLD.display_email
     OR NEW.is_super IS DISTINCT FROM OLD.is_super OR NEW.group_id IS DISTINCT FROM OLD.group_id
     OR NEW.platform IS DISTINCT FROM OLD.platform OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Not allowed to modify protected profile fields' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() = NEW.id THEN
    IF (to_jsonb(NEW) - ARRAY['first_name','last_name','username','phone','birthdate','preferred_currency','display_currency','last_login','updated_at','case_number'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['first_name','last_name','username','phone','birthdate','preferred_currency','display_currency','last_login','updated_at','case_number']) THEN
      RAISE EXCEPTION 'Not allowed to modify protected profile fields' USING ERRCODE = '42501';
    END IF;
    IF NEW.case_number IS DISTINCT FROM OLD.case_number THEN
      RAISE EXCEPTION 'Not allowed to change your own case number' USING ERRCODE = '42501';
    END IF;
  ELSIF public.has_role(auth.uid(), 'agent') AND (
    NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.subscription IS DISTINCT FROM OLD.subscription
    OR NEW.is_archived IS DISTINCT FROM OLD.is_archived OR NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id
  ) THEN
    RAISE EXCEPTION 'Agents cannot change assignment or subscription fields' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Do not expose another group's role or membership through metadata RPCs.
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id
    AND (auth.role() = 'service_role' OR public.can_access_account(auth.uid(), _user_id));
$$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT coalesce(public.get_user_role(_user_id) = _role, false); $$;

CREATE OR REPLACE FUNCTION public.get_user_group(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT group_id FROM public.profiles WHERE id = _user_id
    AND (auth.role() = 'service_role' OR public.can_access_account(auth.uid(), _user_id));
$$;

CREATE OR REPLACE FUNCTION public.get_user_platform(_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT platform FROM public.profiles WHERE id = _user_id
    AND (auth.role() = 'service_role' OR public.can_access_account(auth.uid(), _user_id));
$$;
CREATE OR REPLACE FUNCTION public.is_same_group(_user_id_1 uuid, _user_id_2 uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((auth.role() = 'service_role' OR (
    public.can_access_account(auth.uid(), _user_id_1) AND public.can_access_account(auth.uid(), _user_id_2)
  )) AND EXISTS (
    SELECT 1 FROM public.profiles first_profile JOIN public.profiles second_profile
      ON first_profile.group_id = second_profile.group_id AND first_profile.platform = second_profile.platform
    WHERE first_profile.id = _user_id_1 AND second_profile.id = _user_id_2
  ), false);
$$;

-- Moving a supervisor/agent must also remove invalid downstream relationships.
CREATE FUNCTION public.clear_cross_group_hierarchy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles SET supervisor_id = NULL WHERE supervisor_id = NEW.id
    AND (group_id IS DISTINCT FROM NEW.group_id OR platform IS DISTINCT FROM NEW.platform);
  UPDATE public.profiles SET assigned_to = NULL WHERE assigned_to = NEW.id
    AND (group_id IS DISTINCT FROM NEW.group_id OR platform IS DISTINCT FROM NEW.platform);
  RETURN NEW;
END;
$$;
CREATE TRIGGER clear_cross_group_hierarchy AFTER UPDATE OF group_id, platform ON public.profiles
FOR EACH ROW WHEN (OLD.group_id IS DISTINCT FROM NEW.group_id OR OLD.platform IS DISTINCT FROM NEW.platform)
EXECUTE FUNCTION public.clear_cross_group_hierarchy();
REVOKE ALL ON FUNCTION public.clear_cross_group_hierarchy() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.enforce_group_admin_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user uuid; v_group uuid;
BEGIN
  IF TG_TABLE_NAME = 'user_roles' THEN
    IF NEW.role <> 'group_admin' THEN RETURN NEW; END IF;
    v_user := NEW.user_id;
    SELECT group_id INTO v_group FROM public.profiles WHERE id = v_user;
  ELSE
    v_user := NEW.id; v_group := NEW.group_id;
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_user AND role = 'group_admin') THEN RETURN NEW; END IF;
  END IF;
  IF v_group IS NOT NULL THEN
    -- Serialize concurrent appointments to the same group.
    PERFORM 1 FROM public.groups WHERE id = v_group FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.profiles p JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'group_admin'
               WHERE p.group_id = v_group AND p.id <> v_user) THEN
      RAISE EXCEPTION 'This group already has a Group Admin' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_group_admin_role BEFORE INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_group_admin_owner();
CREATE TRIGGER enforce_group_admin_membership BEFORE UPDATE OF group_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_group_admin_owner();
REVOKE ALL ON FUNCTION public.enforce_group_admin_owner() FROM PUBLIC, anon, authenticated;

-- Group transfer explicitly drops an assignment that would cross the boundary.
CREATE OR REPLACE FUNCTION public.set_customer_group(p_customer_id uuid, p_group_id uuid)
RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_customer public.profiles%ROWTYPE; v_group_platform text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only Superior Admin can move customers between groups' USING ERRCODE = '42501';
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
  UPDATE public.profiles SET group_id = p_group_id,
    assigned_to = CASE WHEN group_id IS NOT DISTINCT FROM p_group_id THEN assigned_to ELSE NULL END
    WHERE id = p_customer_id RETURNING * INTO v_customer;
  RETURN v_customer;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_sessions_for_staff(target_user_id uuid)
RETURNS TABLE (id uuid, user_id uuid, login_time timestamptz, is_active boolean, login_ip text, user_agent text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT session.id, session.user_id, session.login_time, session.is_active, session.login_ip, session.user_agent
  FROM public.user_sessions session
  WHERE session.user_id = target_user_id AND public.can_access_account(auth.uid(), target_user_id);
$$;

-- Use the same subtree authorization inside privileged balance RPCs.
CREATE OR REPLACE FUNCTION public.adjust_crypto_balance(p_customer_id uuid, p_crypto_id text, p_crypto_symbol text, p_crypto_name text, p_amount numeric, p_adjustment_type text, p_reason text DEFAULT NULL::text, p_unit_price numeric DEFAULT 0)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_crypto_id text := lower(trim(p_crypto_id));
  v_symbol text := upper(trim(p_crypto_symbol));
  v_name text := trim(p_crypto_name);
  v_reason text := nullif(trim(p_reason), '');
  v_amount numeric(20, 8);
  v_before numeric(20, 8) := 0;
  v_after numeric(20, 8);
  v_amount_text text;
  v_after_text text;
  v_holding public.portfolio_items%ROWTYPE;
  v_can_manage boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_can_manage := public.can_manage_customer(v_actor, p_customer_id);

  IF NOT v_can_manage THEN
    RAISE EXCEPTION 'You do not have permission to manage this customer' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR round(p_amount, 8) <> p_amount THEN
    RAISE EXCEPTION 'Amount must be greater than zero with at most 8 decimal places' USING ERRCODE = '22023';
  END IF;
  IF p_adjustment_type NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'Adjustment type must be credit or debit' USING ERRCODE = '22023';
  END IF;
  IF v_crypto_id = '' OR v_symbol !~ '^[A-Z0-9]{2,15}$' OR v_name = '' OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'Invalid cryptocurrency details' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Reason cannot exceed 500 characters' USING ERRCODE = '22023';
  END IF;

  v_amount := p_amount;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_customer_id::text || ':' || v_crypto_id, 0));

  SELECT * INTO v_holding
  FROM public.portfolio_items
  WHERE user_id = p_customer_id AND crypto_id = v_crypto_id
  FOR UPDATE;

  IF FOUND THEN
    v_before := v_holding.quantity;
  END IF;

  v_after := v_before + CASE
    WHEN p_adjustment_type = 'credit' THEN v_amount
    ELSE -v_amount
  END;

  IF v_after < 0 THEN
    RAISE EXCEPTION 'Insufficient % balance. Available: %', v_symbol, v_before USING ERRCODE = '22003';
  END IF;

  IF p_adjustment_type = 'credit' THEN
    INSERT INTO public.portfolio_items (
      user_id, crypto_id, crypto_symbol, crypto_name, quantity, purchase_price, purchase_date
    ) VALUES (
      p_customer_id, v_crypto_id, v_symbol, v_name, v_amount, greatest(coalesce(p_unit_price, 0), 0), now()
    )
    ON CONFLICT (user_id, crypto_id) DO UPDATE SET
      crypto_symbol = EXCLUDED.crypto_symbol,
      crypto_name = EXCLUDED.crypto_name,
      purchase_price = CASE
        WHEN EXCLUDED.purchase_price > 0 THEN
          ((public.portfolio_items.quantity * public.portfolio_items.purchase_price)
            + (EXCLUDED.quantity * EXCLUDED.purchase_price))
          / (public.portfolio_items.quantity + EXCLUDED.quantity)
        ELSE public.portfolio_items.purchase_price
      END,
      quantity = public.portfolio_items.quantity + EXCLUDED.quantity,
      updated_at = now();
  ELSIF v_after = 0 THEN
    DELETE FROM public.portfolio_items
    WHERE user_id = p_customer_id AND crypto_id = v_crypto_id;
  ELSE
    UPDATE public.portfolio_items
    SET quantity = v_after, updated_at = now()
    WHERE user_id = p_customer_id AND crypto_id = v_crypto_id;
  END IF;

  INSERT INTO public.crypto_balance_adjustments (
    customer_id, crypto_id, crypto_symbol, crypto_name, adjustment_type,
    amount, balance_before, balance_after, reason, created_by
  ) VALUES (
    p_customer_id, v_crypto_id, v_symbol, v_name, p_adjustment_type,
    v_amount, v_before, v_after, v_reason, v_actor
  );

  v_amount_text := rtrim(rtrim(to_char(v_amount, 'FM99999999999999999990.99999999'), '0'), '.');
  v_after_text := rtrim(rtrim(to_char(v_after, 'FM99999999999999999990.99999999'), '0'), '.');

  INSERT INTO public.notifications (user_id, type, title, message, is_read)
  VALUES (
    p_customer_id,
    CASE WHEN p_adjustment_type = 'credit' THEN 'success' ELSE 'info' END,
    format(
      '%s crypto balance %s',
      v_symbol,
      CASE WHEN p_adjustment_type = 'credit' THEN 'credited' ELSE 'debited' END
    ),
    format(
      '%s %s was %s your crypto balance. New balance: %s %s.%s',
      v_amount_text,
      v_symbol,
      CASE WHEN p_adjustment_type = 'credit' THEN 'added to' ELSE 'deducted from' END,
      v_after_text,
      v_symbol,
      CASE WHEN v_reason IS NULL THEN '' ELSE ' Note: ' || v_reason END
    ),
    false
  );

  RETURN v_after;
END;
$function$;


-- Use the same subtree authorization inside privileged balance RPCs.
CREATE OR REPLACE FUNCTION public.adjust_fiat_balance(p_customer_id uuid, p_currency text, p_amount numeric, p_adjustment_type text, p_reason text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_currency text := upper(trim(p_currency));
  v_reason text := nullif(trim(p_reason), '');
  v_amount numeric(20, 2);
  v_before numeric(20, 2) := 0;
  v_after numeric(20, 2);
  v_amount_text text;
  v_after_text text;
  v_can_manage boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_can_manage := public.can_manage_customer(v_actor, p_customer_id);

  IF NOT v_can_manage THEN
    RAISE EXCEPTION 'You do not have permission to manage this customer' USING ERRCODE = '42501';
  END IF;

  IF v_currency NOT IN ('EUR', 'USD', 'CAD') THEN
    RAISE EXCEPTION 'Unsupported fiat currency' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR round(p_amount, 2) <> p_amount THEN
    RAISE EXCEPTION 'Amount must be greater than zero with at most 2 decimal places' USING ERRCODE = '22023';
  END IF;
  IF p_adjustment_type NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'Adjustment type must be credit or debit' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Reason cannot exceed 500 characters' USING ERRCODE = '22023';
  END IF;

  v_amount := p_amount;

  -- Serialize adjustments even when this currency row has not been created.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_customer_id::text || ':fiat:' || v_currency, 0)
  );

  INSERT INTO public.customer_balances (
    customer_id, currency, balance, updated_by, updated_at
  ) VALUES (
    p_customer_id, v_currency, 0, v_actor, now()
  )
  ON CONFLICT (customer_id, currency) DO NOTHING;

  SELECT balance INTO v_before
  FROM public.customer_balances
  WHERE customer_id = p_customer_id AND currency = v_currency
  FOR UPDATE;

  v_after := v_before + CASE
    WHEN p_adjustment_type = 'credit' THEN v_amount
    ELSE -v_amount
  END;

  IF v_after < 0 THEN
    RAISE EXCEPTION 'Insufficient % balance. Available: %', v_currency, v_before USING ERRCODE = '22003';
  END IF;

  UPDATE public.customer_balances
  SET balance = v_after, updated_by = v_actor, updated_at = now()
  WHERE customer_id = p_customer_id AND currency = v_currency;

  v_amount_text := rtrim(rtrim(to_char(v_amount, 'FM99999999999999999990.99'), '0'), '.');
  v_after_text := rtrim(rtrim(to_char(v_after, 'FM99999999999999999990.99'), '0'), '.');

  INSERT INTO public.notifications (user_id, type, title, message, is_read)
  VALUES (
    p_customer_id,
    CASE WHEN p_adjustment_type = 'credit' THEN 'success' ELSE 'info' END,
    format(
      '%s cash balance %s',
      v_currency,
      CASE WHEN p_adjustment_type = 'credit' THEN 'credited' ELSE 'debited' END
    ),
    format(
      '%s %s was %s your cash balance. New balance: %s %s.%s',
      v_amount_text,
      v_currency,
      CASE WHEN p_adjustment_type = 'credit' THEN 'added to' ELSE 'deducted from' END,
      v_after_text,
      v_currency,
      CASE WHEN v_reason IS NULL THEN '' ELSE ' Note: ' || v_reason END
    ),
    false
  );

  RETURN v_after;
END;
$function$;


-- Use the same subtree authorization inside privileged balance RPCs.
CREATE OR REPLACE FUNCTION public.set_balance_dashboard_visibility(p_customer_id uuid, p_balance_kind text, p_balance_id uuid, p_visible boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_can_manage boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_can_manage := public.can_manage_customer(v_actor, p_customer_id);

  IF NOT v_can_manage THEN
    RAISE EXCEPTION 'You do not have permission to manage this customer' USING ERRCODE = '42501';
  END IF;

  IF p_balance_kind = 'fiat' THEN
    UPDATE public.customer_balances
    SET visible_on_dashboard = p_visible,
        updated_by = v_actor,
        updated_at = now()
    WHERE id = p_balance_id AND customer_id = p_customer_id;
  ELSIF p_balance_kind = 'crypto' THEN
    UPDATE public.portfolio_items
    SET visible_on_dashboard = p_visible,
        updated_at = now()
    WHERE id = p_balance_id AND user_id = p_customer_id;
  ELSE
    RAISE EXCEPTION 'Balance kind must be fiat or crypto' USING ERRCODE = '22023';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Balance was not found for this customer' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;


-- Role changes are owned by the administrators of the hierarchy.
CREATE OR REPLACE FUNCTION public.set_managed_user_role(p_user_id uuid, p_role app_role)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  ELSE
    RAISE EXCEPTION 'Only Superior Admin or Group Admin can change roles in their permitted scope' USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('admin'::public.app_role, 'group_admin'::public.app_role)
     OR NOT public.can_manage_account(v_actor, p_user_id) THEN
    RAISE EXCEPTION 'Only Superior Admin or Group Admin can change roles in their permitted scope' USING ERRCODE = '42501';
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
$function$;


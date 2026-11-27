-- Permissions select an allowed workflow; they never expand hierarchy scope.
CREATE TABLE public.role_permissions (
  role public.app_role NOT NULL CHECK (role IN ('group_admin', 'supervisor', 'agent')),
  permission text NOT NULL CHECK (permission = 'reset_password'),
  mode text NOT NULL CHECK (mode IN ('direct', 'approval', 'deny')),
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission)
);
INSERT INTO public.role_permissions(role, permission, mode) VALUES
  ('group_admin', 'reset_password', 'direct'),
  ('supervisor', 'reset_password', 'direct'),
  ('agent', 'reset_password', 'approval');
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.role_permissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.role_permissions TO authenticated;
CREATE POLICY "Staff read applicable role permissions" ON public.role_permissions FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR role = public.get_user_role(auth.uid()));

CREATE TABLE public.role_permission_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  permission text NOT NULL,
  old_mode text NOT NULL,
  new_mode text NOT NULL,
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.role_permission_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.role_permission_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.role_permission_changes TO authenticated;
CREATE POLICY "Superior Admin reads permission history" ON public.role_permission_changes FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE FUNCTION public.role_permission_mode(p_actor uuid, p_permission text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN p_actor = auth.uid() OR auth.role() = 'service_role' THEN
    CASE WHEN p_permission IS DISTINCT FROM 'reset_password' THEN 'deny'
      WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_actor AND role = 'admin') THEN 'direct'
      ELSE coalesce((SELECT setting.mode FROM public.role_permissions setting JOIN public.user_roles actor ON actor.role = setting.role
                     WHERE actor.user_id = p_actor AND setting.permission = p_permission), 'deny') END
    ELSE 'deny' END;
$$;
REVOKE ALL ON FUNCTION public.role_permission_mode(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.role_permission_mode(uuid, text) TO authenticated, service_role;

CREATE FUNCTION public.get_my_permission(p_permission text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT public.role_permission_mode(auth.uid(), p_permission); $$;
REVOKE ALL ON FUNCTION public.get_my_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_permission(text) TO authenticated;

CREATE FUNCTION public.save_role_permissions(p_changes jsonb)
RETURNS SETOF public.role_permissions LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_change record; v_current public.role_permissions%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only Superior Admin can change permissions' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid permission changes' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_changes) NOT BETWEEN 1 AND 3 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_changes) c
    WHERE c->>'role' IS NULL OR c->>'role' NOT IN ('group_admin', 'supervisor', 'agent')
      OR c->>'permission' IS DISTINCT FROM 'reset_password'
      OR c->>'mode' IS NULL OR c->>'mode' NOT IN ('direct', 'approval', 'deny')
      OR c->>'version' IS NULL
  ) OR (SELECT count(DISTINCT c->>'role') FROM jsonb_array_elements(p_changes) c) <> jsonb_array_length(p_changes) THEN
    RAISE EXCEPTION 'Invalid permission changes' USING ERRCODE = '22023';
  END IF;
  FOR v_change IN SELECT * FROM jsonb_to_recordset(p_changes) AS c(role public.app_role, permission text, mode text, version integer) ORDER BY role LOOP
    SELECT * INTO v_current FROM public.role_permissions WHERE role = v_change.role AND permission = v_change.permission FOR UPDATE;
    IF NOT FOUND OR v_current.version IS DISTINCT FROM v_change.version THEN
      RAISE EXCEPTION 'Permissions changed. Reload the saved permissions and try again.' USING ERRCODE = '40001';
    END IF;
    IF v_current.mode <> v_change.mode THEN
      UPDATE public.role_permissions SET mode = v_change.mode, version = version + 1, updated_by = auth.uid(), updated_at = now()
        WHERE role = v_change.role AND permission = v_change.permission;
      INSERT INTO public.role_permission_changes(role, permission, old_mode, new_mode, changed_by)
        VALUES (v_change.role, v_change.permission, v_current.mode, v_change.mode, auth.uid());
    END IF;
  END LOOP;
  RETURN QUERY SELECT * FROM public.role_permissions ORDER BY role;
END;
$$;
REVOKE ALL ON FUNCTION public.save_role_permissions(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_role_permissions(jsonb) TO authenticated;

CREATE FUNCTION public.get_password_reset_access(p_actor uuid, p_target uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT CASE WHEN public.can_manage_account(p_actor, p_target) THEN public.role_permission_mode(p_actor, 'reset_password') ELSE 'deny' END; $$;
REVOKE ALL ON FUNCTION public.get_password_reset_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_password_reset_access(uuid, uuid) TO authenticated, service_role;

-- Request creation is caller-bound and cannot be forged through table writes.
REVOKE INSERT, UPDATE, DELETE ON public.password_reset_requests FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.request_password_reset(p_target_user_id uuid, p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_request uuid;
BEGIN
  IF public.get_password_reset_access(auth.uid(), p_target_user_id) <> 'approval' THEN
    RAISE EXCEPTION 'You cannot request a password reset for this account' USING ERRCODE = '42501';
  END IF;
  IF char_length(coalesce(p_reason, '')) > 2000 THEN RAISE EXCEPTION 'Reason is too long' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':password-reset:' || p_target_user_id::text, 0));
  SELECT id INTO v_request FROM public.password_reset_requests
    WHERE requested_by = auth.uid() AND target_user_id = p_target_user_id AND status = 'pending' ORDER BY created_at LIMIT 1;
  IF v_request IS NULL THEN
    INSERT INTO public.password_reset_requests(target_user_id, requested_by, reason)
      VALUES (p_target_user_id, auth.uid(), nullif(btrim(p_reason), '')) RETURNING id INTO v_request;
  END IF;
  RETURN v_request;
END;
$$;
REVOKE ALL ON FUNCTION public.request_password_reset(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_password_reset(uuid, text) TO authenticated;

CREATE FUNCTION public.can_review_password_reset(p_actor uuid, p_request_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.password_reset_requests request
    LEFT JOIN public.user_roles requester ON requester.user_id = request.requested_by
    JOIN public.user_roles reviewer ON reviewer.user_id = p_actor
    WHERE request.id = p_request_id AND request.status = 'pending' AND request.requested_by <> p_actor
      AND public.role_permission_mode(p_actor, 'reset_password') = 'direct'
      AND public.can_manage_account(p_actor, request.target_user_id)
      AND public.can_manage_account(p_actor, request.requested_by)
      AND (CASE reviewer.role WHEN 'admin' THEN 0 WHEN 'group_admin' THEN 1 WHEN 'supervisor' THEN 2 WHEN 'agent' THEN 3 ELSE 4 END)
        < (CASE requester.role WHEN 'admin' THEN 0 WHEN 'group_admin' THEN 1 WHEN 'supervisor' THEN 2 WHEN 'agent' THEN 3 ELSE 4 END)
  );
$$;
REVOKE ALL ON FUNCTION public.can_review_password_reset(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_review_password_reset(uuid, uuid) TO authenticated, service_role;

ALTER TABLE public.password_reset_requests
  ADD COLUMN processing_token uuid,
  ADD COLUMN processing_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN processing_action text CHECK (processing_action IN ('approve', 'reject')),
  ADD COLUMN processing_started_at timestamptz;

-- Use a trusted internal lookup for the requester setting; the reviewer cannot
-- impersonate the requester when calling the public role_permission_mode RPC.
CREATE FUNCTION public.get_password_reset_review_permissions(p_request_ids uuid[])
RETURNS TABLE(request_id uuid, can_review boolean, can_approve boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT request.id, public.can_review_password_reset(auth.uid(), request.id) AND request.processing_token IS NULL,
    public.can_review_password_reset(auth.uid(), request.id) AND request.processing_token IS NULL
      AND coalesce((SELECT setting.mode FROM public.role_permissions setting JOIN public.user_roles role_row ON role_row.role = setting.role
                    WHERE role_row.user_id = request.requested_by AND setting.permission = 'reset_password'), 'deny') <> 'deny'
  FROM public.password_reset_requests request
  WHERE request.id = ANY(p_request_ids) AND public.can_access_account(auth.uid(), request.target_user_id);
$$;
REVOKE ALL ON FUNCTION public.get_password_reset_review_permissions(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_password_reset_review_permissions(uuid[]) TO authenticated;

-- Auth is an external service: claim each request before issuing an Auth write
-- so two reviewers cannot apply competing passwords to the same request.
CREATE FUNCTION public.claim_password_reset_request(p_actor uuid, p_request_id uuid, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_request public.password_reset_requests%ROWTYPE; v_token uuid := gen_random_uuid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF p_action NOT IN ('approve', 'reject') OR p_action IS NULL THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_request FROM public.password_reset_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_review_password_reset(p_actor, p_request_id) THEN
    RAISE EXCEPTION 'Request is outside your permissions or has already been processed' USING ERRCODE = '42501';
  END IF;
  IF v_request.processing_token IS NOT NULL THEN RAISE EXCEPTION 'This request is already being processed' USING ERRCODE = '55000'; END IF;
  IF p_action = 'approve' AND public.role_permission_mode(v_request.requested_by, 'reset_password') = 'deny' THEN
    RAISE EXCEPTION 'The requester no longer has password reset permission' USING ERRCODE = '42501';
  END IF;
  UPDATE public.password_reset_requests SET processing_token = v_token, processing_by = p_actor,
    processing_action = p_action, processing_started_at = now() WHERE id = p_request_id;
  RETURN jsonb_build_object('request_id', p_request_id, 'target_user_id', v_request.target_user_id, 'token', v_token);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_password_reset_request(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_password_reset_request(uuid, uuid, text) TO service_role;

CREATE FUNCTION public.finish_password_reset_request(p_actor uuid, p_request_id uuid, p_token uuid, p_success boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_request public.password_reset_requests%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_request FROM public.password_reset_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' OR v_request.processing_by IS DISTINCT FROM p_actor
     OR v_request.processing_token IS NULL OR v_request.processing_token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'Request claim is invalid' USING ERRCODE = '42501';
  END IF;
  UPDATE public.password_reset_requests SET
    status = CASE WHEN p_success THEN CASE v_request.processing_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END ELSE 'pending' END,
    processed_by = CASE WHEN p_success THEN p_actor ELSE NULL END,
    processed_at = CASE WHEN p_success THEN now() ELSE NULL END,
    processing_token = NULL, processing_by = NULL, processing_action = NULL, processing_started_at = NULL
  WHERE id = p_request_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_password_reset_request(uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_password_reset_request(uuid, uuid, uuid, boolean) TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.role_permissions;

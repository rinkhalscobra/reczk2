-- Creates only disposable fixtures and rolls back every write. No real client
-- is selected or changed. Run after the case-transfer migration.
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
DO $$
DECLARE
  v_admin uuid := gen_random_uuid(); v_manager uuid := gen_random_uuid();
  v_supervisor uuid := gen_random_uuid(); v_sibling_supervisor uuid := gen_random_uuid();
  v_agent_a uuid := gen_random_uuid(); v_agent_b uuid := gen_random_uuid();
  v_sibling_agent uuid := gen_random_uuid(); v_outside_agent uuid := gen_random_uuid();
  v_client uuid := gen_random_uuid(); v_other_client uuid := gen_random_uuid();
  v_office uuid := gen_random_uuid(); v_other_office uuid := gen_random_uuid();
  v_user uuid; v_saved text; v_row record; v_auth jsonb; v_balances jsonb;
  v_code_a text := 'Verify-A-' || v_agent_a; v_code_b text := 'Verify-B-' || v_agent_b;
  v_code_sibling text := 'Verify-Sibling-' || v_sibling_agent;
  v_code_outside text := 'Verify-Outside-' || v_outside_agent;
BEGIN
  FOREACH v_user IN ARRAY ARRAY[v_admin,v_manager,v_supervisor,v_sibling_supervisor,v_agent_a,v_agent_b,
    v_sibling_agent,v_outside_agent,v_client,v_other_client] LOOP
    INSERT INTO auth.users(id,email,raw_user_meta_data)
      VALUES(v_user,'case-transfer-' || v_user || '@example.test','{"case_transfer_verification":true}');
  END LOOP;
  INSERT INTO public.groups(id,name) VALUES(v_office,'Temporary case transfer verification'),
    (v_other_office,'Temporary outside office verification');
  UPDATE public.profiles SET group_id=v_office
    WHERE id=ANY(ARRAY[v_manager,v_supervisor,v_sibling_supervisor,v_agent_a,v_agent_b,v_sibling_agent,v_client,v_other_client]);
  UPDATE public.profiles SET group_id=v_other_office WHERE id=v_outside_agent;
  INSERT INTO public.user_roles(user_id,role) VALUES(v_admin,'admin'),(v_manager,'group_admin'),
    (v_supervisor,'supervisor'),(v_sibling_supervisor,'supervisor'),
    (v_agent_a,'agent'),(v_agent_b,'agent'),(v_sibling_agent,'agent'),(v_outside_agent,'agent');
  UPDATE public.profiles SET supervisor_id=v_supervisor WHERE id=ANY(ARRAY[v_agent_a,v_agent_b]);
  UPDATE public.profiles SET supervisor_id=v_sibling_supervisor WHERE id=v_sibling_agent;
  UPDATE public.agent_signup_codes SET code=CASE agent_id WHEN v_agent_a THEN v_code_a WHEN v_agent_b THEN v_code_b
    WHEN v_sibling_agent THEN v_code_sibling ELSE v_code_outside END
    WHERE agent_id=ANY(ARRAY[v_agent_a,v_agent_b,v_sibling_agent,v_outside_agent]);
  UPDATE public.profiles SET assigned_to=v_agent_a WHERE id=ANY(ARRAY[v_client,v_other_client]);
  SELECT to_jsonb(u) INTO v_auth FROM auth.users u WHERE id=v_client;
  SELECT jsonb_agg(to_jsonb(b) ORDER BY b.currency) INTO v_balances FROM public.customer_balances b WHERE customer_id=v_client;

  PERFORM set_config('request.jwt.claim.sub',v_manager::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_saved := public.set_client_case_number(v_client,' ' || lower(v_code_b) || ' ');
  SELECT * INTO v_row FROM public.profiles WHERE id=v_client;
  IF v_saved IS DISTINCT FROM v_code_b OR v_row.assigned_to IS DISTINCT FROM v_agent_b
    OR v_row.group_id IS DISTINCT FROM v_office THEN RAISE EXCEPTION 'Case transfer did not update assignment and spelling'; END IF;
  UPDATE public.profiles SET first_name='Verified',case_number=lower(v_code_a) WHERE id=v_client;
  SELECT * INTO v_row FROM public.profiles WHERE id=v_client;
  IF v_row.assigned_to IS DISTINCT FROM v_agent_a OR v_row.case_number IS DISTINCT FROM v_code_a
    THEN RAISE EXCEPTION 'Profile editor did not transfer the client'; END IF;
  BEGIN
    PERFORM public.set_client_case_number(v_client,v_code_outside);
    RAISE EXCEPTION 'Office isolation was bypassed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',v_supervisor::text,true);
  PERFORM public.set_client_case_number(v_client,v_code_b);
  BEGIN
    PERFORM public.set_client_case_number(v_client,v_code_sibling);
    RAISE EXCEPTION 'Supervisor isolation was bypassed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',v_agent_a::text,true);
  IF EXISTS(SELECT 1 FROM public.profiles WHERE id=v_client) THEN RAISE EXCEPTION 'Previous agent retained client access'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_agent_b::text,true);
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_client) THEN RAISE EXCEPTION 'New agent cannot access the client'; END IF;
  BEGIN
    PERFORM public.set_client_case_number(v_client,v_code_a);
    RAISE EXCEPTION 'Agent assignment restrictions were bypassed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM public.set_client_case_number(v_client,v_code_outside);
  SELECT * INTO v_row FROM public.profiles WHERE id=v_client;
  IF v_row.group_id IS DISTINCT FROM v_other_office OR v_row.assigned_to IS DISTINCT FROM v_outside_agent
    THEN RAISE EXCEPTION 'Superior Admin office transfer failed'; END IF;
  PERFORM public.set_client_case_number(v_client,v_code_b);
  PERFORM public.set_agent_case_code(v_agent_a,v_code_a || '-new');
  IF (SELECT case_number FROM public.profiles WHERE id=v_client) IS DISTINCT FROM v_code_b
    THEN RAISE EXCEPTION 'Previous agent still controls transferred client case'; END IF;
  PERFORM public.set_agent_case_code(v_agent_b,v_code_b || '-new');
  SELECT * INTO v_row FROM public.profiles WHERE id=v_client;
  IF v_row.case_number IS DISTINCT FROM v_code_b || '-new' OR v_row.assigned_to IS DISTINCT FROM v_agent_b
    THEN RAISE EXCEPTION 'New agent case change did not propagate'; END IF;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  IF (SELECT to_jsonb(u) FROM auth.users u WHERE id=v_client) IS DISTINCT FROM v_auth
    THEN RAISE EXCEPTION 'Case edits changed the Auth account'; END IF;
  IF (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.currency) FROM public.customer_balances b WHERE customer_id=v_client) IS DISTINCT FROM v_balances
    THEN RAISE EXCEPTION 'Case edits changed balances'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_client AND email=v_row.email AND case_number ILIKE v_code_b || '-new')
    OR EXISTS(SELECT 1 FROM public.profiles WHERE id=v_client AND case_number ILIKE v_code_b)
    THEN RAISE EXCEPTION 'Sign-in case resolution was not updated'; END IF;
END;
$$;
ROLLBACK;
SELECT true AS case_transfer_verified, true AS writes_rolled_back;

-- Staff can change only a client's case identifier inside their existing subtree.
-- login_email and Auth credentials remain stable; account-login resolves the new
-- email/case pair through profiles before authenticating the same Auth account.
CREATE FUNCTION public.set_client_case_number(p_customer_id uuid, p_case_number text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_case text := upper(btrim(p_case_number)); v_saved text;
BEGIN
  IF NOT public.can_manage_customer(auth.uid(), p_customer_id) THEN
    RAISE EXCEPTION 'Client is outside your permitted scope' USING ERRCODE = '42501';
  END IF;
  IF v_case IS NULL OR length(v_case) NOT BETWEEN 1 AND 100 OR v_case ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Case number must contain 1 to 100 characters without control characters';
  END IF;
  UPDATE public.profiles SET case_number = v_case
    WHERE id = p_customer_id AND NOT is_archived AND public.can_manage_customer(auth.uid(), id)
    RETURNING case_number INTO v_saved;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client is outside your permitted scope' USING ERRCODE = '42501'; END IF;
  RETURN v_saved;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This email and case number are already registered' USING ERRCODE = '23505';
END;
$$;
REVOKE ALL ON FUNCTION public.set_client_case_number(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_case_number(uuid,text) TO authenticated;

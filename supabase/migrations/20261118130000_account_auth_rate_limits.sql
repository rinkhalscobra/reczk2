CREATE TABLE public.account_auth_attempts (
  key_hash text PRIMARY KEY,
  attempts integer NOT NULL,
  window_started_at timestamptz NOT NULL
);
ALTER TABLE public.account_auth_attempts ENABLE ROW LEVEL SECURITY;
CREATE INDEX account_auth_attempts_expiry_idx ON public.account_auth_attempts (window_started_at);
REVOKE ALL ON public.account_auth_attempts FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.consume_account_auth_attempt(p_email_key text, p_ip_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_limit integer;
  v_attempts integer;
BEGIN
  IF p_email_key !~ '^[a-f0-9]{64}$' OR p_ip_key !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid rate limit key' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.account_auth_attempts WHERE window_started_at < now() - interval '1 day';
  FOR v_key, v_limit IN SELECT * FROM (VALUES (p_email_key, 10), (p_ip_key, 100)) limits(key_hash, max_attempts) ORDER BY key_hash LOOP
    INSERT INTO public.account_auth_attempts AS attempts (key_hash, attempts, window_started_at)
    VALUES (v_key, 1, now())
    ON CONFLICT (key_hash) DO UPDATE SET
      attempts = CASE WHEN attempts.window_started_at <= now() - interval '5 minutes' THEN 1 ELSE attempts.attempts + 1 END,
      window_started_at = CASE WHEN attempts.window_started_at <= now() - interval '5 minutes' THEN now() ELSE attempts.window_started_at END
    RETURNING attempts.attempts INTO v_attempts;
    IF v_attempts > v_limit THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_account_auth_attempt(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_account_auth_attempt(text, text) TO service_role;

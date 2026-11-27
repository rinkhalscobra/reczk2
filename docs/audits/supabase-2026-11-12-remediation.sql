-- Historical proposal for audit findings 2 and 3; retained for the audit trail.
-- Superseded by the deployed migration:
-- 20261112105626_fix_chat_access_rpc_permissions_and_realtime.sql
-- Use that migration as the source of truth; it also fixes chat access.

BEGIN;

-- Supabase's explicit anon grant survives REVOKE FROM PUBLIC.
REVOKE EXECUTE ON FUNCTION public.adjust_crypto_balance(uuid, text, text, text, numeric, text, text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.adjust_fiat_balance(uuid, text, numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_customer(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_crypto_balance(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_sessions_for_staff(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.review_kyc_submission(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_kyc_submission(uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_balance_dashboard_visibility(uuid, text, uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_managed_user_role(uuid, public.app_role) FROM PUBLIC, anon;

-- Existing authenticated/service_role grants are intentionally retained.

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['customer_notes', 'case_timeline', 'password_reset_requests']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$$;

COMMIT;

-- Keep uploads in the authenticated uploader's namespace and allow downloads
-- only to the owner, administrators, or authorized readers of a linked message.
DROP POLICY IF EXISTS "Users can upload their own attachments" ON storage.objects;
CREATE POLICY "Users can upload their own attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND owner_id = (SELECT auth.uid())::text
);

DROP POLICY IF EXISTS "Users can view attachments they sent or received" ON storage.objects;
CREATE POLICY "Users can view attachments they sent or received"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.messages message
      WHERE message.sender_id::text = (storage.foldername(objects.name))[1]
        AND CASE
          WHEN message.attachment_url = objects.name THEN true
          WHEN pg_input_is_valid(message.attachment_url, 'jsonb') THEN
            CASE WHEN jsonb_typeof(message.attachment_url::jsonb) = 'array'
              THEN message.attachment_url::jsonb ? objects.name
              ELSE false
            END
          ELSE false
        END
        AND (
          (SELECT auth.uid()) IN (message.sender_id, message.recipient_id)
          OR public.can_manage_customer((SELECT auth.uid()), message.sender_id)
          OR public.can_manage_customer((SELECT auth.uid()), message.recipient_id)
        )
    )
  )
);

-- The recipient's UPDATE policy is for read receipts. Prevent the recipient
-- from rewriting the sender or attachment reference to manufacture file access.
REVOKE UPDATE ON TABLE public.messages FROM PUBLIC, anon, authenticated;
GRANT UPDATE (is_read) ON TABLE public.messages TO authenticated;

-- PUBLIC and anon have separate grants under the project's Supabase defaults.
REVOKE EXECUTE ON FUNCTION public.adjust_crypto_balance(uuid, text, text, text, numeric, text, text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.adjust_fiat_balance(uuid, text, numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_customer(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_crypto_balance(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_sessions_for_staff(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.review_kyc_submission(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_kyc_submission(uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_balance_dashboard_visibility(uuid, text, uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_managed_user_role(uuid, public.app_role) FROM PUBLIC, anon;

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

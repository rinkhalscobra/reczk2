-- End-to-end KYC workflow for client submission and CRM review.
CREATE TABLE public.kyc_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'in_review', 'approved', 'rejected')),
  legal_first_name text,
  legal_last_name text,
  date_of_birth date,
  nationality text,
  country_of_residence text,
  residential_address text,
  city text,
  postal_code text,
  document_type text CHECK (document_type IS NULL OR document_type IN ('passport', 'national_id', 'drivers_license')),
  document_number text,
  document_front_path text,
  document_back_path text,
  proof_of_address_path text,
  rejection_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kyc_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers can view own KYC"
ON public.kyc_submissions FOR SELECT TO authenticated
USING (auth.uid() = customer_id);

CREATE POLICY "Admins can view all KYC"
ON public.kyc_submissions FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Group staff can view group KYC"
ON public.kyc_submissions FOR SELECT TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'group_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'supervisor'::public.app_role)
  )
  AND public.is_same_group(auth.uid(), customer_id)
);

CREATE POLICY "Assigned agents can view customer KYC"
ON public.kyc_submissions FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'agent'::public.app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = kyc_submissions.customer_id
      AND profiles.assigned_to = auth.uid()
  )
);

CREATE OR REPLACE FUNCTION public.can_manage_customer(p_actor uuid, p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
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
    );
$function$;

CREATE OR REPLACE FUNCTION public.save_kyc_submission(
  p_customer_id uuid,
  p_payload jsonb,
  p_submit boolean DEFAULT false
)
RETURNS public.kyc_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_customer boolean;
  v_is_staff boolean;
  v_existing public.kyc_submissions%ROWTYPE;
  v_result public.kyc_submissions%ROWTYPE;
  v_status text;
  v_prefix text := p_customer_id::text || '/';
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_is_customer := v_actor = p_customer_id;
  v_is_staff := public.can_manage_customer(v_actor, p_customer_id);
  IF NOT v_is_customer AND NOT v_is_staff THEN
    RAISE EXCEPTION 'You do not have permission to update this KYC record' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM public.kyc_submissions
  WHERE customer_id = p_customer_id
  FOR UPDATE;

  IF v_is_customer AND FOUND AND v_existing.status IN ('submitted', 'in_review', 'approved') THEN
    RAISE EXCEPTION 'This KYC submission is locked while it is under review or approved' USING ERRCODE = '55000';
  END IF;

  IF coalesce(p_payload->>'document_front_path', '') <> ''
    AND left(p_payload->>'document_front_path', char_length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'Invalid identity document path' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_payload->>'document_back_path', '') <> ''
    AND left(p_payload->>'document_back_path', char_length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'Invalid identity document path' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_payload->>'proof_of_address_path', '') <> ''
    AND left(p_payload->>'proof_of_address_path', char_length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'Invalid proof of address path' USING ERRCODE = '22023';
  END IF;

  IF p_submit AND (
    nullif(trim(p_payload->>'legal_first_name'), '') IS NULL
    OR nullif(trim(p_payload->>'legal_last_name'), '') IS NULL
    OR nullif(p_payload->>'date_of_birth', '') IS NULL
    OR nullif(trim(p_payload->>'nationality'), '') IS NULL
    OR nullif(trim(p_payload->>'country_of_residence'), '') IS NULL
    OR nullif(trim(p_payload->>'residential_address'), '') IS NULL
    OR nullif(trim(p_payload->>'city'), '') IS NULL
    OR nullif(trim(p_payload->>'postal_code'), '') IS NULL
    OR nullif(p_payload->>'document_type', '') IS NULL
    OR nullif(trim(p_payload->>'document_number'), '') IS NULL
    OR nullif(p_payload->>'document_front_path', '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Complete all required KYC fields and upload the identity document' USING ERRCODE = '22023';
  END IF;

  v_status := CASE
    WHEN p_submit THEN 'submitted'
    WHEN v_existing.id IS NULL THEN 'draft'
    WHEN v_is_customer AND v_existing.status = 'rejected' THEN 'draft'
    ELSE v_existing.status
  END;

  INSERT INTO public.kyc_submissions (
    customer_id, status, legal_first_name, legal_last_name, date_of_birth,
    nationality, country_of_residence, residential_address, city, postal_code,
    document_type, document_number, document_front_path, document_back_path,
    proof_of_address_path, rejection_reason, submitted_at, reviewed_at, reviewed_by
  ) VALUES (
    p_customer_id,
    v_status,
    nullif(trim(p_payload->>'legal_first_name'), ''),
    nullif(trim(p_payload->>'legal_last_name'), ''),
    nullif(p_payload->>'date_of_birth', '')::date,
    nullif(trim(p_payload->>'nationality'), ''),
    nullif(trim(p_payload->>'country_of_residence'), ''),
    nullif(trim(p_payload->>'residential_address'), ''),
    nullif(trim(p_payload->>'city'), ''),
    nullif(trim(p_payload->>'postal_code'), ''),
    nullif(p_payload->>'document_type', ''),
    nullif(trim(p_payload->>'document_number'), ''),
    nullif(p_payload->>'document_front_path', ''),
    nullif(p_payload->>'document_back_path', ''),
    nullif(p_payload->>'proof_of_address_path', ''),
    CASE WHEN p_submit THEN NULL ELSE v_existing.rejection_reason END,
    CASE WHEN p_submit THEN now() ELSE v_existing.submitted_at END,
    CASE WHEN p_submit THEN NULL ELSE v_existing.reviewed_at END,
    CASE WHEN p_submit THEN NULL ELSE v_existing.reviewed_by END
  )
  ON CONFLICT (customer_id) DO UPDATE SET
    status = EXCLUDED.status,
    legal_first_name = EXCLUDED.legal_first_name,
    legal_last_name = EXCLUDED.legal_last_name,
    date_of_birth = EXCLUDED.date_of_birth,
    nationality = EXCLUDED.nationality,
    country_of_residence = EXCLUDED.country_of_residence,
    residential_address = EXCLUDED.residential_address,
    city = EXCLUDED.city,
    postal_code = EXCLUDED.postal_code,
    document_type = EXCLUDED.document_type,
    document_number = EXCLUDED.document_number,
    document_front_path = EXCLUDED.document_front_path,
    document_back_path = EXCLUDED.document_back_path,
    proof_of_address_path = EXCLUDED.proof_of_address_path,
    rejection_reason = EXCLUDED.rejection_reason,
    submitted_at = EXCLUDED.submitted_at,
    reviewed_at = EXCLUDED.reviewed_at,
    reviewed_by = EXCLUDED.reviewed_by,
    updated_at = now()
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_kyc_submission(
  p_customer_id uuid,
  p_status text,
  p_rejection_reason text DEFAULT NULL
)
RETURNS public.kyc_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result public.kyc_submissions%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.can_manage_customer(v_actor, p_customer_id) THEN
    RAISE EXCEPTION 'You do not have permission to review this KYC record' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('in_review', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid KYC review status' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'rejected' AND nullif(trim(p_rejection_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A rejection reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_result
  FROM public.kyc_submissions
  WHERE customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KYC submission not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_status = 'approved' AND (
    v_result.legal_first_name IS NULL
    OR v_result.legal_last_name IS NULL
    OR v_result.date_of_birth IS NULL
    OR v_result.nationality IS NULL
    OR v_result.country_of_residence IS NULL
    OR v_result.residential_address IS NULL
    OR v_result.city IS NULL
    OR v_result.postal_code IS NULL
    OR v_result.document_type IS NULL
    OR v_result.document_number IS NULL
    OR v_result.document_front_path IS NULL
  ) THEN
    RAISE EXCEPTION 'Complete all required KYC fields before approval' USING ERRCODE = '22023';
  END IF;

  UPDATE public.kyc_submissions
  SET status = p_status,
      rejection_reason = CASE WHEN p_status = 'rejected' THEN trim(p_rejection_reason) ELSE NULL END,
      reviewed_at = CASE WHEN p_status IN ('approved', 'rejected') THEN now() ELSE NULL END,
      reviewed_by = v_actor,
      updated_at = now()
  WHERE customer_id = p_customer_id
  RETURNING * INTO v_result;

  IF p_status IN ('approved', 'rejected') THEN
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (
      p_customer_id,
      CASE WHEN p_status = 'approved' THEN 'success' ELSE 'error' END,
      CASE WHEN p_status = 'approved' THEN 'Identity verification approved' ELSE 'Identity verification needs attention' END,
      CASE
        WHEN p_status = 'approved' THEN 'Your KYC documents have been reviewed and approved.'
        ELSE trim(p_rejection_reason)
      END
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.can_manage_customer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_kyc_submission(uuid, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_kyc_submission(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_customer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_kyc_submission(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_kyc_submission(uuid, text, text) TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kyc-documents',
  'kyc-documents',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Customers can upload own KYC documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'kyc-documents'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.can_manage_customer(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
);

CREATE POLICY "Authorized users can read KYC documents"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'kyc-documents'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.can_manage_customer(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.kyc_submissions;

COMMENT ON TABLE public.kyc_submissions IS
  'One identity-verification application per customer, submitted by the client and reviewed by authorized CRM staff.';

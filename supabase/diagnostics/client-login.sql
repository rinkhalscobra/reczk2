-- Run in the Supabase SQL Editor. This query does not change any records and
-- never selects passwords, password hashes, tokens, or keys.
-- Change these two input values if needed.
WITH input(email, case_number) AS (
  VALUES ('tom2_696@hotmail.com'::text, 'Case@551'::text)
), matching_ids AS (
  SELECT profile.id FROM public.profiles profile, input
  WHERE lower(btrim(profile.email)) = lower(btrim(input.email))
  UNION
  SELECT account.id FROM auth.users account, input
  WHERE lower(btrim(account.email)) = lower(btrim(input.email))
     OR lower(btrim(account.raw_user_meta_data->>'display_email')) = lower(btrim(input.email))
)
SELECT
  matching_ids.id AS account_id,
  profile.id IS NOT NULL AS profile_exists,
  account.id IS NOT NULL AS auth_account_exists,
  profile.email AS saved_contact_email,
  profile.case_number AS saved_case_number,
  upper(btrim(profile.case_number)) = upper(btrim(input.case_number)) AS case_matches_input,
  account.id IS NOT NULL AND nullif(btrim(profile.login_email),'') IS NOT NULL
    AND lower(btrim(profile.login_email)) = lower(btrim(account.email)) AS auth_link_correct,
  nullif(to_jsonb(account)->>'email_confirmed_at','') IS NOT NULL AS email_confirmed,
  coalesce((to_jsonb(account)->>'banned_until')::timestamptz > now(),false) AS auth_account_blocked,
  coalesce(role_row.role::text,'user') AS account_role,
  profile.is_archived,
  profile.assigned_to AS assigned_agent_id,
  code.code AS current_agent_case_number,
  code.is_active AS agent_code_enabled,
  agent.status AS assigned_agent_status
FROM matching_ids
CROSS JOIN input
LEFT JOIN public.profiles profile ON profile.id = matching_ids.id
LEFT JOIN auth.users account ON account.id = matching_ids.id
LEFT JOIN public.user_roles role_row ON role_row.user_id = matching_ids.id
LEFT JOIN public.profiles agent ON agent.id = profile.assigned_to
LEFT JOIN public.agent_signup_codes code ON code.agent_id = agent.id
ORDER BY matching_ids.id;

# Case numbers for clients only - 19 November 2026

Applied `20261119100000_client_only_case_numbers.sql` to production project
`pbfdnjtkeveqeukbrfmk` after a successful rollback rehearsal. All 13 staff profiles
now have a null case number. The case numbers of all 28 clients are unchanged.

Admins, group admins, supervisors and agents use their normal email and password
without a case. The server resolves staff identities through a service-only
function, including accounts promoted from a client case. Existing MFA and
staff IP checks remain in place. New staff creation ignores client case inputs,
and staff invitations use normal Auth emails without client case metadata.

Database triggers derive client/staff status from trusted roles. Promotions clear
the case; demotions allocate a client case. Editable signup metadata cannot mark
a client as staff to avoid case assignment. Browser roles cannot invoke the
staff identity resolver.

Local verification passed: 127 backend/database tests, 60 browser tests,
TypeScript, ESLint, Deno checks and the browser production build. Browser coverage
includes email/password sign-in for all four CRM roles, staff invitation signup
without a case, and staff credential CSV exports without a case-number column.

Twenty live checks passed using three temporary accounts: client signup and case
login, rejection of a client signup without a case, promotion through all four
CRM roles and email/password login for each, staff creation with no case, staff
invitation signup/login, and demotion back to a client with a newly allocated
case. All temporary accounts, the temporary group and invitation were removed.

Final counts match the original baseline: 41 Auth users, 41 profiles, 13 role rows
and 123 balance rows. Client case and balance fingerprints are unchanged. There
are no staff cases, missing client cases, login mapping mismatches or pending
migrations. `create-user`, `account-login` and `register-client` were redeployed.

Frontend changes are ready locally, including the client-only case label and
staff credential export. Publishing the updated frontend remains a separate
release step, as recorded in the initial deployment.

Evidence: [sanitized verification](supabase-client-only-cases-2026-11-19-evidence.json).

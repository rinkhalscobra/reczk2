# Client accounts identified by email and case number

Client registration and staff **Create Client** accept an email already used by
another account. The existing account keeps its identity, password and data. The
new account receives an independent Auth identity and its own balances, case,
messages and permissions.

Clients register with their normal email, password and case number. To sign in,
they enter that same email, password and case number. Reusing an email is allowed
for a different case number. Registering the same email/case-number pair again
is rejected. Case numbers are trimmed and normalized to uppercase.

Internal Auth identities are derived from the email/case number by the backend and are never rendered
in the UI, including registration, CRM lists, customer details, and password dialogs.

The `account-login` function resolves the exact email/case-number pair and checks
only that account's password through Supabase Auth. There is no account chooser,
including when two cases have the same email and password. Admins, group admins,
supervisors and agents use email/password sign-in and have no case number. This
also applies to clients promoted to staff. The staff identity resolver is available
only to the service role. The login form uses a plain Case Number label without
staff-specific instructions; the backend recognizes staff credentials automatically.
MFA uses encrypted, short-lived
tickets bound to the selected account; passwords and sessions are not stored in
application tables. Rate limits apply before password checks and during MFA.
Staff IP validation still completes before dashboard access.

CRM customer lists and password dialogs show case numbers. Bulk client credentials
include the case number in their CSV export. Staff-created clients receive a case
number automatically when none is provided.

Staff creation ignores client case inputs, and staff credential exports contain
only email and password. Staff accounts are created through the CRM. Public
registration creates client accounts and always requires a case number.
Database role changes clear cases on promotion to staff and allocate a client
case on demotion. Editable user metadata cannot exempt a client from case assignment.

Password resets use the selected account's user ID. MFA is enforced for the exact
selected account before the backend releases a session. Staff account creation
continues to reject duplicate login emails.

## Deployment

The migrations and seven functions below were deployed to production on
19 November 2026. A follow-up migration removed case numbers from all 13 staff
profiles while preserving the 28 client case numbers. Live verification
passed, and existing account counts and balances were preserved. The hosted
frontend still needs the updated build deployed before it can show and submit
case numbers. See the [initial deployment](audits/supabase-case-numbers-2026-11-19.md)
and [client-only update](audits/supabase-client-only-cases-2026-11-19.md).

1. Apply `supabase/migrations/20261118120000_separate_client_contact_and_login_email.sql`.
   It backfills existing login identities without changing contact addresses.
2. Apply `supabase/migrations/20261118130000_account_auth_rate_limits.sql`.
3. Apply `supabase/migrations/20261118140000_client_case_identity.sql`. It preserves
   valid existing cases, assigns readable numbers to missing cases, and separates
   legacy duplicate email/case pairs before enforcing the unique constraint.
4. Apply `supabase/migrations/20261119100000_client_only_case_numbers.sql` to keep
   case numbers exclusive to clients and enable staff login after promotion.
5. Deploy `register-client`, `account-login`, `create-user`, `mfa-check`,
   `mfa-validate`, `mfa-setup`, and `validate-staff-ip`. Use the JWT settings for the public credential endpoints in
   `supabase/config.toml`; they validate credentials inside the functions.
6. Deploy the frontend build. Keep these changes together: the updated functions
   require the migration's internal `profiles.login_email` mapping.

Verification: `npm test`, `npm run test:browser`, `npx tsc --noEmit -p tsconfig.app.json`,
and `npm run lint`. Browser tests mock Supabase; database tests execute the real
migrations and row access policies in an isolated PostgreSQL environment.

## Changing a client case number

Admin, Group Admin, Supervisor, and Agent client lists include **Change case
number**. The same action is next to the case number in the client's profile.
Apply the case-number migrations through
`20261125093510_transfer_clients_by_case_number.sql` and deploy the frontend.
The `set_client_case_number` RPC authorizes the client through
`can_manage_customer` and returns the saved case number. Entering an active
agent's code, ignoring capitalization, transfers the client to that agent and
adopts the agent's exact case spelling. The same database trigger handles the
case field in the full profile editor. Both editors refresh the saved assignment.

Superior Admin can transfer clients between offices on the same platform.
Office admins can transfer within their office; supervisors can transfer between
their own agents. Agents cannot transfer client ownership, and clients cannot
edit their own case number. Destination agents must be active, not archived,
have an enabled code, and belong to a valid office on the client's platform.
Source and destination access checks prevent taking another staff member's
client. Unknown codes cannot replace an active agent's code. Independent cases
remain editable when the client has no active agent code. Archived clients,
blank values and duplicate contact-email/case pairs are rejected.

The Auth account and its `login_email` mapping stay unchanged. Clients sign in
with the new case number and their existing contact email and password; the old
case number stops resolving that account. Credentials, balances and case data
stay with the same account. A transfer updates the assigned agent and, for an
authorized office transfer, the office together; errors roll back all changes.
Case-number failures leave the editor and input open.

Changing an active agent's own case code updates their non-archived assigned
clients in that office, including dashboard displays and the sign-in case.
After a transfer the client follows the new agent's future code changes.
Inactive agents or disabled codes do not propagate edits until reactivated.

## Registration code retirement

Public registration uses email, password, and case number. Promo codes, agent
signup codes, and staff invitation registration have been removed from the website.
Client agent assignments remain managed through the CRM.

Deploy the updated `register-client` function and frontend, and apply
`supabase/migrations/20261122120000_retire_registration_codes.sql`. The migration
removes registration-code processing from account creation, stops generating
agent codes, and revokes website access to the retired code tables and validation
RPC. Historical records, existing accounts, and their assignments are preserved.

Migration `20261123120000_agent_case_codes.sql` preserves the historical AGT
values as agent case codes and resumes generating these identifiers
when an agent role is created. Admins, owning Group Admins, and assigned
Supervisors read them through an authorized RPC. The later active-agent
synchronization migration also links public registrations to the active agent
whose case code they enter. The underlying code table stays inaccessible to
browser roles.

If an Agent Dashboard shows `permission denied for table agent_signup_codes`,
check the frontend deployment: the older Agent page queried the retired table
alongside its client query, so that permission error blocked the entire dashboard.
The current Agent page reads only its profile and assigned clients. Deploy the
current frontend build and refresh open browser tabs. Keep the retired table's
access restrictions in place. A displayed zero during this load failure is an
initial empty count, rather than confirmation that assignments were deleted.
The subsequent `20261123130000_edit_agent_details.sql` migration enables scoped,
transactional editing of agent identifiers and groups. Redeploy `create-user`
for custom agent case numbers during creation; blank values still generate a code.

The subsequent [CRM hierarchy update](crm-hierarchy.md) restricts supervisors to
their assigned agents, enforces group isolation, and clears cross-group client
assignments. Follow its migration and deployment steps for the current RBAC rules.

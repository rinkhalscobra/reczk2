# Client case identity deployment - 19 November 2026

Follow-up: the [client-only update](supabase-client-only-cases-2026-11-19.md)
removed the case numbers assigned to staff during this initial deployment.

Production project `pbfdnjtkeveqeukbrfmk` now supports independent client accounts
sharing a contact email and using different case numbers. Client authentication
resolves the normalized email/case pair before checking that account's password.
The internal Supabase Auth address is separate from the displayed contact email.

## Database

Applied these migrations after a successful transaction rehearsal that rolled back:

- `20261118120000_separate_client_contact_and_login_email.sql`
- `20261118130000_account_auth_rate_limits.sql`
- `20261118140000_client_case_identity.sql`

The earlier `20261113120000_free_text_promocodes.sql` migration was already present
in the database but absent from migration history. Its constraints, index and
function definitions matched the local migration. Its history entry was marked
applied without rerunning its SQL.

All 41 existing profiles had missing case numbers and received readable case
numbers. Final checks found no missing cases, duplicate email/case pairs, or login
mapping mismatches. The case constraint and unique index are valid. Anonymous
callers cannot use the case allocator or rate-limit RPC, and browser roles cannot
access the rate-limit table. The final migration dry run reported no pending work.

## Functions

| Function | Deployed version | JWT verification |
| --- | --- | --- |
| `register-client` | 1 | Credentials checked inside endpoint |
| `account-login` | 1 | Credentials checked inside endpoint |
| `create-user` | 3 | Enabled |
| `mfa-check` | 2 | Enabled |
| `mfa-validate` | 2 | Enabled |
| `mfa-setup` | 2 | Enabled |
| `validate-staff-ip` | 2 | Enabled |

All seven functions are active. Public credential endpoints retain their configured
JWT settings; staff operations still require authenticated callers.

## Verification

Local verification passed: 119 backend/database tests, 54 browser tests,
TypeScript, ESLint and Deno edge-function checks.

Seventeen live checks passed, covering registration of two accounts with the same
email, independent sign-in using each case number, duplicate-pair rejection,
incorrect-case rejection, normal contact email display, isolation of profile
reads, client location validation, staff creation with an automatically assigned
case number, and password reset of one case without changing the other case's
password. The three temporary accounts used for these checks were removed.

Final counts match the original baseline: 41 Auth users, 41 profiles, 13 role rows
and 123 balance rows. The balance fingerprint also matches the baseline.

## Frontend release remaining

The hosted frontend at `https://www.clientzone.space/auth` was still serving the
previous build when checked. It did not contain the new case-number fields or
use `account-login`. The updated frontend must be released to complete the
case-number registration and login flow in the browser.

No access token, password, session, customer email or user ID is included in this
record. See [sanitized verification evidence](supabase-case-numbers-2026-11-19-evidence.json).

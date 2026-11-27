# Customer group controls — 12 November 2026

The customer profile now has an administrator-only **Group** selector above the profile fields. Administrators can select a same-platform group without choosing an agent, move a customer between groups, or select **No group**. The control is available while viewing or editing the profile. An assignment is retained only if its agent belongs to the destination group; otherwise it is cleared and the eligible agent list refreshes.

The selector calls `public.set_customer_group(uuid, uuid)`, deployed in [migration 20261112112432](../../supabase/migrations/20261112112432_customer_group_transfers.sql). This operation checks the caller's administrator role, rejects staff accounts as targets, validates the destination platform, locks the customer row, and updates group and agent together. Anonymous execution is revoked explicitly. Existing staff cannot gain group-transfer privileges by calling the RPC directly.

Live verification used the customer from the reported screenshot: group placement and removal both succeeded under authenticated administrator claims inside a transaction that was rolled back. The customer's chosen group and agent were preserved. The deployed SQL function matches the migration, and anonymous HTTP access returns 401.

Frontend changes include the Group selector and translations in English, French, German, and Italian, plus the prior assignment dropdown and error-message improvements. The UI is deployed by the repository's existing GitHub-to-Vercel integration.

Validation: 39 repository/database tests and the full 29-test browser suite passed. TypeScript, ESLint for changed source files, and the production Vite build passed. Browser checks cover group placement without an agent, removal, moving between groups with an incompatible agent, destination filtering, permission errors, and hiding the control from non-admin staff.

Verification evidence: [supabase-customer-groups-2026-11-12-evidence.json](supabase-customer-groups-2026-11-12-evidence.json).

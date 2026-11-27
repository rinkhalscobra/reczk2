# Agent assignment fix — 12 November 2026

The affected customer was created through public signup and had no CRM group. All available agents belonged to a group. The frontend updated only `assigned_to`, so the existing database trigger rejected the mismatch. The customer page also treated Supabase's plain error objects as unknown errors and displayed “Unexpected error” instead of the database message.

Applied [migration 20261112111311](../../supabase/migrations/20261112111311_assign_ungrouped_customers_to_agent_group.sql) to the live project. When an administrator first assigns an ungrouped client to an agent on the same platform, the assignment trigger now sets the client's group to that agent's group in the same update. Existing group boundaries remain enforced; this does not permit customers to assign themselves, staff to claim customers outside their scope, non-agents as assignees, or assignments across platforms. Unassignment retains the customer's group. Trusted service-role updates can use the same first-assignment path.

The fix is compatible with the existing deployed frontend. Assignment was verified against the affected customer using authenticated administrator claims in a transaction, and then rolled back. The customer's original unassigned state was preserved so the user can select their intended agent. The live function body and security settings match the migration. There are now 70 recorded migrations.

Local frontend improvements in [CustomerDetail.tsx](../../src/pages/CustomerDetail.tsx) filter the agent dropdown by platform and existing customer group, check that an assignment actually updates a visible record, and use the shared [error-message parser](../../src/lib/errorMessage.ts) to display plain Supabase error objects. These frontend changes have been tested locally and have not been deployed by this task.

Validation:

- Reproduced the original rejection with a failing database regression test before changing the trigger.
- All 30 database/access and existing repository tests passed, including eight assignment scenarios covering first assignment, group/platform isolation, unassignment, invalid assignees, customer self-assignment, staff scope, and authorized assignments within a group.
- All four new browser tests passed: assignment with the existing request payload, eligible choices for ungrouped and grouped customers, and displaying the actual database error.
- TypeScript check and production Vite build passed.
- Changed TypeScript files passed ESLint.

Machine-readable results: [supabase-assignment-fix-2026-11-12-evidence.json](supabase-assignment-fix-2026-11-12-evidence.json).

# Agent signup codes and administrator assignments — 12 November 2026

Administrators can now assign a customer to any agent independently of group or platform. Assignment preserves the customer's existing group and platform. Explicitly assigned agents can read their customers across those boundaries. Other staff retain their existing scope and assignment restrictions. Changing or removing a customer's group also preserves the administrator's chosen agent. These rules supersede the earlier group-coupled assignment behavior.

Each agent receives one unique, persistent `AGT-` signup code. Existing agents are backfilled; assigning the agent role to a new account automatically provisions a code. The admin **Agents** tab displays each agent's code and a copy button. An agent can also view and copy their own code from the agent dashboard.

Registration now exposes an optional promotional-code field:

- A valid agent code creates a client assigned to that agent, using the agent's current group and platform. It never grants a staff role.
- Omitting the code, or entering whitespace only, creates a customer with no group and no agent assignment. Client-supplied role, group, and assignee metadata is ignored.
- Invalid, disabled, archived-agent, inactive-agent, and former-agent codes are rejected. Failure rolls back account/profile creation.
- Existing group invitation codes continue to work with their configured roles and usage limits. Their signup counter update was corrected to avoid referencing a nonexistent `updated_at` column.

Agent codes use a separate, read-only-from-the-client table. Administrators can read all codes; an agent can read their own. Anonymous users cannot enumerate the table, and other staff/customers cannot read agent codes. The public validation RPC returns only validity and a generic message. The `AGT-` namespace is reserved to prevent collisions with group invitation codes.

Applied [migration 20261112132035](../../supabase/migrations/20261112132035_agent_signup_codes_and_admin_assignments.sql) and deployed `create-user` Edge Function version 2. The function permits administrator-created clients without a group and permits administrator assignment across groups, while maintaining non-admin restrictions. The deployed Edge source matches the local file and its JWT verification setting remains enabled.

Verification: all 61 backend/access/Edge-handler tests and all 35 browser tests passed, as did TypeScript, changed-source ESLint, and the production build. Live transaction checks verified code signup, blank signup, invalid-code rollback, new-agent code provisioning, and administrator assignment across groups. Verification records were rolled back; existing application records were preserved. All three existing agents have codes. Anonymous code enumeration returns 401, and unauthenticated customer creation is rejected.

Evidence: [supabase-agent-codes-2026-11-12-evidence.json](supabase-agent-codes-2026-11-12-evidence.json).

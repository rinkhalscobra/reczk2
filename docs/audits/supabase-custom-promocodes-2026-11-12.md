# Assign custom promotional codes to agents — 12 November 2026

The **Create New Promocode** dialog now includes **Assign to agent (optional)** for customer codes. An administrator can select any active agent, including agents in another group or with no group. Selecting an agent removes the separate group requirement. Group administrators see agents in their own group. Agent names include email addresses to distinguish accounts with similar names.

Customers registering with the custom code are assigned to that agent and inherit the agent's current group and platform. The code grants no staff role. The existing group invitation behavior remains available by leaving the agent unassigned and choosing a group. Staff invitation roles clear the agent selection and continue to require a group. Registration without any promotional code remains ungrouped and unassigned. The existing persistent `AGT-` agent codes continue to work.

The Promocodes tables now display **Assigned Agent**. Admin and group-admin dashboards retain the selected tab after a data refresh, allowing the created code and its agent to remain visible. Agent loading has a timeout and an explicit retry state. Duplicate-code and database errors keep the dialog open. Expiry timestamps are converted from the administrator's local input into UTC.

Applied [migration 20261112141232](../../supabase/migrations/20261112141232_promocode_agent_assignment.sql):

- Adds the optional `promocodes.agent_id` foreign key and permits a null group for agent codes. Codes must have either a group or an agent; agent codes must have the customer role.
- Validates active agent ownership and preserves group-staff scope at creation/update. Administrators may select any agent. The stored group is normalized to the selected agent's group.
- Resolves the agent's current group/platform at signup, rejects unavailable agents, and atomically enforces usage limits under a row lock. Disabled and expired codes remain invalid.
- Preserves existing code policies, public validation behavior, and existing group/staff invitations. Removing an agent profile also removes its custom codes.

Verification includes 83 backend/access tests and 45 browser tests, TypeScript, changed-source ESLint, and a production build. Backend checks cover arbitrary administrator agent selection, ungrouped agents, moved agents, usage limits, expiry, inactive/archived/demoted agents, role constraints, scope enforcement, and rejection of customer/agent writes. Browser checks cover choosing and displaying an agent, creating an ungrouped-agent code, legacy group invitations, changing the invited role, database errors, retrying agent loading, and retaining the Promocodes tab after creation.

A live authenticated administrator created a temporary custom code through the same REST path used by the UI. Supabase Auth account creation with that code produced the expected customer assignment and group/platform, increased usage to one, and caused subsequent code validation to reject the exhausted limit. A second account created without a code remained unassigned and could not set a staff role through metadata. All temporary accounts, the temporary administrator role, and the temporary code were deleted. Fresh before/after counts matched: 10 Auth users, 10 profiles, 5 role rows, 30 balance rows, 3 persistent agent codes, and 0 custom codes. Existing users and assignments were preserved.

Evidence: [supabase-custom-promocodes-2026-11-12-evidence.json](supabase-custom-promocodes-2026-11-12-evidence.json).

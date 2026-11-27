# Customer password changes — 12 November 2026

The administrator Customers table now exposes **Change password** on each customer row. The same dialog remains available under the customer's **User Access** tab. It accepts a new password and confirmation, requires at least eight characters, offers a cryptographically generated 16-character password, and clears its fields when closed. Labels and feedback are translated into English, French, German, and Italian.

The dialog calls the authenticated `reset-user-password` Edge Function. This function updates the target account with `auth.admin.updateUserById(userId, { password })` using the server-side service role. Passwords are never written to profiles, workflow tables, application logs, or responses. Successful changes affect subsequent password sign-ins; this feature does not promise immediate termination of every existing session.

The backend requires a verified user token and checks database roles. Administrators can change customer passwords across groups, including ungrouped customers. Group administrators and supervisors retain permission only for customer accounts in their own nonempty group. Agents, customers, and anonymous callers cannot directly change another account's password. Permission/profile lookup failures deny the request. The separate request-and-approval flow is unchanged.

The prior dialog's six-character minimum disagreed with the backend's eight-character minimum. Validation now agrees, confirmation prevents typos, and Supabase Auth policy errors are shown instead of a generic non-2xx error. Success requires both a confirmed target Auth user in the backend and an explicit success response in the dialog.

Deployed `reset-user-password` version 2 with JWT verification enabled. Downloaded its deployed bundle and verified that its original source matches the repository file. No database migration was necessary.

Validation passed:

- 73 backend/access/Edge-handler tests, including 12 password-handler tests.
- 39 browser tests, including customer-row submission, minimum length and confirmation, provider-error display, generation, visibility controls, clearing fields, and explicit success handling.
- TypeScript, ESLint for changed source/tests, production build, and whitespace checks.
- Real Supabase Auth verification with temporary administrator/customer accounts: initial password sign-in succeeded, the administrator changed the password through the deployed Edge Function, the old password returned `invalid_credentials`, and the new password signed into the same customer account. Anonymous and customer mutation attempts were rejected.

Both temporary accounts and their temporary administrator role were deleted. Before/after counts are identical: 9 Auth users, 9 profiles, 5 role rows, 27 balance rows, and 3 agent signup codes. Existing customer passwords were not changed by verification. No verification passwords, sessions, API keys, or temporary account emails are saved in this report.

Evidence: [supabase-password-control-2026-11-12-evidence.json](supabase-password-control-2026-11-12-evidence.json).

# Client case transfers — 25 November 2026

Deployed `20261125093510_transfer_clients_by_case_number.sql` to
`pbfdnjtkeveqeukbrfmk`. The deployed function body matches the local migration,
and its existing private trigger permissions remain in place.

Editing an existing client's case number to an active agent's code now changes
the assignment and case together. Matching ignores capitalization and adopts the
agent's displayed spelling. Both the case dialog and full profile editor follow
this rule. Case changes update the dashboard and subsequent sign-in resolution;
the Auth account, contact email, password and balances stay unchanged.

Superior Admin can transfer between offices on the same platform. Office admins
stay within their office and supervisors within their assigned agents. Agents
cannot transfer ownership. Both the source client and destination agent must be
within scope. Inactive or unavailable agents, archived clients and duplicate
email/case sign-ins are rejected atomically. Unknown independent cases remain
editable when the client has no active agent code.

The existing agent code propagation remains enabled. Transferred clients follow
the new agent's future changes, including the case used at sign-in, and no
longer follow their previous agent.

Verification: 196 backend tests, 9 targeted browser tests, TypeScript, targeted
ESLint and a production build passed. Before and after deployment, the live
database verification exercised RPC and profile edits, role isolation, office
transfers, old/new agent visibility, code propagation and unchanged Auth/balance
records using disposable fixtures in rolled-back transactions. No temporary
accounts remained. See the [deployment evidence](supabase-client-case-transfers-2026-11-25-evidence.json).

The editor now refreshes the saved assignment and explains the transfer in all
four interface languages. Those frontend changes require the site's normal
frontend deployment; no Edge Function changes are required.

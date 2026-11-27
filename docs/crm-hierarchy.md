# CRM hierarchy and authorization

Superior Admin → Groups → Group Admin → Supervisors → Agents → Clients.

The existing database role `admin` is displayed as **Superior Admin** and has
global CRM access. `group_admin` manages accounts and records only in their own
nonempty group. A group can have one Group Admin. `supervisor` can access only
agents whose `profiles.supervisor_id` points to them, and clients assigned to
those agents. `agent` can access only their assigned clients in the same group.
Client accounts have no staff role row and retain their own portal access.

From the Superior Admin **Groups** tab, click a group name, its agent count, or
**View** to open `/admin/groups/:groupId`. The group page shows admins,
supervisors, agents, clients, and their assignments. Agent client counts filter
the group's client list; client links open their existing workspaces. Search,
refresh, browser back, and returning to the Groups tab preserve navigation.
Group Admins may open only their own group. Reads use the existing database RLS;
the group page adds no elevated backend endpoint or new permission grants.

The Superior Admin and Group Admin **Supervisors** tables show each supervisor's
group and assigned agent count. Click the supervisor's name or count to open
their agents, then click an agent's name or client count to open assigned
clients. Agent names also open clients from the Agents tables and group pages.
Only nonarchived accounts appear. Client reads filter by both agent and group,
use existing RLS, and page through all results; failures show a retry action.

Customer rows in the Admin, Group Admin, and Supervisor dashboards display
**Assigned Agent**, **Group**, and **Assigned Supervisor**. The supervisor comes
from the client's assigned agent, rather than the account creator. On mobile,
the same details appear beneath the client's name. Agents tables also show
their group and supervisor. Unset links say Unassigned; missing or inconsistent
links say Not available. These displays use existing scoped profile/group reads.

Agents tables, assigned-client dialogs, and agent profiles display an
**Agent Case Code**, with copying and retry on lookup failure. Historical AGT
codes are preserved; missing codes are generated for current and newly created
agents. The `get_agent_case_codes` RPC checks the caller's staff role and existing
account scope; clients and agents cannot use it to enumerate codes. Agent
creation has a custom case-number field and a Generate button, with automatic
generation when left blank. It has no phone field; no phone is required.

The Agents table's pencil opens the agent editor for names, username, group,
supervisor, and case number. Only Superior Admin can move an agent between groups;
Group Admins and Supervisors edit only agents already in their assigned scope.
Group changes clear invalid supervisor and client assignments. The transactional
`update_managed_agent` RPC rolls back all changes on invalid assignments or duplicate
case numbers. `set_agent_case_code` validates and normalizes custom identifiers;
the underlying table remains inaccessible to browser roles.

An active agent's case code also controls their non-archived clients' dashboard
and sign-in case numbers. Editing the agent updates those clients together.
Changing a client's case to another active agent's code transfers that client
to the new agent and adopts the exact spelling of their code. The profile editor
and case-number dialog use the same database enforcement. Superior Admin may
transfer between offices on the same platform; office admins stay within their
office, and supervisors stay within their assigned agents. Agents cannot transfer
ownership. Both source and destination access are checked. Credentials and
balances stay with the same client, and duplicate sign-ins roll back the transfer.

## Database enforcement

Migration `20261122130000_strict_crm_hierarchy.sql` adds the explicit agent-to-
supervisor relationship and central, caller-bound account/customer predicates.
Restrictive RLS policies intersect existing permissions on profiles, roles,
sessions, balances, portfolios, notes, timelines, payment details, KYC, recovery
funds, transactions, notifications, messages, and password requests. Legacy
group-wide supervisor policies cannot widen access. Chat attachment access
inherits the authorized conversation scope; KYC files use the customer predicate.
Anonymous and authenticated clients cannot write IP audit logs.

Privileged balance, KYC, role, membership, and session RPCs enforce the same
scope. Account metadata RPCs cannot expose another group's membership. Clients
cannot modify operational profile fields such as published recovery results.
Public signup cannot create a staff role or trust assignment metadata. Entering
an active agent's case code links the client to that agent and their office.

Only Superior Admin and the owning Group Admin may assign agents to supervisors.
Assignments must stay in the same group and platform, including writes made by
the service role. Bulk supervisor assignment is transactional: one invalid
agent rolls back the whole operation. Role demotion clears obsolete hierarchy
links. Moving a supervisor or agent clears invalid downstream links. Moving a
client between groups clears the old agent assignment.

## Backend enforcement

`create-user` verifies the authenticated creator, group, agent ownership, and
supervisor before completing account creation. New agents require a same-group
supervisor; supervisor-created agents belong to that supervisor. Supervisors
can create clients only under their own agents. Auth users are removed if profile,
role, or supervisor initialization fails.

`reset-user-password`, `delete-user`, and `approve-password-reset` authenticate
the actor and check the central database predicate before their service-role
mutations. Missing authorization or authorization errors fail closed. Agent
password changes default to approval. Superior Admin can select direct access,
approval, or denial in the [Permissions component](permissions.md); these settings
cannot expand any role's assigned hierarchy scope.

## Existing accounts and deployment

Apply the registration-code retirement migration first, then the hierarchy
migration. Historical cross-group client assignments are cleared. Existing
agent ownership is backfilled only when `created_by` identifies a supervisor in
the same group and platform. Other agents remain unassigned to a supervisor and
are visible to Superior Admin and their Group Admin until explicitly assigned
in the Agents tab. No supervisor is chosen automatically.

Before production rollout, audit groups for multiple existing Group Admins and
resolve duplicates. The new triggers prevent additional conflicting appointments.
Review the agents without supervisors and the cross-group assignments that the
migration will clear. Deploy `create-user`, `reset-user-password`, `delete-user`,
and `approve-password-reset` together with the frontend after the migration.
The source changes and migration do not themselves update the hosted database.

Apply `20261123120000_agent_case_codes.sql` after the hierarchy and permissions
migrations, before deploying the frontend that displays agent identifiers.
This adds internal identifiers without restoring registration-code redemption.
Then apply `20261123130000_edit_agent_details.sql` and deploy `create-user` with
the updated frontend to enable custom case numbers during creation and editing.

## Verification

`npm test` exercises the actual migrations, PostgreSQL roles, RLS, privileged
RPCs, attachment policies, and Edge handlers. Two supervisors in the same group
and a second isolated group test allowed and denied reads and writes, forged
actor IDs, role changes, group moves, and authorization outages. Browser tests
cover scoped supervisor queries, supervisor assignment and errors, required
supervisor selection during agent creation, and same-group client assignments.

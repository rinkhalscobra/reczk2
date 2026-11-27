# Role permissions

Open **Superior Admin → Permissions** to configure **Reset passwords** for Group
Admin, Supervisor, and Agent. The modes are **Allow directly**, **Require approval**,
and **Deny**. Superior Admin always retains direct access and cannot be restricted
through this component. Defaults preserve the existing workflow: Group Admin and
Supervisor have direct access; Agent requires approval.

Settings apply to a role across its assigned users. They never grant access to
another group or supervisor's branch. `PermissionsSettings` saves changed rows
atomically through `save_role_permissions`, using versions to prevent concurrent
administrators from overwriting each other's edits. Every changed mode is audited
in `role_permission_changes`. Only Superior Admin can save settings or view the
audit history. Website roles cannot write the tables directly.

`useRolePermission` and the reusable `PasswordResetAction` component choose the
direct dialog, approval request, or disabled action. One application subscription
invalidates cached modes when permission settings change. Permission failures
display a retry action and expose no privileged fallback. The backend checks the
current setting again for every operation.

## Approval

Approval requests are submitted through the caller-bound `request_password_reset`
function. Repeated requests return an existing pending request rather than create
duplicates. A reviewer must have direct reset permission, manage both the requester
and target, and hold a higher role. Nobody can approve their own request. Revoking
the requester's permission blocks approval; an authorized manager can still reject
the request. Superior Admin has a **Password requests** tab; Group Admin and
Supervisor use their existing **Password Resets** tabs.

Case numbers accompany target contact details in the request and approval flows.
New passwords go only to Supabase Auth. Requests and permission history never
store or return the chosen password.

The approval function obtains a database claim before contacting Auth. This
prevents competing reviewers from applying different passwords to one request.
A confirmed Auth error releases the claim for a corrected retry. An uncertain
Auth outcome or a failed final status write retains the claim and reports that
Superior Admin must investigate. Claims do not automatically expire: inspect the
Auth outcome first, then use the service-only `finish_password_reset_request`
operation with the recorded actor, request ID, and token to finalize or release
the claim. Authenticated website users cannot perform this recovery themselves.

## Deployment

Apply `20261122140000_role_permissions.sql` after the registration-code retirement
and strict-hierarchy migrations. Deploy the updated `reset-user-password` and
`approve-password-reset` functions and the frontend together. The migration adds
the permission rows to Realtime and revokes direct website writes to password
reset requests. The updated request dialog uses the replacement RPC.

These are source changes; the hosted database and functions require deployment.

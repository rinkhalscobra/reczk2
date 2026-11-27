export const permissionModes = ['direct', 'approval', 'deny'] as const;
export type PermissionMode = typeof permissionModes[number];
export const managedPermissionRoles = ['group_admin', 'supervisor', 'agent'] as const;
export type ManagedPermissionRole = typeof managedPermissionRoles[number];
export const isPermissionMode = (value: unknown): value is PermissionMode =>
  typeof value === 'string' && permissionModes.includes(value as PermissionMode);

export interface RolePermission {
  role: ManagedPermissionRole;
  permission: 'reset_password';
  mode: PermissionMode;
  version: number;
  updated_at: string;
}

export function parseRolePermissions(value: unknown): RolePermission[] {
  if (!Array.isArray(value) || value.length !== managedPermissionRoles.length) throw new Error('Unable to load permissions');
  const rows = value as RolePermission[];
  if (new Set(rows.map(row => row.role)).size !== managedPermissionRoles.length || rows.some(row =>
    !managedPermissionRoles.includes(row.role) || row.permission !== 'reset_password' || !isPermissionMode(row.mode) || !Number.isInteger(row.version)
  )) throw new Error('Unable to load permissions');
  return rows;
}

export type AppRole = 'admin' | 'group_admin' | 'supervisor' | 'agent' | 'user';

export const roleHome: Record<AppRole, string> = {
  admin: '/admin',
  group_admin: '/group-admin',
  supervisor: '/supervisor',
  agent: '/agent',
  user: '/dashboard',
};

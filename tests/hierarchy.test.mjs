import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const migration = read('supabase/migrations/20261016140000_hierarchy_hardening.sql');
const app = read('src/App.tsx');
const auth = read('src/hooks/useAuth.tsx');
const createUserDialog = read('src/components/admin/CreateUserDialog.tsx');
const createClientDialog = read('src/components/admin/CreateClientDialog.tsx');
const customerDetail = read('src/pages/CustomerDetail.tsx');
const createUserFunction = read('supabase/functions/create-user/index.ts');
const maintenanceFunctions = [
  'delete-tk-agents',
  'purge-customers',
  'seed-demo-accounts',
  'seed-extra-admin',
  'seed-tk-extra-agents',
  'seed-tk-group',
  'seed-zyra-group',
  'temp-set-password',
];

test('one role per account is enforced', () => {
  assert.match(migration, /UNIQUE \(user_id\)/);
  assert.match(migration, /set_managed_user_role/);
  assert.match(migration, /DROP POLICY IF EXISTS "Admins can insert roles"/);
  assert.match(migration, /DROP POLICY IF EXISTS "Group Admins can update group member roles"/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.validate_promocode/);
  assert.match(migration, /NEW\.raw_user_meta_data->>'promocode'/);
  assert.match(migration, /IF v_target_role = p_role/);
});

test('legacy global policies are removed', () => {
  assert.match(migration, /DROP POLICY IF EXISTS "Staff can manage balances"/);
  assert.match(migration, /DROP POLICY IF EXISTS "Staff can manage notifications"/);
  assert.match(migration, /DROP POLICY IF EXISTS "Users can send messages"/);
});

test('passwords and session tokens are not stored in workflow tables', () => {
  assert.match(migration, /DROP COLUMN IF EXISTS new_password_hash/);
  assert.match(migration, /DROP COLUMN IF EXISTS access_token/);
  assert.doesNotMatch(customerDetail, /session\.access_token/);
});

test('staff creation calls the protected backend function', () => {
  assert.match(createUserDialog, /functions\.invoke\('create-user'/);
});

test('non-agent creators do not become the default client assignee', () => {
  assert.match(createClientDialog, /defaultAssignedTo \|\| null/);
  assert.doesNotMatch(createClientDialog, /defaultAssignedTo \|\| user\?\.id/);
  assert.match(createUserFunction, /assigneeRole\?\.role !== "agent"/);
});

test('CRM routes have centralized role guards', () => {
  assert.match(app, /RoleRoute allowedRoles=\{\["admin"\]\}/);
  assert.match(app, /"admin", "group_admin", "supervisor", "agent"/);
  assert.match(app, /path="\/dashboard" element=\{<RoleRoute allowedRoles=\{\["user"\]\}/);
});

test('staff IP validation runs after password authentication', () => {
  assert.match(auth, /functions\.invoke\('validate-staff-ip'/);
  assert.match(auth, /validation\?\.allowed !== true/);
});

test('customer session metadata uses the scoped RPC', () => {
  assert.match(customerDetail, /rpc\('get_user_sessions_for_staff'/);
  assert.doesNotMatch(customerDetail, /from\('user_sessions'\)\.select\('\*'\)/);
});

test('service-role maintenance endpoints require an administrator', () => {
  for (const functionName of maintenanceFunctions) {
    const source = read(`supabase/functions/${functionName}/index.ts`);
    assert.match(source, /isAdminRequest\(req,/);
  }
});

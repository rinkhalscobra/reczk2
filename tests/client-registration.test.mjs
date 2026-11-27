import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createSupabaseTestDatabase } from './helpers/supabaseTestDatabase.mjs';

const id = value => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const [admin, agent, otherAgent, customer, supervisor] = [1, 2, 3, 4, 5].map(id);
const [group, otherGroup] = [101, 102].map(id);
let db;
let existingAgentCode;
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];

async function asUser(user, action) {
  await db.exec('SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false)", [user]);
  try { return await action(); }
  finally {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'service_role', false)");
  }
}

async function signup(value, metadata = {}) {
  const user = id(value);
  await db.exec("SELECT set_config('request.jwt.claim.role', '', false)");
  try {
    await db.query('INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)',
      [user, `signup-${user}@example.test`, metadata]);
  } finally { await db.exec("SELECT set_config('request.jwt.claim.role', 'service_role', false)"); }
  return (await db.query('SELECT * FROM profiles WHERE id = $1', [user])).rows[0];
}

before(async () => {
  db = await createSupabaseTestDatabase({ beforeMigration: async (database, name) => {
    if (name !== '20261122120000_retire_registration_codes.sql') return;
    await database.exec("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
    for (const user of [admin, agent, otherAgent, customer, supervisor]) {
      await database.query("INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{}')",
        [user, `fixture-${user}@example.test`]);
    }
    await database.query("INSERT INTO groups (id, name) VALUES ($1, 'Group A'), ($2, 'Group B')", [group, otherGroup]);
    for (const [user, role, groupId] of [[admin, 'admin', group], [agent, 'agent', group], [otherAgent, 'agent', otherGroup], [supervisor, 'supervisor', group]]) {
      await database.query('UPDATE profiles SET group_id = $1 WHERE id = $2', [groupId, user]);
      await database.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [user, role]);
    }
    await database.query('UPDATE profiles SET group_id = $1, assigned_to = $2 WHERE id = $3', [group, agent, customer]);
    await database.query("INSERT INTO promocodes (code, group_id, role_type) VALUES ('OLD-STAFF', $1, 'agent'), ('OLD-CLIENT', $1, 'user')", [group]);
    existingAgentCode = (await database.query('SELECT code FROM agent_signup_codes WHERE agent_id = $1', [agent])).rows[0].code;
  } });
});
after(async () => { await db?.close(); });

test('retiring codes preserves existing accounts, agent assignments, and historical records', async () => {
  assert.equal(await scalar('SELECT count(*)::int FROM auth.users'), 5);
  assert.equal(await scalar('SELECT assigned_to FROM profiles WHERE id = $1', [customer]), agent);
  assert.equal(await scalar('SELECT group_id FROM profiles WHERE id = $1', [customer]), group);
  assert.equal(await scalar('SELECT role FROM user_roles WHERE user_id = $1', [agent]), 'agent');
  assert.equal(await scalar('SELECT count(*)::int FROM promocodes'), 2);
  assert.equal(await scalar('SELECT count(*)::int FROM agent_signup_codes'), 2);
  assert.equal(await scalar('SELECT code FROM agent_signup_codes WHERE agent_id = $1', [agent]), existingAgentCode);
});

test('public signup creates an unassigned client and retains the requested case number', async () => {
  const profile = await signup(201, { first_name: 'New', last_name: 'Client', display_email: 'contact@example.test', case_number: ' client-case ' });
  assert.equal(profile.email, 'contact@example.test');
  assert.equal(profile.case_number, 'client-case');
  assert.equal(profile.assigned_to, null);
  assert.equal(profile.group_id, null);
  assert.equal(await scalar('SELECT count(*)::int FROM user_roles WHERE user_id = $1', [profile.id]), 0);
});

test('old staff, client, and agent codes cannot assign customers or grant a staff role', async () => {
  for (const [index, code] of ['OLD-STAFF', 'OLD-CLIENT', existingAgentCode, 'INVALID'].entries()) {
    const profile = await signup(210 + index, { promocode: code, role: 'admin', group_id: group, assigned_to: agent, case_number: `CASE-${index}` });
    assert.equal(profile.assigned_to, null);
    assert.equal(profile.group_id, null);
    assert.equal(profile.case_number, `CASE-${index}`);
    assert.equal(await scalar('SELECT count(*)::int FROM user_roles WHERE user_id = $1', [profile.id]), 0);
  }
  assert.equal(await scalar('SELECT sum(times_used)::int FROM promocodes'), 0);
});

test('code validation and code tables are inaccessible to website roles', async () => {
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await scalar("SELECT has_function_privilege($1, 'public.validate_promocode(text)', 'EXECUTE')", [role]), false);
    for (const table of ['promocodes', 'agent_signup_codes']) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        assert.equal(await scalar('SELECT has_table_privilege($1, $2, $3)', [role, table, privilege]), false);
      }
    }
  }
  assert.equal(await scalar('SELECT is_valid FROM validate_promocode($1)', [existingAgentCode]), false);
});

test('creating an agent generates an identifier without allocating a client case number', async () => {
  const profile = await signup(220);
  await db.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'agent')", [profile.id]);
  assert.match(await scalar('SELECT code FROM agent_signup_codes WHERE agent_id = $1', [profile.id]), /^AGT-[A-F0-9]{12}$/);
  assert.equal(await scalar('SELECT case_number FROM profiles WHERE id = $1', [profile.id]), null);
});

test('Superior Admin cannot reassign a client across their group boundary', async () => {
  const profile = await signup(230);
  await db.query('UPDATE profiles SET group_id = $1, assigned_to = $2 WHERE id = $3', [group, agent, profile.id]);
  await asUser(admin, () => assert.rejects(db.query('UPDATE profiles SET assigned_to = $1 WHERE id = $2', [otherAgent, profile.id]), /same group/));
  assert.equal(await scalar('SELECT assigned_to FROM profiles WHERE id = $1', [profile.id]), agent);
  assert.equal(await scalar('SELECT group_id FROM profiles WHERE id = $1', [profile.id]), group);
});

test('group staff still cannot assign a client to an agent outside their group', async () => {
  const profile = await signup(231);
  await db.query('UPDATE profiles SET group_id = $1, assigned_to = $2 WHERE id = $3', [group, agent, profile.id]);
  await db.query('UPDATE profiles SET supervisor_id=$1 WHERE id=$2', [supervisor, agent]);
  await asUser(supervisor, () => assert.rejects(db.query('UPDATE profiles SET assigned_to = $1 WHERE id = $2', [otherAgent, profile.id]), /same group/));
});

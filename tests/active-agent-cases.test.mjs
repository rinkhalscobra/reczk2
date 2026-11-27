import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createSupabaseTestDatabase } from './helpers/supabaseTestDatabase.mjs';

const id = n => `34000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [admin, agent, otherAgent, client, legacyClient, otherOfficeClient, archivedClient] = [1,2,3,4,5,6,7].map(id);
const [office, otherOffice] = [101,102].map(id);
let db;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const profile = async user => (await db.query('SELECT * FROM profiles WHERE id=$1', [user])).rows[0];
const rollback = async action => { await db.exec('BEGIN'); try { await action(); } finally { await db.exec('ROLLBACK'); } };
async function signup(user, caseNumber, metadata = {}) {
  await db.exec("SELECT set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)");
  try {
    await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,$2,$3)', [
      user, `client-${user}@example.test`, { case_number: caseNumber, ...metadata },
    ]);
  } finally { await db.exec("SELECT set_config('request.jwt.claim.role', 'service_role', false)"); }
}
async function editCode(value) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false)", [admin]);
  let failed = false;
  try { await db.query("SELECT update_managed_agent($1,'Agent','One','agent-one',$2,NULL,$3)", [agent, office, value]); }
  catch (error) { failed = true; throw error; }
  finally {
    try { await db.exec("SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'service_role', false)"); }
    catch (error) { if (!failed) throw error; }
  }
}

before(async () => {
  db = await createSupabaseTestDatabase({ beforeMigration: async (database, name) => {
    if (name !== '20261123170000_sync_active_agent_client_cases.sql') return;
    await database.exec("SELECT set_config('request.jwt.claim.role','service_role',false)");
    for (const user of [admin, agent, otherAgent, legacyClient, otherOfficeClient, archivedClient]) {
      await database.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,$2,$3)', [
        user, `fixture-${user}@example.test`, { case_number: 'case@552' },
      ]);
    }
    await database.query("INSERT INTO groups(id,name) VALUES ($1,'Office One'),($2,'Office Two')", [office, otherOffice]);
    await database.query('UPDATE profiles SET group_id=$1 WHERE id=ANY($2::uuid[])', [office, [agent, otherAgent]]);
    await database.query("INSERT INTO user_roles(user_id,role) VALUES ($1,'admin'),($2,'agent'),($3,'agent')", [admin, agent, otherAgent]);
    await database.query("UPDATE agent_signup_codes SET code='CASE@552' WHERE agent_id=$1", [agent]);
    await database.query('UPDATE profiles SET group_id=$1 WHERE id=$2', [otherOffice, otherOfficeClient]);
    await database.query('UPDATE profiles SET is_archived=true WHERE id=$1', [archivedClient]);
    assert.equal((await database.query('SELECT assigned_to FROM profiles WHERE id=$1', [legacyClient])).rows[0].assigned_to, null);
  } });
  await signup(client, 'case@552', { role: 'admin', platform: 'chargeback', group_id: otherOffice, assigned_to: otherAgent });
});
after(async () => { await db?.close(); });

test('migration links existing matching unassigned clients and keeps other offices and archived clients untouched', async () => {
  const linked = await profile(legacyClient);
  assert.equal(linked.assigned_to, agent);
  assert.equal(linked.group_id, office);
  assert.equal(linked.case_number, 'CASE@552');
  assert.equal((await profile(otherOfficeClient)).assigned_to, null);
  assert.equal((await profile(archivedClient)).assigned_to, null);
});

test('signup with an active case number links only the trusted agent and office and adopts its exact spelling', async () => {
  const linked = await profile(client);
  assert.equal(linked.assigned_to, agent);
  assert.equal(linked.group_id, office);
  assert.equal(linked.platform, 'brightfund');
  assert.equal(linked.case_number, 'CASE@552');
  assert.equal(await scalar('SELECT count(*)::int FROM user_roles WHERE user_id=$1', [client]), 0);
});

test('editing the agent changes all linked client cases atomically while preserving Auth accounts and ownership', async () => {
  await rollback(async () => {
    const authBefore = (await db.query('SELECT * FROM auth.users WHERE id=ANY($1::uuid[]) ORDER BY id', [[client, legacyClient]])).rows;
    const loginBefore = await scalar('SELECT login_email FROM profiles WHERE id=$1', [client]);
    await editCode('Case@553');
    for (const user of [client, legacyClient]) {
      const linked = await profile(user);
      assert.equal(linked.case_number, 'Case@553');
      assert.equal(linked.assigned_to, agent);
      assert.equal(linked.group_id, office);
    }
    assert.equal(await scalar("SELECT count(*)::int FROM profiles WHERE id=$1 AND case_number ILIKE 'CASE@553'", [client]), 1);
    assert.equal(await scalar("SELECT count(*)::int FROM profiles WHERE id=$1 AND case_number ILIKE 'CASE@552'", [client]), 0);
    assert.equal(await scalar('SELECT login_email FROM profiles WHERE id=$1', [client]), loginBefore);
    assert.deepEqual((await db.query('SELECT * FROM auth.users WHERE id=ANY($1::uuid[]) ORDER BY id', [[client, legacyClient]])).rows, authBefore);
  });
});

test('inactive codes and inactive agents do not assign signups or propagate until reactivated', async () => {
  for (const field of ['code', 'agent']) await rollback(async () => {
    if (field === 'code') await db.query('UPDATE agent_signup_codes SET is_active=false WHERE agent_id=$1', [agent]);
    else await db.query("UPDATE profiles SET status='inactive' WHERE id=$1", [agent]);
    await signup(id(20), 'case@552');
    assert.equal((await profile(id(20))).assigned_to, null);
    await editCode('Case@553');
    assert.equal((await profile(client)).case_number, 'CASE@552');
    if (field === 'code') await db.query('UPDATE agent_signup_codes SET is_active=true WHERE agent_id=$1', [agent]);
    else await db.query("UPDATE profiles SET status='active' WHERE id=$1", [agent]);
    assert.equal((await profile(client)).case_number, 'Case@553');
  });
});

test('changing an agent code connects legacy unassigned clients with its previous code without taking another agents clients', async () => {
  await rollback(async () => {
    await db.query('UPDATE profiles SET assigned_to=NULL WHERE id=$1', [legacyClient]);
    await db.query('UPDATE profiles SET group_id=$1,assigned_to=$2 WHERE id=$3', [office, otherAgent, otherOfficeClient]);
    const otherCase = (await profile(otherOfficeClient)).case_number;
    await editCode('Case@553');
    assert.equal((await profile(legacyClient)).assigned_to, agent);
    assert.equal((await profile(legacyClient)).case_number, 'Case@553');
    assert.equal((await profile(otherOfficeClient)).assigned_to, otherAgent);
    assert.equal((await profile(otherOfficeClient)).case_number, otherCase);
  });
});

test('duplicate client sign-ins roll back the agent edit and every client update', async () => {
  await rollback(async () => {
    await signup(id(30), 'Case@553');
    await db.query('UPDATE profiles SET email=$1 WHERE id=$2', [(await profile(client)).email, id(30)]);
    await db.exec('SAVEPOINT case_collision');
    await assert.rejects(editCode('Case@553'), /duplicate client sign-ins/);
    await db.exec('ROLLBACK TO SAVEPOINT case_collision');
    assert.equal(await scalar('SELECT code FROM agent_signup_codes WHERE agent_id=$1', [agent]), 'CASE@552');
    assert.equal((await profile(client)).case_number, 'CASE@552');
    assert.equal((await profile(legacyClient)).case_number, 'CASE@552');
  });
});

test('private synchronization helpers cannot be invoked by website users', async () => {
  for (const role of ['anon','authenticated']) {
    for (const name of ['active_agent_case(uuid)', 'sync_agent_case_clients(uuid,text)']) {
      assert.equal(await scalar('SELECT has_function_privilege($1,$2,\'EXECUTE\')', [role, `public.${name}`]), false);
    }
  }
});

test('a linked client rejects unknown cases and explicit reassignment adopts the new agent code', async () => {
  await rollback(async () => {
    await db.exec('SAVEPOINT managed_case');
    await assert.rejects(db.query('UPDATE profiles SET case_number=$1 WHERE id=$2', ['different-case',client]), /active agent/);
    await db.exec('ROLLBACK TO SAVEPOINT managed_case');
    const expected = await scalar('SELECT code FROM agent_signup_codes WHERE agent_id=$1', [otherAgent]);
    await db.query('UPDATE profiles SET assigned_to=$1 WHERE id=$2', [otherAgent,client]);
    assert.equal((await profile(client)).case_number, expected);
    await editCode('Case@553');
    assert.equal((await profile(client)).case_number, expected);
    assert.equal((await profile(client)).assigned_to, otherAgent);
  });
});

test('the real login handler accepts the propagated case and rejects the old case for the same Auth account', async () => {
  await rollback(async () => {
    const loginEmail = await scalar('SELECT login_email FROM profiles WHERE id=$1', [client]);
    await editCode('Case@553');
    let handler;
    const sdk = {
      rpc: async () => ({ data: true, error: null }),
      from(table) {
        const filters = {};
        const query = {
          select() { return query; }, ilike(key,value) { filters[key] = value; return query; },
          eq(key,value) { filters[key] = value; return query; }, limit() { return query; },
          maybeSingle: async () => ({ data: { is_enabled: false }, error: null }),
          then(resolve,reject) {
            return db.query('SELECT id,login_email FROM profiles WHERE email ILIKE $1 AND case_number ILIKE $2', [filters.email,filters.case_number])
              .then(result => ({ data: result.rows, error: null })).then(resolve,reject);
          },
        };
        assert.ok(['profiles','user_mfa'].includes(table));
        return query;
      },
      auth: { signInWithPassword: async ({email,password}) => email === loginEmail && password === 'test-password' ? ({ data: {
        user: { id: client }, session: { user: { id: client, email }, access_token: 'test-session' },
      }, error: null }) : ({ data: {}, error: { code: 'invalid_credentials', status: 400 } }) },
    };
    const files = ['_shared/authGateway', '_shared/clientAccounts', 'account-login/index'];
    const source = files.map(file => readFileSync(new URL(`../supabase/functions/${file}.ts`, import.meta.url), 'utf8').replace(/^import[^\n]+\n/gm,'').replace(/export /g,'')).join('\n');
    const compiled = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
    vm.runInNewContext(compiled, { Request, Response, TextEncoder, Uint8Array, crypto: globalThis.crypto,
      createClient: () => sdk, Deno: { env: { get: () => 'test-only' }, serve: callback => { handler = callback; } },
    });
    for (const [caseNumber, expected] of [['case@553',200],['CASE@552',401]]) {
      const response = await handler(new Request('https://example.test/account-login', {method:'POST',body:JSON.stringify({email:(await profile(client)).email,password:'test-password',caseNumber})}));
      assert.equal(response.status, expected);
    }
  });
});

import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createSupabaseTestDatabase } from './helpers/supabaseTestDatabase.mjs';

const id = n => `35000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [admin, manager, supervisor, siblingSupervisor, agentA, agentB, siblingAgent, outsideAgent,
  client, otherClient, unassigned, outsideClient] = Array.from({ length: 12 }, (_, n) => id(n + 1));
const [office, outsideOffice] = [id(101), id(102)];
let db;
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const profile = async user => (await db.query('SELECT * FROM profiles WHERE id=$1', [user])).rows[0];
const transfer = (user, code) => scalar('SELECT set_client_case_number($1,$2)', [user, code]);
async function asUser(actor, action) {
  await db.exec('SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','authenticated',false)", [actor]);
  try { return await action(); }
  finally { await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','service_role',false)"); }
}
async function rollback(action) {
  await db.exec('BEGIN');
  try { await action(); } finally { await db.exec('ROLLBACK'); }
}
async function reject(actor, action, message) {
  await asUser(actor, async () => {
    await db.exec('SAVEPOINT rejected_transfer');
    await assert.rejects(async () => {
      try { await action(); }
      catch (error) { await db.exec('ROLLBACK TO SAVEPOINT rejected_transfer'); throw error; }
    }, message);
    await db.exec('RELEASE SAVEPOINT rejected_transfer');
  });
}

before(async () => {
  db = await createSupabaseTestDatabase();
  for (const user of [admin, manager, supervisor, siblingSupervisor, agentA, agentB, siblingAgent,
    outsideAgent, client, otherClient, unassigned, outsideClient]) {
    await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,$2,'{}')", [user, `transfer-${user}@example.test`]);
  }
  await db.query("INSERT INTO groups(id,name) VALUES ($1,'Transfer office'),($2,'Other transfer office')", [office, outsideOffice]);
  for (const user of [manager, supervisor, siblingSupervisor, agentA, agentB, siblingAgent, client, otherClient, unassigned]) {
    await db.query('UPDATE profiles SET group_id=$1 WHERE id=$2', [office, user]);
  }
  for (const user of [outsideAgent, outsideClient]) await db.query('UPDATE profiles SET group_id=$1 WHERE id=$2', [outsideOffice, user]);
  for (const [user, role] of [[admin,'admin'],[manager,'group_admin'],[supervisor,'supervisor'],[siblingSupervisor,'supervisor'],
    [agentA,'agent'],[agentB,'agent'],[siblingAgent,'agent'],[outsideAgent,'agent']]) {
    await db.query('INSERT INTO user_roles(user_id,role) VALUES ($1,$2)', [user, role]);
  }
  for (const [agent, parent, code] of [[agentA,supervisor,'Case@551'],[agentB,supervisor,'Case@552'],
    [siblingAgent,siblingSupervisor,'Case@553'],[outsideAgent,null,'Case@554']]) {
    await db.query('UPDATE profiles SET supervisor_id=$1 WHERE id=$2', [parent, agent]);
    await db.query('UPDATE agent_signup_codes SET code=$1 WHERE agent_id=$2', [code, agent]);
  }
  for (const [user, agent] of [[client,agentA],[otherClient,agentB],[outsideClient,outsideAgent]]) {
    await db.query('UPDATE profiles SET assigned_to=$1 WHERE id=$2', [agent, user]);
  }
});
after(async () => { await db?.close(); });

test('client case edits transfer ownership, preserve credentials and balances, and switch the sign-in case atomically', async () => {
  for (const actor of [admin, manager, supervisor]) await rollback(async () => {
    const original = await profile(client);
    const authBefore = (await db.query('SELECT * FROM auth.users WHERE id=$1', [client])).rows;
    const balancesBefore = (await db.query('SELECT * FROM customer_balances WHERE customer_id=$1 ORDER BY currency', [client])).rows;
    assert.equal(await asUser(actor, () => transfer(client, ' case@552 ')), 'Case@552');
    const moved = await profile(client);
    assert.equal(moved.assigned_to, agentB);
    assert.equal(moved.group_id, office);
    assert.equal(moved.case_number, 'Case@552');
    assert.equal(moved.login_email, original.login_email);
    assert.equal(moved.email, original.email);
    assert.equal(moved.subscription, original.subscription);
    assert.deepEqual((await db.query('SELECT * FROM auth.users WHERE id=$1', [client])).rows, authBefore);
    assert.deepEqual((await db.query('SELECT * FROM customer_balances WHERE customer_id=$1 ORDER BY currency', [client])).rows, balancesBefore);
    assert.equal(await scalar("SELECT count(*)::int FROM profiles WHERE email=$1 AND case_number ILIKE 'Case@551'", [original.email]), 0);
    assert.equal(await scalar("SELECT login_email FROM profiles WHERE email=$1 AND case_number ILIKE 'case@552'", [original.email]), original.login_email);
    assert.equal(await asUser(agentA, () => scalar('SELECT count(*)::int FROM profiles WHERE id=$1', [client])), 0);
    assert.equal(await asUser(agentB, () => scalar('SELECT count(*)::int FROM profiles WHERE id=$1', [client])), 1);
  });
});

test('full profile edits route by case too and return the destination agent spelling', async () => {
  await rollback(async () => {
    const saved = await asUser(manager, () => db.query(
      'UPDATE profiles SET first_name=$1,case_number=$2 WHERE id=$3 RETURNING assigned_to,case_number,first_name',
      ['Edited client', 'case@552', client]));
    assert.deepEqual(saved.rows, [{ assigned_to: agentB, case_number: 'Case@552', first_name: 'Edited client' }]);
  });
});

test('unassigned clients can be linked and Superior Admin can move clients between offices on the same platform', async () => {
  await rollback(async () => {
    await asUser(manager, () => transfer(unassigned, 'CASE@552'));
    assert.equal((await profile(unassigned)).assigned_to, agentB);
    await asUser(admin, () => transfer(client, 'case@554'));
    const moved = await profile(client);
    assert.equal(moved.assigned_to, outsideAgent);
    assert.equal(moved.group_id, outsideOffice);
    assert.equal(moved.case_number, 'Case@554');
    assert.equal(await asUser(manager, () => scalar('SELECT count(*)::int FROM profiles WHERE id=$1', [client])), 0);
  });
});

test('client transfers cannot bypass source ownership, supervisor subtrees, office boundaries, or agent assignment restrictions', async () => {
  await rollback(async () => {
    for (const [actor, target, code] of [[manager,client,'Case@554'],[supervisor,client,'Case@553'],
      [supervisor,outsideClient,'Case@552'],[agentA,client,'Case@552'],[agentB,client,'Case@552'],[client,client,'Case@552'],
      [admin,agentA,'Case@552']]) {
      await reject(actor, () => transfer(target, code), /permitted scope/);
    }
    for (const [actor, code] of [[manager,'Case@554'],[supervisor,'Case@553'],[agentA,'Case@552'],[client,'Case@552']]) {
      await reject(actor, () => db.query('UPDATE profiles SET case_number=$1 WHERE id=$2', [code, client]), /permitted scope|own case/);
    }
    assert.equal((await profile(client)).assigned_to, agentA);
    assert.equal((await profile(client)).case_number, 'Case@551');
  });
});

test('inactive, disabled, archived, groupless and cross-platform agents cannot receive clients through a case edit', async () => {
  for (const mode of ['inactive', 'disabled', 'archived', 'groupless', 'platform']) await rollback(async () => {
    if (mode === 'inactive') await db.query("UPDATE profiles SET status='inactive' WHERE id=$1", [agentB]);
    if (mode === 'disabled') await db.query('UPDATE agent_signup_codes SET is_active=false WHERE agent_id=$1', [agentB]);
    if (mode === 'archived') await db.query('UPDATE profiles SET is_archived=true WHERE id=$1', [agentB]);
    if (mode === 'groupless') await db.query('UPDATE profiles SET group_id=NULL,supervisor_id=NULL WHERE id=$1', [agentB]);
    if (mode === 'platform') {
      const alternate = id(103);
      await db.query("INSERT INTO groups(id,name,platform) VALUES ($1,'Other platform','chargeback')", [alternate]);
      await db.query("UPDATE profiles SET group_id=$1,platform='chargeback',supervisor_id=NULL WHERE id=$2", [alternate, agentB]);
    }
    await reject(admin, () => transfer(client, 'Case@552'), /inactive or unavailable|same platform/);
    assert.equal((await profile(client)).assigned_to, agentA);
    assert.equal((await profile(client)).case_number, 'Case@551');
  });
});

test('unknown case numbers leave active assignments intact and archived clients cannot be transferred', async () => {
  await rollback(async () => {
    await reject(admin, () => transfer(client, 'Missing@123'), /active agent case number/);
    await db.query('UPDATE profiles SET is_archived=true WHERE id=$1', [client]);
    await reject(admin, () => transfer(client, 'Case@552'), /permitted scope/);
    assert.equal((await profile(client)).assigned_to, agentA);
  });
});

test('duplicate email/case pairs roll back both the case edit and its assignment change', async () => {
  await rollback(async () => {
    const original = await profile(client);
    await db.query('UPDATE profiles SET email=$1 WHERE id=$2', [original.email, otherClient]);
    await reject(admin, () => transfer(client, 'Case@552'), /already registered/);
    assert.equal((await profile(client)).assigned_to, agentA);
    assert.equal((await profile(client)).case_number, 'Case@551');
    assert.equal((await profile(otherClient)).assigned_to, agentB);
  });
});

test('a transferred client follows only the new agents future case changes and can be transferred back', async () => {
  await rollback(async () => {
    await asUser(manager, () => transfer(client, 'Case@552'));
    await asUser(manager, () => scalar('SELECT set_agent_case_code($1,$2)', [agentA, 'Case@600']));
    assert.equal((await profile(client)).case_number, 'Case@552');
    await asUser(manager, () => scalar('SELECT set_agent_case_code($1,$2)', [agentB, 'Case@700']));
    for (const user of [client, otherClient]) {
      assert.equal((await profile(user)).case_number, 'Case@700');
      assert.equal((await profile(user)).assigned_to, agentB);
    }
    await asUser(manager, () => transfer(client, 'case@600'));
    assert.equal((await profile(client)).assigned_to, agentA);
    assert.equal((await profile(client)).case_number, 'Case@600');
  });
});

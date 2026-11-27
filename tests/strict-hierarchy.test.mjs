import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createSupabaseTestDatabase } from './helpers/supabaseTestDatabase.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const id = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [admin, groupAdmin, supervisor, siblingSupervisor, agent, siblingAgent, client, siblingClient, outsideAdmin, outsideSupervisor, outsideAgent, outsideClient, unassigned] = Array.from({ length: 13 }, (_, n) => id(n + 1));
const [group, outsideGroup] = [id(101), id(102)];
const clients = [client, siblingClient, outsideClient];
let db;
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
async function asUser(actor, action) {
  await db.exec('SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false)", [actor]);
  try { return await action(); }
  finally { await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'service_role', false)"); }
}
async function rollback(action) {
  await db.exec('BEGIN');
  try { await action(); } finally { await db.exec('ROLLBACK'); }
}

before(async () => {
  db = await createSupabaseTestDatabase();
  const users = [admin, groupAdmin, supervisor, siblingSupervisor, agent, siblingAgent, client, siblingClient, outsideAdmin, outsideSupervisor, outsideAgent, outsideClient, unassigned];
  for (const user of users) await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,$2,'{}')", [user, `fixture-${user}@example.test`]);
  await db.query("INSERT INTO groups(id,name) VALUES ($1,'Group A'),($2,'Group B')", [group, outsideGroup]);
  for (const user of users.filter(user => user !== admin)) await db.query('UPDATE profiles SET group_id=$1 WHERE id=$2', [[outsideAdmin, outsideSupervisor, outsideAgent, outsideClient].includes(user) ? outsideGroup : group, user]);
  for (const [user, role] of [[admin,'admin'],[groupAdmin,'group_admin'],[outsideAdmin,'group_admin'],[supervisor,'supervisor'],[siblingSupervisor,'supervisor'],[outsideSupervisor,'supervisor'],[agent,'agent'],[siblingAgent,'agent'],[outsideAgent,'agent']]) await db.query('INSERT INTO user_roles(user_id,role) VALUES ($1,$2)', [user,role]);
  for (const [user, parent] of [[agent,supervisor],[siblingAgent,siblingSupervisor],[outsideAgent,outsideSupervisor]]) await db.query('UPDATE profiles SET supervisor_id=$1 WHERE id=$2', [parent,user]);
  for (const [user, parent] of [[client,agent],[siblingClient,siblingAgent],[outsideClient,outsideAgent]]) {
    await db.query('UPDATE profiles SET assigned_to=$1 WHERE id=$2', [parent,user]);
    await db.query("INSERT INTO customer_notes(customer_id,content) VALUES ($1,'Private note')", [user]);
    await db.query("INSERT INTO case_timeline(customer_id,event_type,title) VALUES ($1,'info','Case event')", [user]);
    await db.query("INSERT INTO client_payment_details(customer_id,method) VALUES ($1,'bank_transfer')", [user]);
    await db.query('INSERT INTO kyc_submissions(customer_id) VALUES ($1)', [user]);
    await db.query("INSERT INTO recovery_funds(customer_id,currency,amount) VALUES ($1,'USD',100)", [user]);
    await db.query("INSERT INTO transaction_requests(customer_id,type,method,amount) VALUES ($1,'deposit','bank_transfer',10)", [user]);
    await db.query("INSERT INTO notifications(user_id,title) VALUES ($1,'Private notification')", [user]);
    await db.query('INSERT INTO user_sessions(user_id) VALUES ($1)', [user]);
    await db.query('INSERT INTO password_reset_requests(target_user_id,requested_by) VALUES ($1,$2)', [user,parent]);
    await db.query("INSERT INTO portfolio_items(user_id,crypto_id,crypto_name,crypto_symbol,quantity,purchase_price) VALUES ($1,'bitcoin','Bitcoin','BTC',1,1)", [user]);
    await db.query("INSERT INTO watchlist_items(user_id,crypto_id,crypto_name,crypto_symbol) VALUES ($1,'bitcoin','Bitcoin','BTC')", [user]);
    const path = `${parent}/attachment.pdf`;
    await db.query("INSERT INTO messages(conversation_id,sender_id,recipient_id,content,attachment_url) VALUES ($1,$2,$3,'Private message',$4)", [user,parent,user,path]);
    await db.query("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('chat-attachments',$1,$2),('kyc-documents',$3,$4)", [path,parent,`${user}/identity.pdf`,user]);
  }
});
after(async () => { await db?.close(); });

test('each CRM role can change an independent client case number without changing credentials, ownership, or balances', async () => {
  for (const actor of [admin, groupAdmin, supervisor, agent]) await rollback(async () => {
    await db.query('UPDATE agent_signup_codes SET is_active=false WHERE agent_id=$1', [agent]);
    const original = (await db.query('SELECT id,email,login_email,group_id,assigned_to,subscription FROM profiles WHERE id=$1', [client])).rows[0];
    const balances = (await db.query('SELECT * FROM customer_balances WHERE customer_id=$1 ORDER BY currency', [client])).rows;
    const authUser = (await db.query('SELECT * FROM auth.users WHERE id=$1', [client])).rows[0];
    const oldCase = await scalar('SELECT case_number FROM profiles WHERE id=$1', [client]);
    assert.equal(await asUser(actor, () => scalar('SELECT set_client_case_number($1,$2)', [client,' new-Case@123 '])), 'new-Case@123');
    assert.deepEqual((await db.query('SELECT id,email,login_email,group_id,assigned_to,subscription FROM profiles WHERE id=$1', [client])).rows[0], original);
    assert.deepEqual((await db.query('SELECT * FROM auth.users WHERE id=$1', [client])).rows[0], authUser);
    assert.deepEqual((await db.query('SELECT * FROM customer_balances WHERE customer_id=$1 ORDER BY currency', [client])).rows, balances);
    assert.equal(await scalar('SELECT login_email FROM profiles WHERE email=$1 AND case_number=$2', [original.email,'new-Case@123']), original.login_email);
    assert.equal(await scalar('SELECT count(*)::int FROM profiles WHERE email=$1 AND case_number=$2', [original.email,oldCase]), 0);
  });
});

test('client case-number mutation denies other subtrees, clients, and staff targets', async () => {
  for (const [actor,target] of [[groupAdmin,outsideClient],[supervisor,siblingClient],[supervisor,outsideClient],[agent,siblingClient],[agent,outsideClient],[client,client],[client,siblingClient],[admin,agent]]) {
    await asUser(actor, () => assert.rejects(db.query('SELECT set_client_case_number($1,$2)', [target,'FORGED-CASE']), /permitted scope/));
  }
  const previous = await scalar('SELECT case_number FROM profiles WHERE id=$1', [client]);
  for (const invalid of [null, '', '   ', 'bad\u0001case', 'A'.repeat(101)]) {
    await asUser(admin, () => assert.rejects(db.query('SELECT set_client_case_number($1,$2)', [client,invalid]), /1 to 100/));
  }
  assert.equal(await scalar('SELECT case_number FROM profiles WHERE id=$1', [client]), previous);
  assert.equal(await scalar("SELECT has_function_privilege('anon','public.set_client_case_number(uuid,text)','EXECUTE')"), false);
});

test('duplicate email/case pairs fail with a useful error and retain both clients', async () => {
  const originals = (await db.query('SELECT id,email,case_number FROM profiles WHERE id=ANY($1::uuid[])', [[client,siblingClient]])).rows;
  try {
    await db.query('UPDATE agent_signup_codes SET is_active=false WHERE agent_id=$1', [agent]);
    await db.query("UPDATE profiles SET email='shared-case@example.test' WHERE id=ANY($1::uuid[])", [[client,siblingClient]]);
    const taken = await scalar('SELECT case_number FROM profiles WHERE id=$1', [siblingClient]);
    await asUser(admin, () => assert.rejects(db.query('SELECT set_client_case_number($1,$2)', [client,` ${taken.toLowerCase()} `]), /already registered/));
    assert.deepEqual((await db.query('SELECT id,case_number FROM profiles WHERE id=ANY($1::uuid[]) ORDER BY id', [[client,siblingClient]])).rows,
      originals.map(({id,case_number}) => ({id,case_number})).sort((a,b)=>a.id.localeCompare(b.id)));
  } finally {
    for (const row of originals) await db.query('UPDATE profiles SET email=$1 WHERE id=$2', [row.email,row.id]);
    await db.query('UPDATE agent_signup_codes SET is_active=true WHERE agent_id=$1', [agent]);
  }
});

test('agent case code reads use the caller role, group, and supervisor assignments', async () => {
  for (const [actor, expected] of [
    [admin, [agent, siblingAgent, outsideAgent]], [groupAdmin, [agent, siblingAgent]],
    [supervisor, [agent]], [siblingSupervisor, [siblingAgent]], [outsideSupervisor, [outsideAgent]],
    [agent, [agent]], [siblingAgent, [siblingAgent]], [outsideAgent, [outsideAgent]], [client, []],
  ]) {
    const result = await asUser(actor, () => db.query('SELECT * FROM get_agent_case_codes($1)', [[agent, siblingAgent, outsideAgent, client]]));
    assert.deepEqual(result.rows.map(row => row.agent_id).sort(), expected.sort(), actor);
    for (const row of result.rows) assert.match(row.case_code, /^AGT-[A-F0-9]{12}$/);
  }
  assert.equal(await scalar("SELECT has_function_privilege('anon','public.get_agent_case_codes(uuid[])','EXECUTE')"), false);
});

test('agent identifiers stay stable across role changes and cannot be written directly from browsers', async () => {
  const original = await scalar('SELECT code FROM agent_signup_codes WHERE agent_id=$1', [agent]);
  await rollback(async () => {
    await db.query("UPDATE user_roles SET role='user' WHERE user_id=$1", [agent]);
    assert.equal((await asUser(admin, () => db.query('SELECT * FROM get_agent_case_codes($1)', [[agent]]))).rows.length, 0);
    await db.query("UPDATE user_roles SET role='agent' WHERE user_id=$1", [agent]);
    assert.equal(await scalar('SELECT code FROM agent_signup_codes WHERE agent_id=$1', [agent]), original);
  });
  for (const actor of [admin, groupAdmin, supervisor, agent]) {
    await asUser(actor, () => assert.rejects(db.query('SELECT code FROM agent_signup_codes'), /permission denied/));
    await asUser(actor, () => assert.rejects(db.query("UPDATE agent_signup_codes SET code='AGT-AAAAAAAAAAAA' WHERE agent_id=$1", [agent]), /permission denied/));
  }
  await rollback(async () => {
    await db.query('UPDATE profiles SET is_archived=true WHERE id=$1', [agent]);
    assert.equal((await asUser(admin, () => db.query('SELECT * FROM get_agent_case_codes($1)', [[agent]]))).rows.length, 0);
    assert.equal((await asUser(agent, () => db.query('SELECT * FROM get_agent_case_codes($1)', [[agent]]))).rows.length, 0);
  });
});

const editAgent = (actor, target, groupId, supervisorId, code = 'NEW-1234') => asUser(actor, () => db.query(
  'SELECT update_managed_agent($1,$2,$3,$4,$5,$6,$7)', [target, 'Edited', 'Agent', 'edited-agent', groupId, supervisorId, code]));

test('Superior Admin can atomically edit an agent group and case number while clearing old client assignments', async () => {
  await rollback(async () => {
    await editAgent(admin, agent, outsideGroup, outsideSupervisor, ' Case@551 ');
    const updated = (await db.query('SELECT first_name,group_id,supervisor_id,case_number FROM profiles WHERE id=$1', [agent])).rows[0];
    assert.deepEqual(updated, { first_name: 'Edited', group_id: outsideGroup, supervisor_id: outsideSupervisor, case_number: null });
    assert.equal(await scalar('SELECT code FROM agent_signup_codes WHERE agent_id=$1', [agent]), 'Case@551');
    assert.equal(await scalar('SELECT assigned_to FROM profiles WHERE id=$1', [client]), null);
    assert.equal(await asUser(supervisor, () => scalar('SELECT count(*)::int FROM profiles WHERE id=$1', [agent])), 0);
  });
});

test('agent edit permissions prevent cross-group and sibling-supervisor mutations', async () => {
  for (const actor of [groupAdmin, supervisor]) {
    await rollback(async () => {
      await editAgent(actor, agent, group, supervisor);
      assert.equal(await scalar('SELECT code FROM agent_signup_codes WHERE agent_id=$1', [agent]), 'NEW-1234');
    });
    await assert.rejects(editAgent(actor, agent, outsideGroup, outsideSupervisor), /Only Superior Admin/);
  }
  for (const [actor, target, targetGroup, targetSupervisor] of [[supervisor,siblingAgent,group,siblingSupervisor],[groupAdmin,outsideAgent,outsideGroup,outsideSupervisor],[agent,agent,group,supervisor],[client,agent,group,supervisor]]) {
    await assert.rejects(editAgent(actor, target, targetGroup, targetSupervisor), /permitted scope/);
    await asUser(actor, () => assert.rejects(db.query('SELECT set_agent_case_code($1,$2)', [target,'FORGED-123']), /permitted scope/));
  }
});

test('agent case codes keep lowercase and mixed case and reject duplicate capitalization variants', async () => {
  await rollback(async () => {
    for (const value of ['case@551', 'CASE@551', 'Case@551']) {
      await editAgent(admin, agent, group, supervisor, value);
      const codes = await asUser(admin, () => db.query('SELECT * FROM get_agent_case_codes($1)', [[agent]]));
      assert.equal(codes.rows[0].case_code, value);
    }
    await asUser(admin, async () => {
      await db.exec('SAVEPOINT duplicate_agent_code');
      await assert.rejects(db.query('SELECT set_agent_case_code($1,$2)', [siblingAgent, 'case@551']), /already in use/);
      await db.exec('ROLLBACK TO SAVEPOINT duplicate_agent_code');
    });
    assert.equal(await scalar('SELECT code FROM agent_signup_codes WHERE agent_id=$1', [agent]), 'Case@551');
  });
});

test('duplicate case numbers and invalid supervisor changes roll back the whole agent edit', async () => {
  const oldCode = await scalar('SELECT code FROM agent_signup_codes WHERE agent_id=$1', [agent]);
  const siblingCode = await scalar('SELECT code FROM agent_signup_codes WHERE agent_id=$1', [siblingAgent]);
  await assert.rejects(editAgent(admin, agent, group, supervisor, siblingCode.toLowerCase()), /already in use/);
  assert.equal(await scalar('SELECT code FROM agent_signup_codes WHERE agent_id=$1', [agent]), oldCode);
  assert.notEqual(await scalar('SELECT first_name FROM profiles WHERE id=$1', [agent]), 'Edited');
  await assert.rejects(editAgent(admin, agent, group, outsideSupervisor), /agent group/);
  assert.equal(await scalar('SELECT code FROM agent_signup_codes WHERE agent_id=$1', [agent]), oldCode);
  for (const code of ['', 'bad\u0001code', 'A'.repeat(101)]) await assert.rejects(editAgent(admin, agent, group, supervisor, code), /1 to 100/);
  assert.equal(await scalar("SELECT has_function_privilege('anon','public.update_managed_agent(uuid,text,text,text,uuid,uuid,text)','EXECUTE')"), false);
});

test('profile visibility follows Superior Admin, group, supervisor, and agent boundaries', async () => {
  for (const [actor, expected] of [
    [admin, [admin,groupAdmin,supervisor,siblingSupervisor,agent,siblingAgent,client,siblingClient,outsideAdmin,outsideSupervisor,outsideAgent,outsideClient,unassigned]],
    [groupAdmin,[groupAdmin,supervisor,siblingSupervisor,agent,siblingAgent,client,siblingClient,unassigned]],
    [supervisor,[supervisor,agent,client]], [agent,[agent,client]], [client,[client]],
  ]) {
    const rows = await asUser(actor, () => db.query('SELECT id FROM profiles ORDER BY id'));
    assert.deepEqual(rows.rows.map(row => row.id).sort(), expected.sort(), actor);
  }
});

for (const [table, column] of [
  ['customer_balances','customer_id'],['portfolio_items','user_id'],['customer_notes','customer_id'],
  ['case_timeline','customer_id'],['client_payment_details','customer_id'],['kyc_submissions','customer_id'],
  ['recovery_funds','customer_id'],['transaction_requests','customer_id'],['notifications','user_id'],
  ['user_sessions','user_id'],['password_reset_requests','target_user_id'],
  ['watchlist_items','user_id'],
]) {
  test(`${table} cannot expose sibling-supervisor or cross-group client records`, async () => {
    for (const [actor, expected] of [[admin,clients],[groupAdmin,[client,siblingClient]],[supervisor,[client]],[agent,[client]]]) {
      const rows = await asUser(actor, () => db.query(`SELECT DISTINCT ${column} AS target FROM ${table} WHERE ${column}=ANY($1::uuid[]) ORDER BY target`, [clients]));
      assert.deepEqual(rows.rows.map(row => row.target).sort(), [...expected].sort(), `${table}: ${actor}`);
    }
  });
}

test('direct writes cannot modify, insert, or retarget another supervisors client data', async () => {
  const changed = await asUser(supervisor, () => db.query("UPDATE profiles SET phone='forged' WHERE id=$1 RETURNING id", [siblingClient]));
  assert.equal(changed.rows.length, 0);
  await asUser(supervisor, () => assert.rejects(db.query("INSERT INTO customer_notes(customer_id,content) VALUES ($1,'forged')", [siblingClient]), /row-level security/));
  await asUser(supervisor, () => assert.rejects(db.query('UPDATE customer_notes SET customer_id=$1 WHERE customer_id=$2', [siblingClient,client]), /row-level security/));
  await asUser(agent, () => assert.rejects(db.query('UPDATE profiles SET assigned_to=$1 WHERE id=$2', [siblingAgent,client]), /assignment/));
});

test('privileged balance, KYC, session and role RPCs enforce the same subtree', async () => {
  for (const actor of [supervisor,agent]) for (const target of [siblingClient,outsideClient]) {
    await asUser(actor, () => assert.rejects(db.query("SELECT adjust_fiat_balance($1,'USD',1,'credit',NULL)", [target]), /permission/));
    await asUser(actor, () => assert.rejects(db.query("SELECT adjust_crypto_balance($1,'bitcoin','BTC','Bitcoin',1,'credit',NULL,1)", [target]), /permission/));
    await asUser(actor, () => assert.rejects(db.query("SELECT set_balance_dashboard_visibility($1,'fiat',$2,true)", [target,id(999)]), /permission/));
    assert.equal((await asUser(actor, () => db.query('SELECT * FROM get_user_sessions_for_staff($1)', [target]))).rows.length,0);
    assert.equal(await asUser(actor, () => scalar('SELECT can_manage_customer($1,$2)', [actor,target])),false);
  }
  await asUser(supervisor, () => assert.rejects(db.query("SELECT set_managed_user_role($1,'agent')", [siblingClient]), /permitted scope/));
  assert.equal(await asUser(agent, () => scalar('SELECT can_access_account($1,$2)', [admin,outsideClient])),false);
});

test('messages and chat or KYC attachments obey supervisor and group boundaries', async () => {
  for (const [actor, targets] of [[admin,clients],[groupAdmin,[client,siblingClient]],[supervisor,[client]],[agent,[client]],[client,[client]]]) {
    const rows = await asUser(actor, () => db.query('SELECT recipient_id FROM messages ORDER BY recipient_id'));
    assert.deepEqual(rows.rows.map(row=>row.recipient_id).sort(), [...targets].sort());
  }
  for (const path of [`${siblingAgent}/attachment.pdf`,`${siblingClient}/identity.pdf`,`${outsideAgent}/attachment.pdf`]) {
    assert.equal(await asUser(supervisor, () => scalar('SELECT count(*)::int FROM storage.objects WHERE name=$1', [path])),0);
  }
  assert.equal(await asUser(supervisor, () => scalar('SELECT count(*)::int FROM storage.objects WHERE name=$1', [`${agent}/attachment.pdf`])),1);
  await asUser(supervisor, () => assert.rejects(db.query("INSERT INTO messages(conversation_id,sender_id,recipient_id,content) VALUES ($1,$2,$3,'forged')", [id(999),supervisor,siblingClient]), /row-level security/));
});

test('only Superior or Group Admin can assign agents to same-group supervisors', async () => {
  await rollback(async () => {
    await asUser(groupAdmin, () => db.query('SELECT set_agent_supervisor($1,$2)', [agent,siblingSupervisor]));
    assert.equal(await asUser(supervisor, () => scalar('SELECT can_manage_customer($1,$2)', [supervisor,client])),false);
    assert.equal(await asUser(siblingSupervisor, () => scalar('SELECT can_manage_customer($1,$2)', [siblingSupervisor,client])),true);
  });
  await asUser(supervisor, () => assert.rejects(db.query('SELECT set_agent_supervisor($1,$2)', [siblingAgent,supervisor]), /Only Superior/));
  await asUser(groupAdmin, () => assert.rejects(db.query('SELECT set_agent_supervisor($1,$2)', [outsideAgent,supervisor]), /permitted scope/));
  await asUser(admin, () => assert.rejects(db.query('SELECT set_agent_supervisor($1,$2)', [agent,outsideSupervisor]), /agent group/));
});

test('bulk supervisor assignment rolls back every change when one agent is out of scope', async () => {
  await asUser(groupAdmin, () => assert.rejects(db.query('SELECT set_agents_supervisor($1,$2)', [[agent,outsideAgent],siblingSupervisor]), /scope/));
  assert.equal(await scalar('SELECT supervisor_id FROM profiles WHERE id=$1',[agent]),supervisor);
});

test('cross-group assignments are rejected even for Superior Admin and service-role writes', async () => {
  await asUser(admin, () => assert.rejects(db.query('UPDATE profiles SET assigned_to=$1 WHERE id=$2',[outsideAgent,client]),/same group/));
  await assert.rejects(db.query('UPDATE profiles SET assigned_to=$1 WHERE id=$2',[outsideAgent,client]),/same group/);
  await rollback(async () => {
    await asUser(admin, () => db.query('SELECT set_customer_group($1,$2)',[client,outsideGroup]));
    assert.equal(await scalar('SELECT assigned_to FROM profiles WHERE id=$1',[client]),null);
    assert.equal(await asUser(agent, () => scalar('SELECT count(*)::int FROM profiles WHERE id=$1',[client])),0);
    assert.equal(await asUser(outsideAdmin, () => scalar('SELECT count(*)::int FROM profiles WHERE id=$1',[client])),1);
  });
});

test('a client cannot publish findings, claim an agent, or rewrite their group', async () => {
  for (const [column,value] of [['group_id',outsideGroup],['assigned_to',siblingAgent],['recovery_result_type','published']]) {
    await asUser(client, () => assert.rejects(db.query(`UPDATE profiles SET ${column}=$1 WHERE id=$2`,[value,client]),/protected|assignment/));
  }
});

test('role demotions remove supervisor links instead of leaving a stale hierarchy', async () => {
  await rollback(async () => {
    await asUser(groupAdmin, () => db.query("SELECT set_managed_user_role($1,'user')",[supervisor]));
    assert.equal(await scalar('SELECT supervisor_id FROM profiles WHERE id=$1',[agent]),null);
    assert.equal(await asUser(supervisor, () => scalar('SELECT can_manage_customer($1,$2)',[supervisor,client])),false);
  });
});

test('group managers retain their client correspondence with Superior Admin without seeing another group', async () => {
  await rollback(async () => {
    const message = await scalar("INSERT INTO messages(conversation_id,sender_id,recipient_id,content) VALUES ($1,$2,$3,'Superior correspondence') RETURNING id",[id(401),admin,client]);
    for (const [actor,expected] of [[admin,1],[groupAdmin,1],[supervisor,1],[agent,1],[client,1],[siblingSupervisor,0],[outsideAdmin,0]]) {
      assert.equal(await asUser(actor,()=>scalar('SELECT count(*)::int FROM messages WHERE id=$1',[message])),expected);
    }
  });
});

test('only one Group Admin can be appointed to a group', async () => {
  await asUser(admin,()=>assert.rejects(db.query("SELECT set_managed_user_role($1,'group_admin')",[unassigned]),/already has a Group Admin/));
  assert.equal(await scalar('SELECT count(*)::int FROM user_roles WHERE user_id=$1',[unassigned]),0);
});

test('promoting a client to staff removes its old agent relationship', async () => {
  await rollback(async()=>{
    await asUser(groupAdmin,()=>db.query("SELECT set_managed_user_role($1,'agent')",[client]));
    assert.equal(await scalar('SELECT assigned_to FROM profiles WHERE id=$1',[client]),null);
    assert.equal(await asUser(agent,()=>scalar('SELECT count(*)::int FROM profiles WHERE id=$1',[client])),0);
  });
});

test('arbitrary role and group metadata lookups cannot bypass the hierarchy', async () => {
  assert.equal(await asUser(supervisor,()=>scalar('SELECT get_user_role($1)',[siblingAgent])),null);
  assert.equal(await asUser(supervisor,()=>scalar('SELECT get_user_group($1)',[outsideClient])),null);
  assert.equal(await asUser(groupAdmin,()=>scalar('SELECT get_user_platform($1)',[outsideClient])),null);
  assert.equal(await asUser(supervisor,()=>scalar('SELECT is_same_group($1,$2)',[supervisor,siblingClient])),false);
});

test('IP logs are group scoped and cannot be forged by website users', async()=>{
  await rollback(async()=>{
    await db.query("INSERT INTO ip_validation_logs(user_id,action) VALUES ($1,'ALLOW'),($2,'ALLOW'),(NULL,'DENY')",[client,outsideClient]);
    assert.equal(await asUser(admin,()=>scalar('SELECT count(*)::int FROM ip_validation_logs')),3);
    assert.equal(await asUser(groupAdmin,()=>scalar('SELECT count(*)::int FROM ip_validation_logs')),1);
  });
  await asUser(groupAdmin,()=>assert.rejects(db.query("INSERT INTO ip_validation_logs(user_id,action) VALUES ($1,'ALLOW')",[client]),/permission denied/));
});

test('moving a supervisor clears their agents and moving an agent clears their old clients', async () => {
  await rollback(async()=>{
    await asUser(admin,()=>db.query('UPDATE profiles SET group_id=$1 WHERE id=$2',[outsideGroup,supervisor]));
    assert.equal(await scalar('SELECT supervisor_id FROM profiles WHERE id=$1',[agent]),null);
    await asUser(admin,()=>db.query('UPDATE profiles SET group_id=$1 WHERE id=$2',[outsideGroup,agent]));
    assert.equal(await scalar('SELECT assigned_to FROM profiles WHERE id=$1',[client]),null);
    assert.equal(await asUser(agent,()=>scalar('SELECT count(*)::int FROM profiles WHERE id=$1',[client])),0);
  });
});

test('Auth email changes synchronize staff login and displayed addresses while preserving client contact addresses', async () => {
  await rollback(async () => {
    // GoTrue connects directly to Postgres without a PostgREST role claim.
    await db.exec("SELECT set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)");
    for (const staff of [admin, groupAdmin, supervisor, agent]) {
      const address = `changed-${staff}@example.test`;
      await db.query('UPDATE auth.users SET email=$1 WHERE id=$2', [address, staff]);
      const profile = (await db.query('SELECT email,display_email,login_email FROM profiles WHERE id=$1', [staff])).rows[0];
      assert.deepEqual(profile, { email: address, display_email: address, login_email: address });
      assert.equal(await scalar("SELECT current_setting('request.jwt.claim.role', true)"), '');
    }
    const original = (await db.query('SELECT email,display_email FROM profiles WHERE id=$1', [client])).rows[0];
    await db.query("UPDATE auth.users SET email='internal-client@example.test' WHERE id=$1", [client]);
    assert.deepEqual((await db.query('SELECT email,display_email FROM profiles WHERE id=$1', [client])).rows[0], original);
    assert.equal(await scalar('SELECT login_email FROM profiles WHERE id=$1', [client]), 'internal-client@example.test');
  });
});

test('staff credentials use real hierarchy and permission checks before any Auth mutation', async () => {
  for (const [actor, target, allowed] of [
    [admin, groupAdmin, true], [admin, outsideAdmin, true], [admin, supervisor, true], [admin, agent, true],
    [groupAdmin, supervisor, true], [groupAdmin, agent, true], [supervisor, agent, true],
    [groupAdmin, outsideAdmin, false], [groupAdmin, outsideAgent, false], [groupAdmin, admin, false],
    [supervisor, siblingAgent, false], [supervisor, outsideAgent, false], [supervisor, groupAdmin, false],
    [agent, supervisor, false], [client, agent, false], [null, agent, false],
    [admin, client, false], [admin, admin, false],
  ]) {
    const result = await edge('update-staff-credentials', actor, { userId: target, newEmail: ' NEW-STAFF@example.test ', newPassword: ' Password-123! ' });
    assert.equal(result.status, allowed ? 200 : actor ? actor === target ? 400 : 403 : 401, `${actor} -> ${target}`);
    assert.equal(result.mutations.length, allowed ? 1 : 0);
    if (allowed) {
      assert.deepEqual(JSON.parse(JSON.stringify(result.mutations[0])), { auth: 'update', userId: target, value: {
        email: 'new-staff@example.test', email_confirm: true, user_metadata: { display_email: 'new-staff@example.test' }, password: ' Password-123! ',
      } });
      assert.deepEqual(result.body, { success: true, userId: target });
    }
  }
});

test('staff email migration repairs stale addresses and restores the previous database role claim', async () => {
  await rollback(async () => {
    await db.query("UPDATE profiles SET email='stale@example.test',display_email='stale@example.test' WHERE id=$1", [agent]);
    const clientContact = (await db.query('SELECT email,display_email FROM profiles WHERE id=$1', [client])).rows[0];
    await db.exec("SELECT set_config('request.jwt.claim.role', '', false)");
    await db.exec(readFileSync(new URL('../supabase/migrations/20261123140100_staff_auth_email_sync.sql', import.meta.url), 'utf8'));
    assert.equal(await scalar("SELECT current_setting('request.jwt.claim.role', true)"), '');
    const email = await scalar('SELECT email FROM auth.users WHERE id=$1', [agent]);
    assert.deepEqual((await db.query('SELECT email,display_email,login_email FROM profiles WHERE id=$1', [agent])).rows[0], {
      email, display_email: email, login_email: email,
    });
    assert.deepEqual((await db.query('SELECT email,display_email FROM profiles WHERE id=$1', [client])).rows[0], clientContact);
  });
});

test('staff email-only and password-only edits do not mutate the other credential', async () => {
  const email = await edge('update-staff-credentials', admin, { userId: groupAdmin, newEmail: 'office@example.test' });
  assert.equal(email.status, 200);
  assert.equal('password' in email.mutations[0].value, false);
  const password = await edge('update-staff-credentials', admin, { userId: supervisor, newPassword: 'New-password-123!' });
  assert.equal(password.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(password.mutations[0].value)), { password: 'New-password-123!' });
});

test('credential validation, provider errors, permission failures and missing Auth confirmation never report success', async () => {
  for (const body of [
    null, {}, { userId: 'invalid', newEmail: 'valid@example.test' }, { userId: agent },
    ...['invalid', '', null, 123, 'a'.repeat(255) + '@test.com'].map(newEmail => ({ userId: agent, newEmail })),
    ...['short', '        ', null, 123].map(newPassword => ({ userId: agent, newPassword })),
  ]) {
    const result = await edge('update-staff-credentials', admin, body);
    assert.equal(result.status, 400);
    assert.deepEqual(result.mutations, []);
  }
  const body = { userId: agent, newPassword: 'New-password-123!' };
  for (const options of [{ authError: true }, { unconfirmed: true }]) {
    const result = await edge('update-staff-credentials', admin, body, false, options);
    assert.ok(result.status >= 400);
    assert.notEqual(result.body.success, true);
  }
  const failed = await edge('update-staff-credentials', supervisor, body, true);
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.mutations, []);
  await rollback(async () => {
    for (const mode of ['approval', 'deny']) {
      await db.query("UPDATE role_permissions SET mode=$1 WHERE role='group_admin' AND permission='reset_password'", [mode]);
      for (const update of [{ newEmail: 'office@example.test' }, { newPassword: 'New-password-123!' }]) {
        const result = await edge('update-staff-credentials', groupAdmin, { userId: agent, ...update });
        assert.equal(result.status, 403);
        assert.deepEqual(result.mutations, []);
      }
    }
  });
});

// Execute the real service-role Edge handlers. Permission RPCs and account
// lookups run against the migrated database; external Auth mutations are recorded.
async function edge(name, actor, body, scopeError = false, options = {}) {
  let handler;
  const mutations = [];
  const sdk = {
    auth: {
      getUser: async () => ({ data: { user: actor ? { id: actor } : null }, error: null }),
      admin: {
        updateUserById: async (userId, value) => { mutations.push({ auth: 'update', userId, value }); return { data: { user: options.unconfirmed ? null : { id: userId, email: value.email } }, error: options.authError ? { message: 'Test Auth failure' } : null }; },
        deleteUser: async userId => { mutations.push({ auth: 'delete', userId }); return { error: null }; },
      },
    },
    rpc: async (name, args) => {
      if (options.finishError && name === 'finish_password_reset_request') return { data: null, error: { message: 'Status unavailable' } };
      if (scopeError) return { data: null, error: { message: 'Permission service unavailable' } };
      const params = Object.values(args);
      try {
        const data = await scalar(`SELECT public.${name}(${params.map((_,index)=>`$${index+1}`).join(',')})`, params);
        return { data, error: null };
      } catch(error) { return { data:null, error:{code:error.code,message:error.message} }; }
    },
    from(table) {
      const filters = []; let mutation;
      const execute = async single => {
        if (mutation) { mutations.push({ table, mutation, filters }); return { data: null, error: null }; }
        const rows = (await db.query(`SELECT * FROM public.${table}${filters.length ? ' WHERE ' + filters.map(([key],index)=>`${key}=$${index+1}`).join(' AND ') : ''}`, filters.map(([,value])=>value))).rows;
        return { data: single ? rows[0] || null : rows, error: null };
      };
      const query = {
        select() { return query; }, eq(key,value) { filters.push([key,value]); return query; },
        update(value) { mutation = { update: value }; return query; }, delete() { mutation = { delete: true }; return query; },
        single: () => execute(true), maybeSingle: () => execute(true), then(resolve,reject) { return execute(false).then(resolve,reject); },
      };
      return query;
    },
  };
  const source = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'');
  const compiled = ts.transpileModule(source,{ compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext} }).outputText;
  vm.runInNewContext(compiled, {
    Request,Response, createClient:()=>sdk, serve:callback=>{handler=callback;},
    Deno:{env:{get:()=> 'test-only'},serve:callback=>{handler=callback;}}, console:{log(){},error(){}},
  });
  const response = await handler(new Request(`https://edge.example.test/${name}`,{
    method:'POST',headers:{Authorization:'Bearer verified-test-token','Content-Type':'application/json'},body:JSON.stringify(body),
  }));
  return { status:response.status, body:await response.json(), mutations };
}

for (const name of ['reset-user-password','delete-user']) {
  test(`${name} validates service-role mutations against the database hierarchy`, async () => {
    for (const [actor,target,allowed] of [
      [admin,outsideClient,true],[groupAdmin,client,true],[groupAdmin,siblingAgent,true],
      [supervisor,client,true],[supervisor,agent,true],
      [supervisor,siblingClient,false],[supervisor,siblingAgent,false],[supervisor,outsideClient,false],
      [groupAdmin,outsideClient,false],[groupAdmin,admin,false],[agent,client,false],
    ]) {
      const result=await edge(name,actor,{userId:target,newPassword:'Test-password-123!'});
      assert.equal(result.status,allowed?200:403,JSON.stringify({name,actor,target,body:result.body}));
      if (!allowed) assert.deepEqual(result.mutations,[]);
      else assert.ok(result.mutations.some(m=>m.auth));
    }
    const failed=await edge(name,supervisor,{userId:client,newPassword:'Test-password-123!'},true);
    assert.ok(failed.status>=400);
    assert.deepEqual(failed.mutations,[]);
  });
}

test('password request approval checks the target client subtree before any Auth write', async () => {
  for (const [target,allowed] of [[client,true],[siblingClient,false],[outsideClient,false]]) {
    const requestId=await scalar('SELECT id FROM password_reset_requests WHERE target_user_id=$1',[target]);
    const result=await edge('approve-password-reset',supervisor,{requestId,action:'approve',newPassword:'Test-password-123!'});
    assert.equal(result.status,allowed?200:403,JSON.stringify(result.body));
    if (!allowed) assert.deepEqual(result.mutations,[]);
  }
});

async function setMode(role, mode) {
  const version = await scalar("SELECT version FROM role_permissions WHERE role=$1 AND permission='reset_password'",[role]);
  return asUser(admin,()=>db.query('SELECT * FROM save_role_permissions($1)',[JSON.stringify([{role,permission:'reset_password',mode,version}])]));
}
async function withMode(role, mode, action) {
  const previous = await scalar("SELECT mode FROM role_permissions WHERE role=$1 AND permission='reset_password'",[role]);
  await setMode(role,mode);
  try { await action(); } finally { await setMode(role,previous); }
}
const resetRequest = () => asUser(agent,()=>scalar('SELECT request_password_reset($1,$2)',[client,'Client requested a reset']));

test('only Superior Admin may save permission settings or read the full matrix', async()=>{
  assert.equal((await asUser(admin,()=>db.query('SELECT * FROM role_permissions'))).rows.length,3);
  for (const [actor,role] of [[groupAdmin,'group_admin'],[supervisor,'supervisor'],[agent,'agent']]) {
    assert.deepEqual((await asUser(actor,()=>db.query('SELECT role FROM role_permissions'))).rows,[{role}]);
    await asUser(actor,()=>assert.rejects(db.query('SELECT * FROM save_role_permissions($1)',[JSON.stringify([{role,permission:'reset_password',mode:'direct',version:1}])]),/Only Superior/));
  }
  assert.equal((await asUser(client,()=>db.query('SELECT * FROM role_permissions'))).rows.length,0);
  await asUser(admin,()=>assert.rejects(db.query("UPDATE role_permissions SET mode='deny' WHERE role='agent'"),/permission denied/));
});

test('permission saves audit changes and reject stale versions without partial writes', async()=>{
  await withMode('agent','direct',async()=>{
    assert.equal(await asUser(agent,()=>scalar("SELECT get_my_permission('reset_password')")),'direct');
    assert.ok(await scalar("SELECT count(*)::int FROM role_permission_changes WHERE role='agent' AND new_mode='direct' AND changed_by=$1",[admin])>0);
  });
  const before = (await db.query('SELECT * FROM role_permissions ORDER BY role')).rows;
  const auditCount = await scalar('SELECT count(*)::int FROM role_permission_changes');
  const supervisorSetting = before.find(row=>row.role==='supervisor');
  const agentSetting = before.find(row=>row.role==='agent');
  await asUser(admin,()=>assert.rejects(db.query('SELECT * FROM save_role_permissions($1)',[JSON.stringify([
    {role:'supervisor',permission:'reset_password',mode:'deny',version:supervisorSetting.version},
    {role:'agent',permission:'reset_password',mode:'direct',version:agentSetting.version-1},
  ])]),/Permissions changed/));
  assert.deepEqual((await db.query('SELECT * FROM role_permissions ORDER BY role')).rows,before);
  assert.equal(await scalar('SELECT count(*)::int FROM role_permission_changes'),auditCount);
});

test('Superior Admin access is fixed and forged actors or unknown permissions fail closed', async()=>{
  await asUser(admin,()=>assert.rejects(db.query('SELECT * FROM save_role_permissions($1)',[JSON.stringify([{role:'admin',permission:'reset_password',mode:'deny',version:1}])]),/Invalid permission/));
  assert.equal(await asUser(admin,()=>scalar("SELECT get_my_permission('reset_password')")),'direct');
  assert.equal(await asUser(agent,()=>scalar("SELECT role_permission_mode($1,'reset_password')",[admin])),'deny');
  assert.equal(await asUser(admin,()=>scalar('SELECT get_my_permission(NULL)')),'deny');
  assert.equal(await asUser(admin,()=>scalar("SELECT get_my_permission('anything')")),'deny');
});

for (const mode of ['direct','approval','deny']) {
  test(`agent password reset mode ${mode} controls the actual Edge function without expanding scope`,async()=>{
    await withMode('agent',mode,async()=>{
      assert.equal(await asUser(agent,()=>scalar('SELECT get_password_reset_access($1,$2)',[agent,client])),mode);
      assert.equal(await asUser(agent,()=>scalar('SELECT get_password_reset_access($1,$2)',[agent,siblingClient])),'deny');
      const result = await edge('reset-user-password',agent,{userId:client,newPassword:'Test-password-123!'});
      assert.equal(result.status,mode==='direct'?200:403);
      assert.equal(result.mutations.length,mode==='direct'?1:0);
      const outside = await edge('reset-user-password',agent,{userId:outsideClient,newPassword:'Test-password-123!'});
      assert.equal(outside.status,403);
      assert.deepEqual(outside.mutations,[]);
      if (mode!=='approval') await asUser(agent,()=>assert.rejects(db.query('SELECT request_password_reset($1,NULL)',[client]),/cannot request/));
    });
  });
}

test('approval requests are idempotent, caller-bound, and cannot be forged through table writes', async()=>{
  const request = await resetRequest();
  assert.equal(await resetRequest(),request);
  assert.equal(await scalar('SELECT requested_by FROM password_reset_requests WHERE id=$1',[request]),agent);
  await asUser(agent,()=>assert.rejects(db.query('SELECT request_password_reset($1,NULL)',[siblingClient]),/cannot request/));
  await asUser(agent,()=>assert.rejects(db.query('INSERT INTO password_reset_requests(target_user_id,requested_by) VALUES ($1,$2)',[client,agent]),/permission denied/));
  await asUser(supervisor,()=>assert.rejects(db.query("UPDATE password_reset_requests SET status='approved' WHERE id=$1",[request]),/permission denied/));
});

test('reviewers must be higher in the hierarchy and have direct reset permission', async()=>{
  const request = await resetRequest();
  for (const [actor,expected] of [[admin,true],[groupAdmin,true],[supervisor,true],[siblingSupervisor,false],[outsideAdmin,false],[agent,false]]) {
    assert.equal(await asUser(actor,()=>scalar('SELECT can_review_password_reset($1,$2)',[actor,request])),expected);
  }
  await withMode('supervisor','approval',async()=>{
    const result = await edge('approve-password-reset',supervisor,{requestId:request,action:'approve',newPassword:'Test-password-123!'});
    assert.equal(result.status,403);
    assert.deepEqual(result.mutations,[]);
  });
  await withMode('group_admin','approval',async()=>{
    const ownRequest = await asUser(groupAdmin,()=>scalar('SELECT request_password_reset($1,NULL)',[siblingClient]));
    assert.equal(await asUser(admin,()=>scalar('SELECT can_review_password_reset($1,$2)',[admin,ownRequest])),true);
    assert.equal(await asUser(groupAdmin,()=>scalar('SELECT can_review_password_reset($1,$2)',[groupAdmin,ownRequest])),false);
  });
});

test('revoking requester permission blocks approval but permits a superior to reject the request', async()=>{
  const request = await resetRequest();
  await withMode('agent','deny',async()=>{
    const denied = await edge('approve-password-reset',supervisor,{requestId:request,action:'approve',newPassword:'Test-password-123!'});
    assert.equal(denied.status,403);
    assert.deepEqual(denied.mutations,[]);
    const rejected = await edge('approve-password-reset',supervisor,{requestId:request,action:'reject'});
    assert.equal(rejected.status,200);
    assert.equal(await scalar('SELECT status FROM password_reset_requests WHERE id=$1',[request]),'rejected');
  });
});

test('a request claim prevents concurrent or repeated Auth writes', async()=>{
  const request = await resetRequest();
  const claim = await scalar("SELECT claim_password_reset_request($1,$2,'approve')",[supervisor,request]);
  const competing = await edge('approve-password-reset',groupAdmin,{requestId:request,action:'approve',newPassword:'Test-password-123!'});
  assert.equal(competing.status,409);
  assert.deepEqual(competing.mutations,[]);
  await asUser(supervisor,()=>assert.rejects(db.query("SELECT claim_password_reset_request($1,$2,'approve')",[supervisor,request]),/permission denied/));
  await scalar('SELECT finish_password_reset_request($1,$2,$3,true)',[supervisor,request,claim.token]);
  const repeated = await edge('approve-password-reset',supervisor,{requestId:request,action:'approve',newPassword:'Another-password-123!'});
  assert.equal(repeated.status,403);
  assert.deepEqual(repeated.mutations,[]);
});

test('Auth failures release a request safely while uncertain outcomes retain its claim', async()=>{
  let request = await resetRequest();
  const failed = await edge('approve-password-reset',supervisor,{requestId:request,action:'approve',newPassword:'Test-password-123!'},false,{authError:true});
  assert.equal(failed.status,400);
  assert.equal(await scalar('SELECT processing_token FROM password_reset_requests WHERE id=$1',[request]),null);
  const uncertain = await edge('approve-password-reset',supervisor,{requestId:request,action:'approve',newPassword:'Test-password-123!'},false,{unconfirmed:true});
  assert.equal(uncertain.status,503);
  const token = await scalar('SELECT processing_token FROM password_reset_requests WHERE id=$1',[request]);
  assert.ok(token);
  await scalar('SELECT finish_password_reset_request($1,$2,$3,false)',[supervisor,request,token]);
  request = await resetRequest();
  const incomplete = await edge('approve-password-reset',supervisor,{requestId:request,action:'approve',newPassword:'Test-password-123!'},false,{finishError:true});
  assert.equal(incomplete.status,503);
  assert.match(incomplete.body.error,/password was changed/);
  assert.ok(await scalar('SELECT processing_token FROM password_reset_requests WHERE id=$1',[request]));
});

test('Superior Admin can reject an old request after its requester loses their staff role', async()=>{
  await rollback(async()=>{
    const request = await scalar("SELECT id FROM password_reset_requests WHERE requested_by=$1 AND status='pending' LIMIT 1",[siblingAgent]);
    await db.query('DELETE FROM user_roles WHERE user_id=$1',[siblingAgent]);
    const result = await edge('approve-password-reset',admin,{requestId:request,action:'reject'});
    assert.equal(result.status,200);
    assert.equal(await scalar('SELECT status FROM password_reset_requests WHERE id=$1',[request]),'rejected');
  });
});

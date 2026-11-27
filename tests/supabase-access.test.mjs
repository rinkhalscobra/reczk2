import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createSupabaseTestDatabase } from './helpers/supabaseTestDatabase.mjs';

const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const [admin, agent, otherAgent, customer, otherCustomer, groupAdmin, supervisor] = [1, 2, 3, 4, 5, 6, 7].map(id);
const [group, otherGroup] = [101, 102].map(id);
const singlePath = `${agent}/single.pdf`;
const multiplePaths = [`${agent}/one.pdf`, `${agent}/two.pdf`];
const privatePath = `${otherCustomer}/private.pdf`;
let db;
let messageId;

const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
async function asUser(user, action) {
  await db.exec('SET ROLE authenticated');
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false),
    set_config('request.jwt.claim.role', 'authenticated', false)`, [user]);
  try {
    return await action();
  } finally {
    await db.exec(`RESET ROLE;
      SELECT set_config('request.jwt.claim.sub', '', false),
        set_config('request.jwt.claim.role', 'service_role', false)`);
  }
}
const canRead = (user, name) => asUser(user, async () =>
  await scalar('SELECT count(*)::int FROM storage.objects WHERE name = $1', [name]) === 1);

before(async () => {
  db = await createSupabaseTestDatabase();
  for (const user of [admin, agent, otherAgent, customer, otherCustomer, groupAdmin, supervisor]) {
    await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ($1, $2, '{}')`, [user, `fixture-${user}@audit.invalid`]);
  }
  await db.query("INSERT INTO groups (id, name) VALUES ($1, 'A'), ($2, 'B')", [group, otherGroup]);
  for (const [user, role] of [[admin, 'admin'], [agent, 'agent'], [otherAgent, 'agent'], [groupAdmin, 'group_admin'], [supervisor, 'supervisor']]) {
    await db.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [user, role]);
  }
  for (const user of [agent, customer, groupAdmin, supervisor]) {
    await db.query('UPDATE profiles SET group_id = $1 WHERE id = $2', [group, user]);
  }
  for (const user of [otherAgent, otherCustomer]) {
    await db.query('UPDATE profiles SET group_id = $1 WHERE id = $2', [otherGroup, user]);
  }
  await db.query('UPDATE profiles SET supervisor_id=$1 WHERE id=$2', [supervisor, agent]);
  await db.query('UPDATE profiles SET assigned_to = $1 WHERE id = $2', [agent, customer]);
  await db.query('UPDATE profiles SET assigned_to = $1 WHERE id = $2', [otherAgent, otherCustomer]);
  for (const path of [singlePath, ...multiplePaths, privatePath, `${customer}/draft.pdf`]) {
    await db.query(`INSERT INTO storage.objects (bucket_id, name, owner_id)
      VALUES ('chat-attachments', $1, $2)`, [path, path.split('/')[0]]);
  }
  messageId = await scalar(`INSERT INTO messages
    (conversation_id, sender_id, recipient_id, content, attachment_url)
    VALUES ($1, $2, $3, 'Single attachment', $4) RETURNING id`, [id(201), agent, customer, singlePath]);
  await db.query(`INSERT INTO messages
    (conversation_id, sender_id, recipient_id, content, attachment_url)
    VALUES ($1, $2, $3, 'Multiple attachments', $4)`, [id(201), agent, customer, JSON.stringify(multiplePaths)]);
});
after(async () => { await db?.close(); });

test('admins, group admins, supervisors and assigned agents can repeatedly adjust every fiat currency', async () => {
  for (const actor of [admin, groupAdmin, supervisor, agent]) {
    for (const currency of ['EUR', 'USD', 'CAD']) {
      const before = Number(await scalar('SELECT balance FROM customer_balances WHERE customer_id = $1 AND currency = $2', [customer, currency]));
      const notificationsBefore = await scalar('SELECT count(*)::int FROM notifications WHERE user_id = $1', [customer]);
      const adjust = (amount, type, reason = null) => asUser(actor, () => scalar(
        'SELECT adjust_fiat_balance($1, $2, $3, $4, $5)', [customer, currency, amount, type, reason],
      ));
      assert.equal(Number(await adjust(132874, 'credit', 'Fondi recuperati')), before + 132874);
      assert.equal(Number(await adjust(0.01, 'credit')), before + 132874.01);
      assert.equal(Number(await adjust(132874.01, 'debit')), before);
      assert.equal(await scalar('SELECT count(*)::int FROM notifications WHERE user_id = $1', [customer]), notificationsBefore + 3);
      assert.equal(await scalar('SELECT count(*)::int FROM customer_balances WHERE customer_id = $1 AND currency = $2', [customer, currency]), 1);
      await assert.rejects(adjust(before + 1, 'debit'), /Insufficient/);
      assert.equal(Number(await scalar('SELECT balance FROM customer_balances WHERE customer_id = $1 AND currency = $2', [customer, currency])), before);
      assert.equal(await scalar('SELECT count(*)::int FROM notifications WHERE user_id = $1', [customer]), notificationsBefore + 3);
    }
  }
});

test('recipient can read an agent attachment and the uploader can read their own file', async () => {
  assert.equal(await canRead(customer, singlePath), true);
  assert.equal(await canRead(agent, singlePath), true);
});

test('recipient can read every attachment in a JSON array', async () => {
  for (const path of multiplePaths) assert.equal(await canRead(customer, path), true);
});

test('unrelated agents and customers cannot read another conversation attachment', async () => {
  assert.equal(await canRead(otherAgent, singlePath), false);
  assert.equal(await canRead(otherCustomer, singlePath), false);
  assert.equal(await canRead(agent, privatePath), false);
});

test('group administrators and supervisors can read linked customer attachments in their scope', async () => {
  assert.equal(await canRead(groupAdmin, singlePath), true);
  assert.equal(await canRead(supervisor, singlePath), true);
  assert.equal(await canRead(groupAdmin, privatePath), false);
  assert.equal(await canRead(supervisor, privatePath), false);
});

test('unshared uploads remain private to their owner and administrators', async () => {
  assert.equal(await canRead(customer, `${customer}/draft.pdf`), true);
  assert.equal(await canRead(agent, `${customer}/draft.pdf`), false);
  assert.equal(await canRead(admin, privatePath), true);
});

test('a forged message attachment cannot share a file outside its sender folder', async () => {
  await asUser(customer, async () => {
    await db.query(`INSERT INTO messages
      (conversation_id, sender_id, recipient_id, content, attachment_url)
      VALUES ($1, $2, $3, 'Forged reference', $4)`, [id(201), customer, agent, privatePath]);
  });
  assert.equal(await canRead(customer, privatePath), false);
  assert.equal(await canRead(agent, privatePath), false);
});

test('malformed or non-array JSON attachment values do not break or widen access', async () => {
  for (const attachment of ['[broken', JSON.stringify({ [privatePath]: true }), JSON.stringify(privatePath)]) {
    await db.query(`INSERT INTO messages
      (conversation_id, sender_id, recipient_id, content, attachment_url)
      VALUES ($1, $2, $3, 'Malformed reference', $4)`, [id(201), otherCustomer, customer, attachment]);
  }
  assert.equal(await canRead(customer, privatePath), false);
  assert.equal(await canRead(customer, singlePath), true);
});

test('recipient can mark a message read', async () => {
  await asUser(customer, () => db.query('UPDATE messages SET is_read = true WHERE id = $1', [messageId]));
  assert.equal(await scalar('SELECT is_read FROM messages WHERE id = $1', [messageId]), true);
});

test('recipient cannot rewrite sender, recipient, content, or attachment to gain file access', async () => {
  await asUser(customer, async () => {
    for (const [column, value] of [['sender_id', otherCustomer], ['recipient_id', otherCustomer], ['content', 'Forged'], ['attachment_url', privatePath]]) {
      await assert.rejects(db.query(`UPDATE messages SET ${column} = $1 WHERE id = $2`, [value, messageId]), /permission denied/);
    }
  });
});

test('uploads require both the caller folder and matching owner metadata', async () => {
  await asUser(customer, async () => {
    await db.query(`INSERT INTO storage.objects (bucket_id, name, owner_id)
      VALUES ('chat-attachments', $1, $2)`, [`${customer}/new.pdf`, customer]);
    for (const [path, owner] of [[`${otherCustomer}/forged.pdf`, customer], [`${customer}/wrong-owner.pdf`, otherCustomer]]) {
      await assert.rejects(db.query(`INSERT INTO storage.objects (bucket_id, name, owner_id)
        VALUES ('chat-attachments', $1, $2)`, [path, owner]), /row-level security/);
    }
  });
});

test('KYC upload and read policies remain scoped to the customer', async () => {
  const path = `${customer}/kyc.pdf`;
  await asUser(customer, () => db.query(`INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('kyc-documents', $1, $2)`, [path, customer]));
  assert.equal(await canRead(customer, path), true);
  assert.equal(await canRead(otherCustomer, path), false);
});

test('sensitive RPCs deny anon while preserving authenticated and service-role execution', async () => {
  const names = ['adjust_crypto_balance', 'adjust_fiat_balance', 'can_manage_customer', 'delete_crypto_balance', 'get_user_sessions_for_staff', 'review_kyc_submission', 'save_kyc_submission', 'set_balance_dashboard_visibility', 'set_managed_user_role'];
  const { rows } = await db.query(`SELECT proname,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND proname = ANY($1::text[])`, [names]);
  assert.equal(rows.length, names.length);
  for (const row of rows) assert.deepEqual([row.anon, row.authenticated, row.service], [false, true, true], row.proname);
  assert.equal(await scalar("SELECT has_function_privilege('anon', 'validate_promocode(text)', 'EXECUTE')"), false);
});

test('all frontend Realtime tables belong to the publication', async () => {
  const { rows } = await db.query("SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'");
  for (const name of ['customer_notes', 'case_timeline', 'password_reset_requests', 'role_permissions']) {
    assert.ok(rows.some(row => row.tablename === name), name);
  }
  assert.equal(rows.length, 13);
});

async function createUngroupedCustomer(value) {
  const customerId = id(value);
  await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES ($1, $2, '{}')`, [customerId, `fixture-${customerId}@audit.invalid`]);
  return customerId;
}

test('Superior Admin must put an ungrouped client in the agent group before assignment', async () => {
  const customerId = await createUngroupedCustomer(301);
  await asUser(admin, () => assert.rejects(db.query('UPDATE profiles SET assigned_to=$1 WHERE id=$2', [agent, customerId]), /same group/));
  await asUser(admin, () => db.query('SELECT set_customer_group($1,$2)', [customerId, group]));
  await asUser(admin, () => db.query('UPDATE profiles SET assigned_to=$1 WHERE id=$2', [agent, customerId]));
  assert.equal(await asUser(agent, () => scalar('SELECT count(*)::int FROM profiles WHERE id=$1', [customerId])), 1);
});

test('unassigning a customer retains their existing group', async () => {
  const customerId = await createUngroupedCustomer(302);
  await db.query('UPDATE profiles SET group_id = $1 WHERE id = $2', [group, customerId]);
  await asUser(admin, async () => {
    await db.query('UPDATE profiles SET assigned_to = $1 WHERE id = $2', [agent, customerId]);
    await db.query('UPDATE profiles SET assigned_to = NULL WHERE id = $1', [customerId]);
  });
  const { rows } = await db.query('SELECT assigned_to, group_id FROM profiles WHERE id = $1', [customerId]);
  assert.deepEqual(rows[0], { assigned_to: null, group_id: group });
});

test('Superior Admin cannot assign a client to another group agent', async () => {
  const customerId = await createUngroupedCustomer(309);
  await db.query('UPDATE profiles SET group_id=$1 WHERE id=$2', [group, customerId]);
  await asUser(admin, () => assert.rejects(db.query('UPDATE profiles SET assigned_to=$1 WHERE id=$2', [otherAgent, customerId]), /same group/));
  assert.equal(await scalar('SELECT assigned_to FROM profiles WHERE id=$1', [customerId]), null);
});

test('Superior Admin cannot assign a client to an agent on another platform', async () => {
  const customerId = await createUngroupedCustomer(303);
  await db.query("UPDATE profiles SET platform='chargeback', group_id=$1 WHERE id=$2", [group,customerId]);
  await asUser(admin, () => assert.rejects(db.query('UPDATE profiles SET assigned_to=$1 WHERE id=$2', [agent, customerId]), /same group and platform/));
  assert.equal(await asUser(agent, () => scalar('SELECT count(*)::int FROM profiles WHERE id=$1', [customerId])), 0);
});

test('a supervisor is not accepted as a customer assignee', async () => {
  const customerId = await createUngroupedCustomer(304);
  await asUser(admin, () => assert.rejects(
    db.query('UPDATE profiles SET assigned_to = $1 WHERE id = $2', [supervisor, customerId]), /agent/,
  ));
});

test('a customer cannot claim an agent or join their group by updating themselves', async () => {
  const customerId = await createUngroupedCustomer(305);
  await asUser(customerId, () => assert.rejects(
    db.query('UPDATE profiles SET assigned_to = $1 WHERE id = $2', [agent, customerId]), /protected profile fields/,
  ));
  assert.equal(await scalar('SELECT group_id FROM profiles WHERE id = $1', [customerId]), null);
});

test('group staff cannot claim an ungrouped customer outside their visible scope', async () => {
  const customerId = await createUngroupedCustomer(306);
  for (const actor of [agent, groupAdmin, supervisor]) {
    await asUser(actor, async () => {
      const { rows } = await db.query('UPDATE profiles SET assigned_to = $1 WHERE id = $2 RETURNING id', [agent, customerId]);
      assert.deepEqual(rows, []);
    });
  }
  assert.equal(await scalar('SELECT group_id FROM profiles WHERE id = $1', [customerId]), null);
});

test('group admins assign clients and supervisors manage their already assigned clients', async () => {
  for (const [value, actor] of [[307, groupAdmin], [308, supervisor]]) {
    const customerId = await createUngroupedCustomer(value);
    await db.query('UPDATE profiles SET group_id = $1 WHERE id = $2', [group, customerId]);
    if (actor === supervisor) await db.query('UPDATE profiles SET assigned_to=$1 WHERE id=$2', [agent,customerId]);
    await asUser(actor, () => db.query('UPDATE profiles SET assigned_to = $1 WHERE id = $2', [agent, customerId]));
    assert.equal(await scalar('SELECT assigned_to FROM profiles WHERE id = $1', [customerId]), agent);
  }
});

test('administrator can place an ungrouped customer into a group without selecting an agent', async () => {
  const customerId = await createUngroupedCustomer(401);
  const profile = await asUser(admin, () => scalar('SELECT row_to_json(set_customer_group($1, $2))', [customerId, group]));
  assert.equal(profile.group_id, group);
  assert.equal(profile.assigned_to, null);
  assert.equal(await scalar('SELECT group_id FROM profiles WHERE id = $1', [customerId]), group);
});

test('group transfer clears the previous agent and removes previous group staff access', async () => {
  const customerId = await createUngroupedCustomer(402);
  await db.query('UPDATE profiles SET group_id = $1, assigned_to = $2 WHERE id = $3', [group, agent, customerId]);
  const profile = await asUser(admin, () => scalar('SELECT row_to_json(set_customer_group($1, $2))', [customerId, otherGroup]));
  assert.equal(profile.group_id, otherGroup);
  assert.equal(profile.assigned_to, null);
  assert.equal(await asUser(agent, () => scalar('SELECT count(*)::int FROM profiles WHERE id = $1', [customerId])), 0);
  for (const actor of [groupAdmin, supervisor]) {
    assert.equal(await asUser(actor, () => scalar('SELECT count(*)::int FROM profiles WHERE id = $1', [customerId])), 0);
  }
});

test('selecting the current group retains its valid agent assignment', async () => {
  const customerId = await createUngroupedCustomer(403);
  await db.query('UPDATE profiles SET group_id = $1, assigned_to = $2 WHERE id = $3', [group, agent, customerId]);
  const profile = await asUser(admin, () => scalar('SELECT row_to_json(set_customer_group($1, $2))', [customerId, group]));
  assert.equal(profile.assigned_to, agent);
});

test('removing a client group clears its old agent assignment', async () => {
  const customerId = await createUngroupedCustomer(404);
  await db.query('UPDATE profiles SET group_id = $1, assigned_to = $2 WHERE id = $3', [group, agent, customerId]);
  const profile = await asUser(admin, () => scalar('SELECT row_to_json(set_customer_group($1, NULL))', [customerId]));
  assert.equal(profile.group_id, null);
  assert.equal(profile.assigned_to, null);
});

test('group transfers reject destination groups on a different platform', async () => {
  const customerId = await createUngroupedCustomer(405);
  const foreignGroup = id(151);
  await db.query("INSERT INTO groups (id, name, platform) VALUES ($1, 'Other brand', 'chargeback')", [foreignGroup]);
  await asUser(admin, () => assert.rejects(
    db.query('SELECT set_customer_group($1, $2)', [customerId, foreignGroup]), /same platform/,
  ));
  assert.equal(await scalar('SELECT group_id FROM profiles WHERE id = $1', [customerId]), null);
});

test('group transfers reject nonexistent groups and customers', async () => {
  const customerId = await createUngroupedCustomer(406);
  await asUser(admin, async () => {
    await assert.rejects(db.query('SELECT set_customer_group($1, $2)', [customerId, id(999)]), /group does not exist/);
    await assert.rejects(db.query('SELECT set_customer_group($1, $2)', [id(999), group]), /Customer was not found/);
  });
});

test('the customer group action cannot be used to move staff accounts', async () => {
  await asUser(admin, () => assert.rejects(
    db.query('SELECT set_customer_group($1, $2)', [agent, otherGroup]), /Only client accounts/,
  ));
  assert.equal(await scalar('SELECT group_id FROM profiles WHERE id = $1', [agent]), group);
});

test('customers and non-administrator staff cannot call the group transfer RPC', async () => {
  for (const actor of [customer, agent, groupAdmin, supervisor]) {
    await asUser(actor, () => assert.rejects(
      db.query('SELECT set_customer_group($1, $2)', [customer, otherGroup]), /Only Superior Admin/,
    ));
  }
});

test('the group transfer RPC has no anonymous execution grant', async () => {
  assert.equal(await scalar("SELECT has_function_privilege('anon', 'set_customer_group(uuid,uuid)', 'EXECUTE')"), false);
  assert.equal(await scalar("SELECT has_function_privilege('authenticated', 'set_customer_group(uuid,uuid)', 'EXECUTE')"), true);
});

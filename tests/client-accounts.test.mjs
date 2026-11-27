import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { before, after, test } from 'node:test';
import ts from 'typescript';
import { createSupabaseTestDatabase } from './helpers/supabaseTestDatabase.mjs';

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const helpers = {};
vm.runInNewContext(compile(readFileSync(new URL('../supabase/functions/_shared/clientAccounts.ts', import.meta.url), 'utf8')
  .replace(/export /g, '') + '\nObject.assign(helpers, { createCaseLoginEmail, publicContactEmail });'), { helpers, TextEncoder, crypto: globalThis.crypto });

test('case identities are stable for the same email/case and distinct for different cases', async () => {
  const email = `${'x'.repeat(64)}@example.test`;
  const first = await helpers.createCaseLoginEmail(email, 'CASE-1');
  const second = await helpers.createCaseLoginEmail(email, 'CASE-2');
  assert.notEqual(first, second);
  assert.equal(first, await helpers.createCaseLoginEmail(email.toUpperCase(), ' case-1 '));
  assert.equal(first.split('@')[0].length, 64);
  assert.equal(first.split('@')[1], 'example.test');
  assert.match(await helpers.createCaseLoginEmail(' Alice+support@Example.Test ', 'CASE-1'), /^alice\+support\+case-[a-f0-9]{32}@example.test$/);
});

test('user-facing addresses always prefer the contact email and suppress internal identities', () => {
  const alias = 'shared+account-0123456789abcdef0123456789abcdef@example.test';
  assert.equal(helpers.publicContactEmail({ email: alias, user_metadata: { display_email: 'shared@example.test' } }), 'shared@example.test');
  assert.equal(helpers.publicContactEmail({ email: alias }), '');
  assert.equal(helpers.publicContactEmail({ email: alias, user_metadata: { display_email: alias } }), '');
  assert.equal(helpers.publicContactEmail({ email: 'existing@example.test' }), 'existing@example.test');
});

const firstId = '30000000-0000-4000-8000-000000000001';
const secondId = '30000000-0000-4000-8000-000000000002';
const legacyId = '30000000-0000-4000-8000-000000000003';
const legacyStaffId = '31000000-0000-4000-8000-000000000001';
const contact = 'shared@example.test';
const secondLogin = 'shared+account-0123456789abcdef0123456789abcdef@example.test';
let db;
before(async () => {
  db = await createSupabaseTestDatabase({
    beforeMigration: async (database, name) => {
      if (name.startsWith('20261118120000')) await database.query(
        'INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)',
        [legacyId, 'legacy@example.test', {}],
      );
      if (name.startsWith('20261118140000')) {
        for (const suffix of ['4', '5']) {
          const id = `30000000-0000-4000-8000-00000000000${suffix}`;
          await database.query('INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)',
            [id, `legacy-${suffix}@example.test`, { display_email: 'legacy-shared@example.test' }]);
          await database.query('UPDATE profiles SET case_number = $1 WHERE id = $2', [' legacy-001 ', id]);
        }
      }
      if (name.startsWith('20261119100000')) {
        await database.query('INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)',
          [legacyStaffId, 'legacy-staff@example.test', {}]);
        await database.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'agent')", [legacyStaffId]);
      }
    },
  });
  for (const [id, login] of [[firstId, contact], [secondId, secondLogin]]) {
    await db.query('INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)',
      [id, login, { first_name: 'Shared', display_email: contact, case_number: id === firstId ? 'CASE-ONE' : 'CASE-TWO' }]);
  }
});
after(async () => { if (db) await db.close(); });

test('migration preserves existing accounts and stores contact and login emails independently', async () => {
  const rows = (await db.query('SELECT id, email, login_email FROM profiles WHERE id = ANY($1::uuid[]) ORDER BY id', [[firstId, secondId, legacyId]])).rows;
  assert.deepEqual(rows, [
    { id: firstId, email: contact, login_email: contact },
    { id: secondId, email: contact, login_email: secondLogin },
    { id: legacyId, email: 'legacy@example.test', login_email: 'legacy@example.test' },
  ]);
  const balances = (await db.query('SELECT customer_id, count(*)::int AS count FROM customer_balances GROUP BY customer_id')).rows;
  assert.equal(balances.find(row => row.customer_id === firstId).count, 3);
  assert.equal(balances.find(row => row.customer_id === secondId).count, 3);
});

test('case migration preserves existing cases and repairs missing or duplicate legacy case numbers', async () => {
  const rows = (await db.query("SELECT id, case_number FROM profiles WHERE email = 'legacy-shared@example.test' ORDER BY id")).rows;
  assert.equal(rows[0].case_number, 'LEGACY-001');
  assert.match(rows[1].case_number, /^CX-\d{8}$/);
  assert.match((await db.query('SELECT case_number FROM profiles WHERE id = $1', [legacyId])).rows[0].case_number, /^CX-\d{8}$/);
});

test('client-only migration clears existing staff cases while preserving client cases and staff login', async () => {
  assert.deepEqual((await db.query('SELECT case_number, login_email FROM profiles WHERE id = $1', [legacyStaffId])).rows,
    [{ case_number: null, login_email: 'legacy-staff@example.test' }]);
  assert.equal((await db.query('SELECT case_number FROM profiles WHERE id = $1', [firstId])).rows[0].case_number, 'CASE-ONE');
});

test('all CRM roles have no case; promotions clear cases and demotions allocate a client case', async () => {
  await db.exec('BEGIN');
  try {
    const id = '31000000-0000-4000-8000-000000000002';
    await db.query('INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)',
      [id, 'role-transition@example.test', { case_number: 'INITIAL-CASE' }]);
    for (const role of ['admin', 'group_admin', 'supervisor', 'agent']) {
      // The legacy test database has no administrator; keep a second one so the
      // existing last-administrator protection permits this role transition.
      if (role === 'admin') await db.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')", [firstId]);
      await db.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [id, role]);
      assert.equal((await db.query('SELECT case_number FROM profiles WHERE id = $1', [id])).rows[0].case_number, null);
      await db.query('UPDATE profiles SET case_number = $1 WHERE id = $2', ['SHOULD-NOT-STICK', id]);
      assert.equal((await db.query('SELECT case_number FROM profiles WHERE id = $1', [id])).rows[0].case_number, null);
      await db.query('DELETE FROM user_roles WHERE user_id = $1', [id]);
      assert.match((await db.query('SELECT case_number FROM profiles WHERE id = $1', [id])).rows[0].case_number, /^CX-\d{8}$/);
    }
  } finally { await db.exec('ROLLBACK'); }
});

test('untrusted staff metadata cannot exempt a client from case assignment', async () => {
  await db.exec('BEGIN');
  try {
    const id = '31000000-0000-4000-8000-000000000003';
    await db.query('INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)',
      [id, 'forged-staff@example.test', { role: 'admin', account_type: 'staff' }]);
    assert.match((await db.query('SELECT case_number FROM profiles WHERE id = $1', [id])).rows[0].case_number, /^CX-\d{8}$/);
    await db.query('UPDATE profiles SET case_number = NULL WHERE id = $1', [id]);
    assert.match((await db.query('SELECT case_number FROM profiles WHERE id = $1', [id])).rows[0].case_number, /^CX-\d{8}$/);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM user_roles WHERE user_id = $1', [id])).rows[0].count, 0);
  } finally { await db.exec('ROLLBACK'); }
});

test('staff login resolves promoted client identities without cases and stays unavailable to browser roles', async () => {
  await db.exec('BEGIN');
  try {
    await db.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'supervisor')", [secondId]);
    assert.deepEqual((await db.query('SELECT * FROM get_staff_login_account($1)', [' SHARED@EXAMPLE.TEST '])).rows,
      [{ id: secondId, login_email: secondLogin }]);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query("SELECT has_function_privilege($1, 'public.get_staff_login_account(text)', 'EXECUTE') AS allowed", [role])).rows[0].allowed, false);
    }
  } finally { await db.exec('ROLLBACK'); }
});

test('duplicate email/case registrations roll back while different cases keep independent accounts', async () => {
  assert.deepEqual((await db.query('SELECT case_number FROM profiles WHERE id = ANY($1::uuid[]) ORDER BY id', [[firstId, secondId]])).rows,
    [{ case_number: 'CASE-ONE' }, { case_number: 'CASE-TWO' }]);
  const rejected = '30000000-0000-4000-8000-000000000006';
  await assert.rejects(db.query('INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)',
    [rejected, 'another-auth-identity@example.test', { display_email: contact.toUpperCase(), case_number: ' case-one ' }]), /profiles_email_case_number_idx/);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM auth.users WHERE id = $1', [rejected])).rows[0].count, 0);
  const registrations = await Promise.allSettled(['7', '8'].map(suffix => db.query(
    'INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)',
    [`30000000-0000-4000-8000-00000000000${suffix}`, `race-${suffix}@example.test`, { display_email: 'race@example.test', case_number: 'CONCURRENT-CASE' }],
  )));
  assert.equal(registrations.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM profiles WHERE email = 'race@example.test'")).rows[0].count, 1);
});

test('client case spelling survives inserts and updates while duplicates remain case-insensitive', async () => {
  await db.exec('BEGIN');
  try {
    const id = '32000000-0000-4000-8000-000000000001';
    const duplicate = '32000000-0000-4000-8000-000000000002';
    await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,$2,$3)',
      [id, 'mixed-login@example.test', { display_email: 'mixed@example.test', case_number: ' Case@551 ' }]);
    assert.equal((await db.query('SELECT case_number FROM profiles WHERE id=$1', [id])).rows[0].case_number, 'Case@551');
    for (const value of ['case@551', 'CASE@551', 'Case@551']) {
      await db.query('UPDATE profiles SET case_number=$1 WHERE id=$2', [value, id]);
      assert.equal((await db.query('SELECT case_number FROM profiles WHERE id=$1', [id])).rows[0].case_number, value);
    }
    await db.exec('SAVEPOINT duplicate_case');
    await assert.rejects(db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,$2,$3)',
      [duplicate, 'different-login@example.test', { display_email: 'MIXED@example.test', case_number: 'case@551' }]), /profiles_email_case_number_idx/);
    await db.exec('ROLLBACK TO SAVEPOINT duplicate_case');
    assert.equal((await db.query('SELECT login_email FROM profiles WHERE id=$1', [id])).rows[0].login_email, 'mixed-login@example.test');
  } finally { await db.exec('ROLLBACK'); }
});

test('accounts sharing an email cannot read each other or change their login identity', async () => {
  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE authenticated');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [secondId]);
    assert.deepEqual((await db.query('SELECT id FROM profiles')).rows, [{ id: secondId }]);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM customer_balances WHERE customer_id = $1', [firstId])).rows[0].count, 0);
    assert.equal((await db.query('SELECT login_email FROM profiles WHERE id = $1', [secondId])).rows[0].login_email, secondLogin);
    await assert.rejects(db.query('UPDATE profiles SET login_email = $1 WHERE id = $2', [contact, secondId]), /protected/);
  } finally { await db.exec('ROLLBACK'); }
});

test('Auth email changes synchronize the login without changing the shared contact email', async () => {
  await db.exec('BEGIN');
  try {
    await db.query('UPDATE auth.users SET email = $1 WHERE id = $2', ['new-login@example.test', secondId]);
    assert.deepEqual((await db.query('SELECT email, login_email FROM profiles WHERE id = $1', [secondId])).rows,
      [{ email: contact, login_email: 'new-login@example.test' }]);
  } finally { await db.exec('ROLLBACK'); }
});

async function checkMfa(functionName, loginEmail) {
  let handler;
  const lookups = [];
  const client = {
    from(table) {
      const filters = {};
      const execute = async () => {
        lookups.push({ table, ...filters });
        if (table === 'profiles') return { data: { id: filters.login_email === contact ? firstId : secondId }, error: null };
        if (table === 'user_roles') return { data: filters.user_id === firstId ? { role: 'admin' } : null, error: null };
        if (table === 'user_mfa') return { data: { is_enabled: filters.user_id === firstId, backup_codes: ['TEST-CODE'] }, error: null };
        throw new Error(`Unexpected MFA lookup: ${table}`);
      };
      const query = { select() { return query; }, eq(key, value) { filters[key] = value; return query; }, maybeSingle: execute, single: execute };
      return query;
    },
  };
  const source = readFileSync(new URL(`../supabase/functions/${functionName}/index.ts`, import.meta.url), 'utf8').replace(/^import[^\n]+\n/gm, '');
  vm.runInNewContext(compile(source), {
    Request, Response, crypto: globalThis.crypto,
    serve: callback => { handler = callback; }, createClient: () => client,
    Deno: { env: { get: () => 'test-only' } }, console: { log() {}, error() {} },
  });
  const response = await handler(new Request('https://edge.example.test/mfa', {
    method: 'POST', body: JSON.stringify({ email: loginEmail, code: 'TEST-CODE' }),
  }));
  return { status: response.status, body: await response.json(), lookups };
}

test('MFA checks and validation resolve the exact login even when another account shares the contact email', async () => {
  const original = await checkMfa('mfa-check', contact);
  assert.equal(original.body.mfaRequired, true);
  const duplicate = await checkMfa('mfa-check', secondLogin);
  assert.equal(duplicate.body.mfaRequired, false);
  assert.equal(duplicate.lookups[0].login_email, secondLogin);
  assert.equal(duplicate.lookups[1].user_id, secondId);
  const validated = await checkMfa('mfa-validate', secondLogin);
  assert.equal(validated.body.valid, true);
  assert.equal(validated.lookups[1].user_id, secondId);
});

test('credential rate limits are atomic, expire and cannot be read or invoked by browser roles', async () => {
  const emailKey = 'a'.repeat(64), ipKey = 'b'.repeat(64);
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await db.query('SELECT consume_account_auth_attempt($1, $2) AS allowed', [emailKey, ipKey])).rows[0].allowed, true);
  }
  assert.equal((await db.query('SELECT consume_account_auth_attempt($1, $2) AS allowed', [emailKey, ipKey])).rows[0].allowed, false);
  await db.exec("UPDATE account_auth_attempts SET window_started_at = now() - interval '6 minutes'");
  assert.equal((await db.query('SELECT consume_account_auth_attempt($1, $2) AS allowed', [emailKey, ipKey])).rows[0].allowed, true);
  for (const role of ['anon', 'authenticated']) {
    await db.exec('BEGIN');
    try {
      await db.exec(`SET LOCAL ROLE ${role}`);
      await assert.rejects(db.query('SELECT consume_account_auth_attempt($1, $2)', [emailKey, ipKey]), /permission denied/);
    } finally { await db.exec('ROLLBACK'); }
    await db.exec('BEGIN');
    try {
      await db.exec(`SET LOCAL ROLE ${role}`);
      await assert.rejects(db.query('SELECT * FROM account_auth_attempts'), /permission denied/);
    } finally { await db.exec('ROLLBACK'); }
  }
});

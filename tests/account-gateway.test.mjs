import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const firstId = '40000000-0000-4000-8000-000000000001';
const secondId = '40000000-0000-4000-8000-000000000002';
const email = 'shared@example.test';
const alias = 'shared+account-0123456789abcdef0123456789abcdef@example.test';
const profiles = [
  { id: firstId, login_email: email, first_name: 'First', last_name: 'Client', case_number: 'CASE-1', created_at: '2026-11-01T12:00:00Z' },
  { id: secondId, login_email: alias, first_name: 'Second', last_name: 'Client', case_number: 'CASE-2', created_at: '2026-11-02T12:00:00Z' },
];
const sessionFor = profile => ({ access_token: `access-${profile.id}`, refresh_token: `refresh-${profile.id}`, user: {
  id: profile.id, email: profile.login_email, user_metadata: { display_email: email },
} });

function gateway(functionName = 'account-login', options = {}) {
  const settings = {
    profiles, passwords: ['first-password', 'second-password'], mfa: [],
    ...options,
  };
  const calls = { passwords: [], signups: [], limits: [], mfa: [], queries: [] };
  let clock = Date.now();
  let handler;
  const admin = {
    rpc: async (name, args) => {
      if (name === 'get_staff_login_account') return { data: settings.staffAccounts || [], error: settings.staffLookupError ? { message: alias } : null };
      calls.limits.push({ name, args });
      return { data: !settings.throttled, error: settings.limitError ? { message: 'Private backend detail' } : null };
    },
    from(table) {
      const filters = {};
      const execute = async () => {
        calls.queries.push({ table, ...filters });
        if (table === 'profiles') return { data: settings.profiles.filter(profile => !filters.case_number || profile.case_number.toUpperCase() === filters.case_number.replace(/\\([\\%_])/g, '$1').toUpperCase()), error: settings.lookupError ? { message: alias } : null };
        if (table === 'user_roles') return { data: settings.staffRole ? { role: settings.staffRole } : null, error: settings.roleError ? { message: alias } : null };
        if (table === 'user_mfa') return { data: { is_enabled: settings.mfa.includes(filters.user_id) }, error: settings.mfaError ? { message: alias } : null };
        throw new Error(`Unexpected table: ${table}`);
      };
      const query = {
        select() { return query; }, eq(key, value) { filters[key] = value; return query; },
        ilike(key, value) { filters[key] = value; return query; }, order() { return query; }, limit() { return query; },
        maybeSingle: execute, then(resolve, reject) { return execute().then(resolve, reject); },
      };
      return query;
    },
    functions: { invoke: async (name, { body }) => {
      calls.mfa.push({ name, ...body });
      return { data: settings.mfaFailOpen ? { valid: true, mfaRequired: false } : { valid: body.code === '123456' }, error: null };
    } },
  };
  const client = { auth: {
    signInWithPassword: async body => {
      calls.passwords.push(body);
      const index = settings.profiles.findIndex(profile => profile.login_email === body.email);
      if (settings.authError) return { data: {}, error: settings.authError };
      if (index < 0 || settings.passwords[index] !== body.password) return { data: {}, error: { code: 'invalid_credentials', status: 400 } };
      const session = sessionFor(settings.profiles[index]);
      return { data: { session, user: session.user }, error: null };
    },
    signUp: async body => {
      calls.signups.push(body);
      if (settings.signupError) return { data: {}, error: settings.signupError };
      if (calls.signups.length === 1 && settings.duplicate) return settings.obfuscated
        ? { data: { user: { identities: [] }, session: null }, error: null }
        : { data: {}, error: { code: 'user_already_exists', message: 'User already registered' } };
      const user = { id: secondId, email: body.email, user_metadata: body.options.data };
      return { data: { user, session: settings.confirmation ? null : { access_token: 'new-access', refresh_token: 'new-refresh', user } }, error: null };
    },
  } };
  const files = ['_shared/authGateway', '_shared/clientAccounts', `${functionName}/index`];
  const source = files.map(file => readFileSync(new URL(`../supabase/functions/${file}.ts`, import.meta.url), 'utf8')
    .replace(/^import[^\n]+\n/gm, '').replace(/export /g, '')).join('\n');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  vm.runInNewContext(compiled, {
    Request, Response, TextEncoder, TextDecoder, Uint8Array, crypto: globalThis.crypto, btoa, atob,
    Date: class extends Date { static now() { return clock; } },
    Deno: { env: { get: key => ({ SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', SUPABASE_ANON_KEY: 'test-public-key' })[key] }, serve: callback => { handler = callback; } },
    createClient: (_url, key) => key === 'test-service-key' ? admin : client,
  });
  return {
    settings, calls, advance: milliseconds => { clock += milliseconds; },
    async request(body, { ip = '192.0.2.1', method = 'POST', rawBody } = {}) {
      const response = await handler(new Request('https://example.test/auth', {
        method, headers: { 'cf-connecting-ip': ip },
        ...(['POST', 'PUT'].includes(method) ? { body: rawBody ?? JSON.stringify(body) } : {}),
      }));
      return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
    },
  };
}

test('email, case number and exact password select only the matching account', async () => {
  const backend = gateway();
  const result = await backend.request({ email: ' SHARED@EXAMPLE.TEST ', password: 'second-password', caseNumber: ' case-2 ' });
  assert.equal(result.status, 200);
  assert.equal(result.body.session.user.id, secondId);
  assert.equal(result.body.accounts, undefined);
  assert.deepEqual(backend.calls.passwords.map(call => call.email), [alias]);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(JSON.stringify(backend.calls.limits), /shared@example|second-password/);
});

test('the same email and password open different cases directly with no chooser', async () => {
  const backend = gateway('account-login', { passwords: ['same-password', 'same-password'] });
  for (const [caseNumber, id] of [['CASE-1', firstId], ['CASE-2', secondId]]) {
    const selected = await backend.request({ email, password: 'same-password', caseNumber });
    assert.equal(selected.body.session.user.id, id);
    assert.equal(selected.body.accounts, undefined);
    assert.equal(selected.body.ticket, undefined);
  }
});

test('mixed-case numbers preserve registration spelling and sign in with either capitalization', async () => {
  const caseNumber = 'Case@551_%\\end';
  const registration = gateway('register-client');
  const created = await registration.request({ email, password: 'password-123', caseNumber: ` ${caseNumber} ` });
  assert.equal(created.status, 200);
  assert.equal(registration.calls.signups[0].options.data.case_number, caseNumber);
  const login = gateway('account-login', { profiles: [{ ...profiles[0], case_number: caseNumber }] });
  for (const value of [caseNumber, caseNumber.toLowerCase(), caseNumber.toUpperCase()]) {
    const result = await login.request({ email, password: 'first-password', caseNumber: value });
    assert.equal(result.status, 200);
    assert.equal(result.body.session.user.id, firstId);
  }
  assert.equal(login.calls.queries.find(query => query.table === 'profiles').case_number, 'Case@551\\_\\%\\\\end');
  assert.equal((await login.request({ email, password: 'first-password', caseNumber: 'Case@551-anything' })).status, 401);
});

test('wrong passwords, unknown emails and user IDs never reveal account choices or sessions', async () => {
  for (const settings of [{}, { profiles: [] }]) {
    const backend = gateway('account-login', settings);
    const result = await backend.request({ email, password: 'wrong', caseNumber: 'CASE-1', userId: secondId });
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: 'Invalid email, case number, or password' });
  }
  const backend = gateway('account-login', { passwords: ['same-password', 'other-password'] });
  assert.equal((await backend.request({ email, password: 'same-password', caseNumber: 'CASE-1', userId: secondId })).body.session.user.id, firstId);
  assert.equal((await backend.request({ email, password: 'same-password', caseNumber: 'UNKNOWN' })).status, 401);
});

test('changing a client case number preserves its Auth login while the old case stops resolving', async () => {
  const backend = gateway('account-login', { profiles: profiles.map(profile => ({ ...profile })) });
  assert.equal((await backend.request({ email, password: 'first-password', caseNumber: 'CASE-1' })).body.session.user.id, firstId);
  backend.settings.profiles[0].case_number = 'CASE-UPDATED';
  const changed = await backend.request({ email, password: 'first-password', caseNumber: ' case-updated ' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.session.user.id, firstId);
  assert.equal(backend.calls.passwords.at(-1).email, profiles[0].login_email);
  assert.equal((await backend.request({ email, password: 'first-password', caseNumber: 'CASE-1' })).status, 401);
  assert.equal((await backend.request({ email, password: 'second-password', caseNumber: 'CASE-2' })).body.session.user.id, secondId);
});

test('MFA tickets reject tampering, expiration and a different source', async () => {
  const backend = gateway('account-login', { mfa: [firstId] });
  const challenge = await backend.request({ email, password: 'first-password', caseNumber: 'CASE-1' });
  const ticket = challenge.body.ticket;
  assert.equal((await backend.request({ ticket: `${ticket[0] === 'A' ? 'B' : 'A'}${ticket.slice(1)}` })).status, 401);
  assert.equal((await backend.request({ ticket }, { ip: '192.0.2.2' })).status, 401);
  backend.advance(180_001);
  assert.equal((await backend.request({ ticket })).status, 401);
});

test('MFA must complete for the selected account before any session is returned', async () => {
  const backend = gateway('account-login', { mfa: [secondId] });
  const initial = await backend.request({ email, password: 'second-password', caseNumber: 'CASE-2' });
  assert.equal(initial.body.mfaRequired, true);
  assert.equal(initial.body.session, undefined);
  assert.equal((await backend.request({ ticket: initial.body.ticket, code: '000000' })).status, 401);
  backend.settings.mfaFailOpen = true;
  assert.equal((await backend.request({ ticket: initial.body.ticket, code: '123456' })).status, 401);
  backend.settings.mfaFailOpen = false;
  const verified = await backend.request({ ticket: initial.body.ticket, code: '123456', caseNumber: 'CASE-1' });
  assert.equal(verified.body.session.user.id, secondId);
  assert.equal(backend.calls.mfa.at(-1).userId, secondId);
});

test('database or MFA outages fail closed for case-number sign-in', async () => {
  for (const flag of ['limitError', 'lookupError', 'mfaError']) {
    const failed = gateway('account-login', { [flag]: true });
    const result = await failed.request({ email, password: 'first-password', caseNumber: 'CASE-1' });
    assert.equal(result.status, 503);
    assert.equal(result.body.session, undefined);
    assert.doesNotMatch(JSON.stringify(result.body), /account-|Private backend/);
  }
});

test('rate limits run before password checks and Auth throttles are preserved', async () => {
  const backend = gateway('account-login', { throttled: true });
  assert.equal((await backend.request({ email, password: 'first-password', caseNumber: 'CASE-1' })).status, 429);
  assert.equal(backend.calls.passwords.length, 0);
  const upstream = gateway('account-login', { authError: { status: 429, code: 'over_request_rate_limit' } });
  assert.equal((await upstream.request({ email, password: 'first-password', caseNumber: 'CASE-1' })).status, 429);
});

test('clients require a case number while existing staff can still sign in with email and password', async () => {
  const client = gateway();
  const missingCase = await client.request({ email, password: 'first-password' });
  assert.equal(missingCase.status, 400);
  assert.match(missingCase.body.error, /case number/);
  assert.equal(missingCase.body.session, undefined);
  for (const staffRole of ['admin', 'group_admin', 'supervisor', 'agent']) {
    const staff = gateway('account-login', { staffRole, staffAccounts: [{ id: firstId, login_email: email }] });
    assert.equal((await staff.request({ email, password: 'first-password' })).body.session.user.id, firstId);
    assert.equal(staff.calls.passwords.length, 1);
  }
});

test('a promoted client signs in to CRM using their contact email and password without a case', async () => {
  const staff = gateway('account-login', { staffRole: 'supervisor', staffAccounts: [{ id: secondId, login_email: alias }] });
  const result = await staff.request({ email, password: 'second-password' });
  assert.equal(result.status, 200);
  assert.equal(result.body.session.user.id, secondId);
  assert.equal(staff.calls.passwords[0].email, alias);
  assert.equal(staff.calls.passwords.length, 1);
  const failed = gateway('account-login', { staffLookupError: true });
  assert.equal((await failed.request({ email, password: 'first-password' })).status, 503);
  assert.equal(failed.calls.passwords.length, 0);
});

test('public registration always requires a case and ignores retired invitation metadata', async () => {
  for (const caseNumber of ['', 'invalid\u0000case']) {
    const backend = gateway('register-client');
    assert.equal((await backend.request({ email, password: 'password-123', caseNumber, promocode: 'OLD-STAFF', role: 'admin' })).status, 400);
    assert.equal(backend.calls.signups.length, 0);
  }
  const backend = gateway('register-client');
  assert.equal((await backend.request({ email, password: 'password-123', caseNumber: 'CASE-NEW', promocode: 'OLD-STAFF', role: 'admin' })).status, 200);
  assert.equal(backend.calls.signups[0].options.data.promocode, undefined);
  assert.equal(backend.calls.signups[0].options.data.role, undefined);
  assert.equal(backend.calls.signups[0].options.data.case_number, 'CASE-NEW');
  assert.equal(backend.calls.queries.some(query => query.table === 'promocodes'), false);
});

for (const obfuscated of [false, true]) {
  test(`registration rejects an already used case instead of retrying another identity (${obfuscated ? 'obfuscated' : 'explicit'} Auth duplicate)`, async () => {
    const backend = gateway('register-client', { duplicate: true, obfuscated });
    const result = await backend.request({ email, password: 'password-123', caseNumber: '  case-new  ', firstName: 'New', lastName: 'Client', promocode: '  My Code!  ', role: 'admin', groupId: firstId });
    assert.equal(result.status, 409);
    assert.equal(result.body.loginEmail, undefined);
    assert.equal(backend.calls.signups.length, 1);
    assert.match(backend.calls.signups[0].email, /^shared\+case-[a-f0-9]{32}@example.test$/);
    const metadata = backend.calls.signups[0].options.data;
    assert.equal(metadata.display_email, email);
    assert.equal(metadata.promocode, undefined);
    assert.equal(metadata.case_number, 'case-new');
    assert.equal(metadata.role, undefined);
    assert.equal(metadata.group_id, undefined);
  });
}

test('registration keeps weak-password errors normal and preserves the configured email confirmation flow', async () => {
  const failed = gateway('register-client', { signupError: { code: 'weak_password', message: alias } });
  const result = await failed.request({ email, password: 'weak-password', caseNumber: 'CASE-NEW' });
  assert.equal(result.status, 400);
  assert.doesNotMatch(JSON.stringify(result.body), /account-/);
  const confirmed = gateway('register-client', { confirmation: true });
  assert.deepEqual((await confirmed.request({ email, password: 'password-123', caseNumber: 'CASE-NEW' })).body, { success: true, session: null });
});

test('registration requires a valid new case and preserves distinct cases for the same contact email', async () => {
  const backend = gateway('register-client');
  assert.equal((await backend.request({ email, password: 'password-123' })).status, 400);
  assert.equal((await backend.request({ email, password: 'password-123', caseNumber: '   ' })).status, 400);
  assert.equal((await backend.request({ email, password: 'password-123', caseNumber: 'x'.repeat(101) })).status, 400);
  assert.equal((await backend.request({ email, password: 'password-123', caseNumber: 'CASE-\u0000' })).status, 400);
  assert.equal((await backend.request({ email, password: 'password-123', caseNumber: ' case-1 ' })).status, 409);
  assert.equal(backend.calls.signups.length, 0);
  for (const caseNumber of ['CASE-NEW', 'CASE-OTHER']) {
    const created = await backend.request({ email, password: 'password-123', caseNumber });
    assert.equal(created.status, 200);
    assert.equal(created.body.success, true);
  }
  assert.notEqual(backend.calls.signups[0].email, backend.calls.signups[1].email);
});

test('public credential endpoints support preflight and reject invalid methods and requests', async () => {
  for (const name of ['account-login', 'register-client']) {
    const backend = gateway(name);
    assert.equal((await backend.request({}, { method: 'OPTIONS' })).status, 200);
    assert.equal((await backend.request({}, { method: 'GET' })).status, 405);
    assert.equal((await backend.request({}, { rawBody: '{' })).status, 400);
    assert.equal((await backend.request({})).status, 400);
    assert.equal(backend.calls.passwords.length, 0);
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const actorId = '20000000-0000-4000-8000-000000000001';
const targetId = '20000000-0000-4000-8000-000000000002';
const password = 'Temporary-Test-Password-123!';
const source = readFileSync(new URL('../supabase/functions/reset-user-password/index.ts', import.meta.url), 'utf8')
  .replace(/^import[^\n]+\n/gm, '');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

async function changePassword(options = {}) {
  const settings = {
    actorRole: 'admin', targetRole: null, actorGroup: null, targetGroup: null,
    method: 'POST', authorization: 'Bearer test-only', body: { userId: targetId, newPassword: password },
    ...options,
  };
  const updates = [];
  const tokens = [];
  const logs = [];
  const client = {
    rpc: async () => ({ data: settings.actorRole === 'admin' ? 'direct' :
      settings.actorGroup && settings.actorGroup === settings.targetGroup && settings.targetRole !== 'admin'
      && (settings.actorRole === 'group_admin' || (settings.actorRole === 'supervisor' && !['supervisor','group_admin'].includes(settings.targetRole) && settings.supervised !== false)
          || (settings.actorRole === 'agent' && settings.assigned === true)) ? (settings.permissionMode || (settings.actorRole === 'agent' ? 'approval' : 'direct')) : 'deny',
      error: settings.lookupError === 'actorProfile' ? { message: 'Permission service unavailable' } : null }),
    auth: {
      getUser: async token => {
        tokens.push(token);
        return { data: { user: settings.invalidToken ? null : { id: actorId } }, error: settings.invalidToken ? { message: 'Invalid JWT' } : null };
      },
      admin: {
        updateUserById: async (id, value) => {
          updates.push({ id, ...value });
          return { data: { user: settings.unconfirmed ? null : { id } }, error: settings.updateError ? { message: settings.updateError } : null };
        },
      },
    },
    from(table) {
      const filters = {};
      const execute = async () => {
        const isActor = (filters.user_id ?? filters.id) === actorId;
        const key = `${isActor ? 'actor' : 'target'}${table === 'user_roles' ? 'Role' : 'Profile'}`;
        if (settings.lookupError === key) return { data: null, error: { message: 'Temporary database outage' } };
        if (table === 'user_roles') {
          const role = isActor ? settings.actorRole : settings.targetRole;
          return { data: role ? { role } : null, error: null };
        }
        if (table === 'profiles') return {
          data: !isActor && settings.missingTarget ? null : { id: isActor ? actorId : targetId, group_id: isActor ? settings.actorGroup : settings.targetGroup }, error: null,
        };
        throw new Error(`Unexpected table: ${table}`);
      };
      // Deliberately offer no table mutations: passwords must go only to Auth.
      const query = {
        select() { return query; },
        eq(column, value) { filters[column] = value; return query; },
        maybeSingle: execute,
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      return query;
    },
  };
  let handler;
  vm.runInContext(compiled, vm.createContext({
    Request, Response,
    Deno: { env: { get: () => 'test-only' }, serve: callback => { handler = callback; } },
    createClient: () => client,
    console: { log: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) },
  }));
  const headers = { 'Content-Type': 'application/json' };
  if (settings.authorization) headers.Authorization = settings.authorization;
  const response = await handler(new Request('https://edge.example.test/reset-user-password', {
    method: settings.method, headers,
    ...(['POST', 'PUT'].includes(settings.method) ? { body: settings.rawBody ?? JSON.stringify(settings.body) } : {}),
  }));
  return { status: response.status, body: await response.json().catch(() => null), updates, tokens, logs, headers: response.headers };
}

test('admin changes the real Auth password for an ungrouped customer without storing or echoing it', async () => {
  const result = await changePassword();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true, userId: targetId });
  assert.deepEqual(result.updates, [{ id: targetId, password }]);
  assert.deepEqual(result.tokens, ['test-only']);
  assert.ok(!JSON.stringify({ body: result.body, logs: result.logs }).includes(password));
});

test('admin may change a customer password across groups', async () => {
  const result = await changePassword({ actorGroup: 'group-a', targetGroup: 'group-b' });
  assert.equal(result.status, 200);
  assert.equal(result.updates.length, 1);
});

test('password bytes are preserved rather than silently trimmed', async () => {
  const value = ` ${password} `;
  const result = await changePassword({ body: { userId: targetId, newPassword: value } });
  assert.equal(result.status, 200);
  assert.equal(result.updates[0].password, value);
});

test('missing, malformed and invalid authentication is rejected before an Auth write', async () => {
  for (const options of [{ authorization: null }, { authorization: 'Basic test' }, { invalidToken: true }]) {
    const result = await changePassword(options);
    assert.equal(result.status, 401);
    assert.deepEqual(result.updates, []);
  }
});

test('agents and customers cannot directly change another account password', async () => {
  for (const actorRole of ['agent', 'user', null]) {
    const result = await changePassword({ actorRole });
    assert.equal(result.status, 403);
    assert.deepEqual(result.updates, []);
  }
});

test('group administrators and supervisors can reset only accounts in their permitted scope', async () => {
  for (const actorRole of ['group_admin', 'supervisor']) {
    for (const targetRole of actorRole === 'group_admin' ? [null, 'user', 'agent', 'supervisor', 'group_admin'] : [null, 'user', 'agent']) {
      const result = await changePassword({ actorRole, targetRole, actorGroup: 'group-a', targetGroup: 'group-a' });
      assert.equal(result.status, 200);
      assert.equal(result.updates.length, 1);
    }
    for (const options of [
      { actorGroup: null, targetGroup: null },
      { actorGroup: 'group-a', targetGroup: 'group-b' },
      ...(actorRole === 'group_admin' ? ['admin'] : ['supervisor', 'group_admin', 'admin']).map(targetRole => ({ actorGroup: 'group-a', targetGroup: 'group-a', targetRole })),
      ...(actorRole === 'supervisor' ? [{ actorGroup: 'group-a', targetGroup: 'group-a', supervised: false }] : []),
    ]) {
      const result = await changePassword({ actorRole, ...options });
      assert.equal(result.status, 403);
      assert.deepEqual(result.updates, []);
    }
  }
});

test('permission and account lookup errors fail closed', async () => {
  for (const lookupError of ['actorRole', 'targetRole', 'targetProfile', 'actorProfile']) {
    const result = await changePassword({ lookupError, actorRole: 'supervisor', actorGroup: 'group-a', targetGroup: 'group-a' });
    assert.equal(result.status, 500, lookupError);
    assert.deepEqual(result.updates, []);
  }
});

test('unknown customer and attempts to change the acting staff password are rejected', async () => {
  assert.equal((await changePassword({ missingTarget: true })).status, 404);
  const result = await changePassword({ body: { userId: actorId, newPassword: password } });
  assert.equal(result.status, 400);
  assert.deepEqual(result.updates, []);
});

test('malformed request, identifier and weak or blank passwords are rejected', async () => {
  for (const options of [
    { rawBody: '{broken' }, { body: null }, { body: {} },
    { body: { userId: 'not-a-uuid', newPassword: password } },
    ...['short12', '        ', 12345678, null].map(newPassword => ({ body: { userId: targetId, newPassword } })),
  ]) {
    const result = await changePassword(options);
    assert.equal(result.status, 400);
    assert.deepEqual(result.updates, []);
  }
});

test('Auth policy errors are returned to the dialog instead of claiming success', async () => {
  const result = await changePassword({ updateError: 'Password must contain a special character' });
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: 'Password must contain a special character' });
});

test('an unconfirmed Auth update cannot return success', async () => {
  const result = await changePassword({ unconfirmed: true });
  assert.equal(result.status, 500);
  assert.ok(!result.body.success);
});

test('CORS preflight is supported and non-POST mutation methods are rejected', async () => {
  const preflight = await changePassword({ method: 'OPTIONS', authorization: null });
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const result = await changePassword({ method });
    assert.equal(result.status, 405);
    assert.deepEqual(result.updates, []);
  }
});

test('direct password resets honor saved approval and deny modes', async () => {
  for (const permissionMode of ['approval', 'deny']) {
    const result=await changePassword({actorRole:'supervisor',actorGroup:'group-a',targetGroup:'group-a',permissionMode});
    assert.equal(result.status,403);
    assert.deepEqual(result.updates,[]);
  }
  const allowed=await changePassword({actorRole:'agent',actorGroup:'group-a',targetGroup:'group-a',assigned:true,permissionMode:'direct'});
  assert.equal(allowed.status,200);
  assert.equal(allowed.updates.length,1);
});

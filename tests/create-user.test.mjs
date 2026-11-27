import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual Edge handler with only its HTTP server and SDK imports
// replaced. No calls leave the process and no Auth users are created.
const source = readFileSync(new URL('../supabase/functions/_shared/clientAccounts.ts', import.meta.url), 'utf8').replace(/export /g, '') + '\n' +
  readFileSync(new URL('../supabase/functions/create-user/index.ts', import.meta.url), 'utf8').replace(/^import[^\n]+\n/gm, '');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

async function createCustomer({ actorRole = 'admin', groupId = 'group-a', assignedTo = 'agent-b', assigneeRole = 'agent', createErrors = [], profileError = null, role = 'user', caseNumber, agentCaseCode, caseCodeError = null, existingCase = false, assigneeGroup = 'group-a', assigneeSupervisor = 'actor', supervisorId = 'supervisor-a', supervisorGroup = 'group-a', savedCaseNumber, signupAssignment } = {}) {
  const created = [];
  const deleted = [];
  const profileUpdates = [];
  const allocations = [];
  const caseCodeWrites = [];
  const client = {
    rpc: async (name, args) => {
      if (name === 'set_agent_case_code') { caseCodeWrites.push(args); return { data: args.p_case_code, error: caseCodeError }; }
      allocations.push(name); return { data: 'CX-00010001', error: null };
    },
    auth: {
      getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }),
      admin: {
        createUser: async payload => {
          created.push(payload);
          const error = createErrors[created.length - 1] || null;
          return { data: { user: error ? null : { id: 'new-customer' } }, error };
        },
        deleteUser: async user => { deleted.push(user); return { error: null }; },
      },
    },
    from(table) {
      const filters = {};
      let operation = 'select';
      let payload;
      const execute = async () => {
        if (operation === 'update') {
          profileUpdates.push({ table, filters: { ...filters }, payload });
          return { data: { case_number: savedCaseNumber ?? payload.case_number ?? null }, error: profileError };
        }
        if (operation === 'insert') return { data: null, error: null };
        if (table === 'user_roles') return { data: { role: filters.user_id === 'actor' ? actorRole : filters.user_id === supervisorId ? 'supervisor' : assigneeRole }, error: null };
        if (table === 'groups') return { data: { name: 'Group A', platform: 'brightfund' }, error: null };
        if (table === 'profiles') {
          if (filters.email) return { data: existingCase ? [{ id: 'existing-customer' }] : [], error: null };
          if (filters.id === 'new-customer' && signupAssignment) return { data: signupAssignment, error: null };
          return { data: { group_id: filters.id === 'actor' ? 'group-a' : filters.id === supervisorId ? supervisorGroup : assigneeGroup, platform: 'brightfund', supervisor_id: assigneeSupervisor }, error: null };
        }
        throw new Error(`Unexpected table: ${table}`);
      };
      const query = {
        select() { return query; },
        eq(column, value) { filters[column] = value; return query; },
        ilike(column, value) { filters[column] = value; return query; },
        limit() { return query; },
        update(value) { operation = 'update'; payload = value; return query; },
        insert(value) { operation = 'insert'; payload = value; return query; },
        single: execute,
        maybeSingle: execute,
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      return query;
    },
  };
  let handler;
  const context = vm.createContext({
    Request, Response, TextEncoder, crypto: globalThis.crypto,
    Deno: { env: { get: () => 'test-only' } },
    serve: callback => { handler = callback; },
    createClient: () => client,
    console: { log() {}, error() {} },
  });
  vm.runInContext(compiled, context);
  const response = await handler(new Request('https://edge.example.test/create-user', {
    method: 'POST', headers: { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new-customer@example.test', password: 'Test-password-123', firstName: 'New', lastName: 'Customer', role, groupId, assignedTo, caseNumber, supervisorId, agentCaseCode }),
  }));
  return { body: await response.json(), created, deleted, profileUpdates, allocations, caseCodeWrites };
}

test('create-user permits administrators to assign a customer to an agent in the selected group', async () => {
  const result = await createCustomer();
  assert.equal(result.body.success, true);
  assert.equal(result.created.length, 1);
  assert.deepEqual(result.deleted, []);
  assert.equal(result.profileUpdates[0].payload.assigned_to, 'agent-b');
  assert.equal(result.profileUpdates[0].payload.group_id, 'group-a');
});

test('create-user permits an administrator to create an ungrouped, unassigned customer', async () => {
  const result = await createCustomer({ groupId: null, assignedTo: null });
  assert.equal(result.body.success, true);
  assert.equal(result.profileUpdates[0].payload.group_id, null);
  assert.equal(result.profileUpdates[0].payload.assigned_to, null);
});

test('create-user rejects non-administrator assignment across groups and removes the incomplete Auth user', async () => {
  for (const actorRole of ['group_admin', 'supervisor']) {
    const result = await createCustomer({ actorRole, assigneeGroup: 'group-b' });
    assert.match(result.body.error, /agent in the selected group/);
    assert.deepEqual(result.deleted, ['new-customer']);
    assert.deepEqual(result.profileUpdates, []);
  }
});

test('create-user still requires non-administrator staff to select their group', async () => {
  const result = await createCustomer({ actorRole: 'supervisor', groupId: null, assignedTo: null });
  assert.match(result.body.error, /Missing required fields/);
  assert.deepEqual(result.created, []);
});

test('create-user does not permit an administrator to use a non-agent as assignee', async () => {
  const result = await createCustomer({ assigneeRole: 'supervisor' });
  assert.match(result.body.error, /agent in the selected group/);
  assert.deepEqual(result.deleted, ['new-customer']);
});

test('client creation uses the case number as its distinct identity without changing the contact email', async () => {
  const result = await createCustomer({ caseNumber: '  case-123  ' });
  assert.equal(result.body.success, true);
  assert.equal(result.created.length, 1);
  assert.match(result.created[0].email, /^new-customer\+case-[a-f0-9]{32}@example\.test$/);
  assert.equal(result.body.loginEmail, undefined);
  assert.equal(result.body.email, 'new-customer@example.test');
  assert.equal(result.created[0].user_metadata.display_email, 'new-customer@example.test');
  assert.equal(result.created[0].user_metadata.case_number, 'case-123');
  assert.equal(result.profileUpdates[0].payload.case_number, 'case-123');
  assert.equal(result.profileUpdates[0].filters.id, 'new-customer');
  assert.equal(result.profileUpdates[0].payload.email, 'new-customer@example.test');
  assert.deepEqual(result.deleted, []);
});

test('duplicate staff emails remain rejected and other Auth errors do not create another login', async () => {
  const staff = await createCustomer({ role: 'agent', createErrors: [{ code: 'email_exists', message: 'User already been registered' }] });
  assert.equal(staff.body.code, 'email_exists');
  assert.equal(staff.created.length, 1);
  const failed = await createCustomer({ createErrors: [{ code: 'weak_password', message: 'Password is too weak' }] });
  assert.match(failed.body.error, /Password is too weak/);
  assert.equal(failed.created.length, 1);
  assert.deepEqual(failed.profileUpdates, []);
});

test('staff creation never allocates, validates or exposes a client case number', async () => {
  for (const role of ['group_admin', 'supervisor', 'agent']) {
    const result = await createCustomer({ role, caseNumber: 'invalid\u0000case', assignedTo: null });
    assert.equal(result.body.success, true);
    assert.equal(result.created[0].email, 'new-customer@example.test');
    assert.equal(result.created[0].user_metadata.case_number, undefined);
    assert.equal(result.profileUpdates[0].payload.case_number, undefined);
    assert.equal(result.body.caseNumber, undefined);
    assert.deepEqual(result.allocations, []);
  }
});

test('agent creation accepts an omitted phone number and stores null', async () => {
  for (const actorRole of ['admin', 'group_admin', 'supervisor']) {
    const result = await createCustomer({ actorRole, role: 'agent', assignedTo: null });
    assert.equal(result.body.success, true);
    assert.equal(result.profileUpdates[0].payload.phone, null);
    assert.deepEqual(result.deleted, []);
  }
});

test('new agents accept a custom case number and failed code writes remove the incomplete account', async () => {
  const result = await createCustomer({ role: 'agent', agentCaseCode: '  Case@551  ' });
  assert.equal(result.body.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.caseCodeWrites)), [{ p_agent_id: 'new-customer', p_case_code: 'Case@551' }]);
  assert.equal(result.profileUpdates[0].payload.case_number, undefined);
  const failed = await createCustomer({ role: 'agent', agentCaseCode: 'taken', caseCodeError: { message: 'Agent case number is already in use' } });
  assert.match(failed.body.error, /already in use/);
  assert.deepEqual(failed.deleted, ['new-customer']);
  const invalid = await createCustomer({ role: 'agent', agentCaseCode: 'bad\u0000code' });
  assert.match(invalid.body.error, /control characters/);
  assert.deepEqual(invalid.created, []);
});

test('client creation returns the saved active agent case number rather than the requested independent number', async () => {
  const result = await createCustomer({ caseNumber: 'independent-case', savedCaseNumber: 'Case@552' });
  assert.equal(result.body.success, true);
  assert.equal(result.body.caseNumber, 'Case@552');
});

test('staff creation preserves the trusted signup assignment and agent capitalization for matching active codes', async () => {
  const signupAssignment = { assigned_to: 'agent-b', group_id: 'group-a', platform: 'brightfund', case_number: 'Case@552' };
  const result = await createCustomer({ assignedTo: null, groupId: null, caseNumber: 'case@552', signupAssignment });
  assert.equal(result.body.success, true);
  assert.equal(result.body.caseNumber, 'Case@552');
  assert.equal(result.profileUpdates[0].payload.assigned_to, 'agent-b');
  assert.equal(result.profileUpdates[0].payload.group_id, 'group-a');
  assert.equal(result.profileUpdates[0].payload.case_number, 'Case@552');
  const denied = await createCustomer({ actorRole: 'group_admin', assignedTo: null, signupAssignment: {
    ...signupAssignment, group_id: 'group-b',
  }, assigneeGroup: 'group-b' });
  assert.match(denied.body.error, /agent in the selected group/);
  assert.deepEqual(denied.deleted, ['new-customer']);
});

test('duplicate email/case pairs are rejected before creation and profile failures remove only the new account', async () => {
  const result = await createCustomer({ existingCase: true, caseNumber: 'CASE-123' });
  assert.match(result.body.error, /already registered/);
  assert.equal(result.created.length, 0);
  const failed = await createCustomer({ profileError: { message: 'Test profile failure' } });
  assert.match(failed.body.error, /Test profile failure/);
  assert.deepEqual(failed.deleted, ['new-customer']);
});

for (const actorRole of ['admin', 'group_admin', 'supervisor']) {
  test(`${actorRole} cannot create a client assigned across group boundaries`, async () => {
    const result = await createCustomer({ actorRole, assigneeGroup: 'group-b' });
    assert.match(result.body.error, /agent in the selected group/);
    assert.deepEqual(result.profileUpdates, []);
    assert.deepEqual(result.deleted, ['new-customer']);
  });
}
test('supervisors can create clients only under their own agents', async () => {
  const denied = await createCustomer({ actorRole: 'supervisor', assigneeSupervisor: 'another-supervisor' });
  assert.match(denied.body.error, /agent in the selected group/);
  assert.deepEqual(denied.profileUpdates, []);
  const allowed = await createCustomer({ actorRole: 'supervisor' });
  assert.equal(allowed.body.success, true);
  const unassigned = await createCustomer({ actorRole: 'supervisor', assignedTo: null });
  assert.match(unassigned.body.error, /assigned agents/);
  assert.deepEqual(unassigned.created, []);
});
test('new agents require a supervisor in their group and supervisor-created agents belong to the caller', async () => {
  for (const options of [{ supervisorId: null }, { supervisorGroup: 'group-b' }]) {
    const denied = await createCustomer({ role: 'agent', ...options });
    assert.match(denied.body.error, /supervisor/);
    assert.deepEqual(denied.created, []);
  }
  const created = await createCustomer({ role: 'agent' });
  assert.equal(created.body.success, true);
  assert.equal(created.profileUpdates[1].payload.supervisor_id, 'supervisor-a');
  const owned = await createCustomer({ actorRole: 'supervisor', role: 'agent', supervisorId: 'another-supervisor', supervisorGroup: 'group-b' });
  assert.equal(owned.body.success, true);
  assert.equal(owned.profileUpdates[1].payload.supervisor_id, 'actor');
});

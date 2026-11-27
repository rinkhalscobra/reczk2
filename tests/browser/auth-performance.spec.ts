import { expect, test, type Page, type Route, type WebSocketRoute } from '@playwright/test';
import { loadEnv } from 'vite';
import { readFile } from 'node:fs/promises';

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`transaction analysis runs automatically until the CRM ends it with ${reducedMotion} motion preference`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const backend = await mockBackend(page, { role: 'user' });
    let profile = {
      ...backend.session.user,
      first_name: 'Sample', last_name: 'Customer', status: 'active', case_number: 'TEST-001',
      display_currency: 'USD', case_phase: 'submitted',
      recovery_search_started_at: null as string | null,
      recovery_search_duration_minutes: 60, recovery_search_scope: 'both',
      recovery_completed_at: null as string | null,
    };
    await page.route(`${supabaseUrl}/rest/v1/profiles**`, route => route.fulfill({
      json: route.request().headers().accept?.includes('vnd.pgrst.object+json') ? profile : [profile],
    }));
    const setCrmPhase = async (changes: Partial<typeof profile>) => {
      profile = { ...profile, ...changes };
      await expect.poll(() => backend.subscriptions.some(subscription => subscription.bindings.some(binding => binding.table === 'profiles'))).toBe(true);
      backend.updateProfile(profile);
    };
    await page.goto('/dashboard/case');
    const diagram = page.locator('.transaction-analysis');
    await expect(page.locator('.portal-profile-list')).toBeVisible();
    await expect(diagram).toHaveCount(0);
    await setCrmPhase({ case_phase: 'review', recovery_search_started_at: new Date().toISOString() });
    await expect(diagram).toHaveAttribute('data-motion', 'running');
    await expect(diagram.locator('.ta-motion-control')).toHaveCount(0);
    const scanner = diagram.locator('.ta-scanner-sweep');
    const initial = await scanner.evaluate(el => getComputedStyle(el).transform);
    await expect.poll(() => scanner.evaluate(el => getComputedStyle(el).transform)).not.toBe(initial);
    const initialStage = await diagram.locator('.ta-stages .is-illustrating').innerText();
    await expect.poll(() => diagram.locator('.ta-stages .is-illustrating').innerText(), { timeout: 5000 }).not.toBe(initialStage);
    // Selecting a transaction branch must not interrupt the automatic workflow.
    await diagram.locator('.ta-source-crypto').click();
    await expect(diagram).toHaveAttribute('data-motion', 'running');
    if (reducedMotion === 'reduce') {
      const outsideAnimation = await page.locator('.portal-workspace').evaluate(root => {
        const probe = document.createElement('span');
        probe.style.animation = 'spin 1s linear infinite';
        root.appendChild(probe);
        const name = getComputedStyle(probe).animationName;
        probe.remove();
        return name;
      });
      expect(outsideAnimation).toBe('none');
    }
    // Opening either client page or reloading resumes the CRM's current state.
    await page.goto('/dashboard');
    await expect(diagram).toHaveAttribute('data-motion', 'running');
    await page.reload();
    await expect(diagram).toHaveAttribute('data-motion', 'running');
    // A finished timer alone does not end a CRM review awaiting analyst findings.
    await setCrmPhase({ recovery_search_started_at: new Date(Date.now() - 120000).toISOString(), recovery_search_duration_minutes: 1 });
    await expect(page.locator('.portal-investigation-progress')).toContainText('100%');
    await expect(diagram).toHaveAttribute('data-motion', 'running');
    await setCrmPhase({ case_phase: 'completed', recovery_completed_at: new Date().toISOString() });
    await expect(diagram).toHaveAttribute('data-motion', 'paused');
    const paused = await scanner.evaluate(el => getComputedStyle(el).transform);
    await page.waitForTimeout(150);
    expect(await scanner.evaluate(el => getComputedStyle(el).transform)).toBe(paused);
    await setCrmPhase({ case_phase: 'review', recovery_search_started_at: new Date().toISOString(), recovery_completed_at: null });
    await expect(diagram).toHaveAttribute('data-motion', 'running');
    const resumed = await scanner.evaluate(el => getComputedStyle(el).transform);
    await expect.poll(() => scanner.evaluate(el => getComputedStyle(el).transform)).not.toBe(resumed);
    await setCrmPhase({ case_phase: 'submitted', recovery_search_started_at: null });
    await expect(diagram).toHaveCount(0);
    expect(backend.pageErrors).toEqual([]);
  });
}

const supabaseUrl = loadEnv('production', process.cwd()).VITE_SUPABASE_URL;
const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const userId = '00000000-0000-4000-8000-000000000001';
const groupId = '00000000-0000-4000-8000-000000000002';
const customerId = '00000000-0000-4000-8000-000000000003';

const makeSession = (id = userId) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: id, exp: now + 3600, iat: now, aud: 'authenticated', role: 'authenticated' })).toString('base64url');
  return {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-signature`,
    refresh_token: 'test-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id, email: 'staff@example.test', aud: 'authenticated', role: 'authenticated',
      app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {} as Record<string, unknown>,
      created_at: '2026-01-01T00:00:00Z',
    },
  };
};

type MockOptions = {
  role?: string;
  restored?: boolean;
  missingProfile?: boolean;
  roleError?: boolean;
  validateDelay?: number;
  allowed?: boolean;
  mfa?: boolean;
  expiredSession?: boolean;
  mfaError?: boolean;
  permissionMode?: 'direct' | 'approval' | 'deny';
  permissionError?: boolean;
};

const mockBackend = async (page: Page, options: MockOptions = {}) => {
  const state = { role: 'agent', restored: true, ...options };
  const requests: { path: string; query: URLSearchParams; method: string; time: number }[] = [];
  const pageErrors: string[] = [];
  const subscriptions: { socket: WebSocketRoute; topic: string; bindings: { id: number; table: string; event: string }[] }[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let validationCompleted = false;
  const customer = {
    id: customerId, email: 'customer@example.test', first_name: 'Sample', last_name: 'Customer',
    status: 'active', case_number: 'TEST-001', subscription: null, created_at: '2026-01-01T00:00:00Z',
    group_id: groupId, assigned_to: state.role === 'supervisor' ? '00000000-0000-4000-8000-000000000004' : userId, is_archived: false,
  };
  const session = makeSession();
  let activeSession = session;

  const rows = (route: Route, data: object[]) => {
    if (route.request().headers().accept?.includes('vnd.pgrst.object+json')) {
      if (data.length !== 1) return route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object', details: `The result contains ${data.length} rows` } });
      return route.fulfill({ json: data[0] });
    }
    return route.fulfill({ json: data });
  };

  // All backend calls, including live connections, stay inside the test browser.
  await page.routeWebSocket(`${supabaseUrl.replace('https:', 'wss:')}/realtime/**`, socket => {
    socket.onMessage(message => {
      const packet = JSON.parse(String(message));
      const data = Array.isArray(packet)
        ? { join_ref: packet[0], ref: packet[1], topic: packet[2], event: packet[3], payload: packet[4] }
        : packet;
      const reply = (response: object) => socket.send(JSON.stringify(Array.isArray(packet)
        ? [data.join_ref, data.ref, data.topic, 'phx_reply', { status: 'ok', response }]
        : { ...data, event: 'phx_reply', payload: { status: 'ok', response } }));
      if (data.event === 'phx_join') {
        const bindings = (data.payload.config.postgres_changes || []).map((binding: object, index: number) => ({ ...binding, id: index + 1 }));
        subscriptions.push({ socket, topic: data.topic, bindings });
        reply({ postgres_changes: bindings });
      } else if (data.event === 'heartbeat' || data.event === 'phx_leave') {
        reply({});
      }
    });
  });
  await page.route(`${supabaseUrl}/**`, async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    requests.push({ path: url.pathname, query: url.searchParams, method, time: Date.now() });
    if (method === 'OPTIONS') return route.fulfill({ status: 204 });
    if (url.pathname.endsWith('/account-login')) {
      if (state.mfaError) return route.fulfill({ status: 503, json: { error: 'Unable to verify account security. Please try again.' } });
      const body = route.request().postDataJSON();
      if (state.mfa && !body.code) return route.fulfill({ json: { mfaRequired: true, ticket: 'encrypted-test-ticket' } });
      if (state.mfa && body.code !== '123456') return route.fulfill({ status: 401, json: { error: 'Invalid verification code. Please try again.' } });
      return route.fulfill({ json: { session: activeSession } });
    }
    if (url.pathname.endsWith('/mfa-check')) return state.mfaError
      ? route.fulfill({ status: 503, json: { error: 'Test MFA service unavailable' } })
      : route.fulfill({ json: { mfaRequired: state.mfa ?? false } });
    if (url.pathname.endsWith('/mfa-validate')) return route.fulfill({ json: { valid: true } });
    if (url.pathname.endsWith('/validate-staff-ip')) {
      if (state.validateDelay) await new Promise(resolve => setTimeout(resolve, state.validateDelay));
      validationCompleted = true;
      return route.fulfill({ json: { allowed: state.allowed ?? true, reason: 'Test location denied' } });
    }
    if (url.pathname.endsWith('/token')) {
      if (state.expiredSession) return route.fulfill({ status: 429, json: { code: 'over_request_rate_limit', msg: 'Request rate limit reached' } });
      return route.fulfill({ json: session });
    }
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204 });
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: activeSession.user });
    if (url.pathname.startsWith('/rest/v1/')) {
      if (url.pathname.endsWith('/rpc/get_my_permission')) return state.permissionError
        ? route.fulfill({status:503,json:{message:'Permissions unavailable'}})
        : route.fulfill({json:state.role==='admin'?'direct':state.permissionMode || (state.role==='agent'?'approval':'direct')});

      if (method === 'PATCH' || method === 'POST') return route.fulfill({ json: [] });
      if (method === 'HEAD') return route.fulfill({ headers: { 'content-range': '*/0' } });
      if (url.pathname.endsWith('/user_roles')) {
        if (url.searchParams.get('select') === 'role') {
          if (state.roleError) return route.fulfill({ status: 503, json: { message: 'Test role service unavailable' } });
          return rows(route, state.role === 'user' ? [] : [{ role: state.role }]);
        }
        return rows(route, state.role === 'supervisor' ? [{ id: 'supervised-role', user_id: '00000000-0000-4000-8000-000000000004', role: 'agent' }] : []);
      }
      if (url.pathname.endsWith('/profiles')) {
        if (url.searchParams.has('supervisor_id')) return rows(route, [{ id: '00000000-0000-4000-8000-000000000004', email: 'assigned-agent@example.test', first_name: 'Assigned', last_name: 'Agent', group_id: groupId, supervisor_id: userId, assigned_to: null, status: 'active', is_archived: false }]);
        if (url.searchParams.has('id') && !url.searchParams.get('id')?.startsWith('in.')) {
          if (state.missingProfile) return rows(route, []);
          return rows(route, [{ ...customer, ...activeSession.user, email: activeSession.user.user_metadata.display_email || activeSession.user.email, id: activeSession.user.id, group_id: groupId, display_currency: 'USD', preferred_currency: 'USD', case_phase: 'review', recovery_search_duration_minutes: 60 }]);
        }
        return rows(route, [customer]);
      }
      if (url.pathname.endsWith('/groups') && url.searchParams.has('id')) return rows(route, [{ id: groupId, name: 'Test Group' }]);
      return rows(route, []);
    }
    return route.fulfill({ json: {} });
  });
  if (state.restored) {
    const stored = state.expiredSession ? { ...session, expires_at: 1 } : session;
    await page.addInitScript(({ key, stored }) => localStorage.setItem(key, JSON.stringify(stored)), { key: storageKey, stored });
  }
  const count = (table: string, method = 'GET') => requests.filter(request => request.path.endsWith(`/${table}`) && request.method === method).length;
  const broadcast = (event: string, nextSession: typeof session | null) => page.evaluate(({ key, event, session }) => {
    if (session) localStorage.setItem(key, JSON.stringify(session));
    else localStorage.removeItem(key);
    const channel = new BroadcastChannel(key);
    channel.postMessage({ event, session });
    setTimeout(() => channel.close(), 100);
  }, { key: storageKey, event, session: nextSession });
  const publishChange = (table: string, record: object, type = 'UPDATE') => {
    for (const { socket, topic, bindings } of subscriptions) {
      const ids = bindings.filter(binding => binding.table === table).map(binding => binding.id);
      if (ids.length) socket.send(JSON.stringify([
        null, null, topic, 'postgres_changes', { ids, data: {
          schema: 'public', table, type, columns: [], record,
          old_record: { id: userId }, commit_timestamp: new Date().toISOString(), errors: [],
        } },
      ]));
    }
  };
  const updateProfile = (record: object) => publishChange('profiles', record);
  return { state, session, requests, pageErrors, subscriptions, count, broadcast, updateProfile, publishChange, validationCompleted: () => validationCompleted, setSession: (next: typeof session) => { activeSession = next; } };
};

const mockGroupDetails = async (page: Page, role = 'admin', extraClients = 0) => {
  const backend = await mockBackend(page, { role });
  const otherGroupId = '70000000-0000-4000-8000-000000000099';
  const groups = [
    { id: groupId, name: 'North Group', description: 'North recovery team', created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-22T10:00:00Z' },
    { id: otherGroupId, name: 'South Group', description: null, created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-22T10:00:00Z' },
  ];
  const member = (id: string, firstName: string, lastName: string, fields: Record<string, unknown> = {}) => ({
    id, first_name: firstName, last_name: lastName, email: `${firstName.toLowerCase()}-${lastName.toLowerCase()}@example.test`,
    group_id: groupId, supervisor_id: null, assigned_to: null, case_number: null, status: 'active', is_archived: false,
    platform: 'brightfund', preferred_currency: 'USD', case_phase: 'review', recovery_search_duration_minutes: 60, recovery_result_details: {}, ...fields,
  });
  const admin = member('70000000-0000-4000-8000-000000000010', 'North', 'Admin');
  const supervisor = member(role === 'supervisor' ? userId : '70000000-0000-4000-8000-000000000011', 'North', 'Supervisor');
  const agent = member(role === 'agent' ? userId : '70000000-0000-4000-8000-000000000012', 'North', 'Agent', { supervisor_id: supervisor.id });
  const client = member(customerId, 'North', 'Client', { assigned_to: agent.id, case_number: 'N-001' });
  const unassigned = member('70000000-0000-4000-8000-000000000014', 'Unassigned', 'Client', { case_number: 'N-002' });
  const outside = member('70000000-0000-4000-8000-000000000021', 'Outside', 'Client', { group_id: otherGroupId, case_number: 'S-001' });
  const members = [admin, supervisor, agent, client, unassigned, outside];
  for (let index = 0; index < extraClients; index++) members.push(member(`71000000-0000-4000-8000-${String(index).padStart(12, '0')}`, 'Extra', `Client${index}`, { case_number: `EXTRA-${index}` }));
  const roles = [
    { id: admin.id, user_id: admin.id, role: 'group_admin' },
    { id: supervisor.id, user_id: supervisor.id, role: 'supervisor' },
    { id: agent.id, user_id: agent.id, role: 'agent' },
  ];
  const controls = { rolesError: false, membersError: false, clientsError: false, codesError: false, emptyOtherGroup: false, editError: '', codeOverride: '', caseError: '', unconfirmedCase: false };
  const caseChanges: Record<string, unknown>[] = [];
  const agentEdits: Record<string, unknown>[] = [];
  const agentCaseCode = 'AGT-AAC31D58B438';
  const groupReads: { path: string; query: URLSearchParams }[] = [];
  await page.route(`${supabaseUrl}/rest/v1/**`, route => {
    const url = new URL(route.request().url());
    groupReads.push({ path: url.pathname, query: url.searchParams });
    if (url.pathname.endsWith('/rpc/set_client_case_number')) {
      const body = route.request().postDataJSON();
      caseChanges.push(body);
      if (controls.caseError) return route.fulfill({ status: 403, json: { message: controls.caseError } });
      if (controls.unconfirmedCase) return route.fulfill({ json: null });
      client.case_number = body.p_case_number;
      return route.fulfill({ json: body.p_case_number });
    }
    if (url.pathname.endsWith('/rpc/update_managed_agent')) {
      const body = route.request().postDataJSON();
      agentEdits.push(body);
      if (controls.editError) return route.fulfill({ status: 403, json: { message: controls.editError } });
      controls.codeOverride = body.p_case_code;
      Object.assign(agent, { first_name: body.p_first_name, last_name: body.p_last_name, username: body.p_username, group_id: body.p_group_id, supervisor_id: body.p_supervisor_id });
      return route.fulfill({ status: 204 });
    }
    if (url.pathname.endsWith('/rpc/get_agent_case_codes')) {
      if (controls.codesError) return route.fulfill({ status: 503, json: { message: 'Case codes unavailable' } });
      const ids = route.request().postDataJSON().p_agent_ids;
      return route.fulfill({ json: ids.includes(agent.id) ? [{ agent_id: agent.id, case_code: controls.codeOverride || agentCaseCode }] : [] });
    }
    if (url.pathname.endsWith('/groups')) {
      const filter = url.searchParams.get('id');
      if (!filter) return route.fulfill({ json: groups });
      const selected = groups.find(group => `eq.${group.id}` === filter);
      return route.fulfill({ json: selected && (role === 'admin' || selected.id === groupId) ? selected : null });
    }
    if (url.pathname.endsWith('/profiles') && route.request().method() === 'GET') {
      const target = url.searchParams.get('id');
      if (target?.startsWith('eq.')) {
        const selected = members.find(member => `eq.${member.id}` === target);
        if (selected) return route.fulfill({ json: selected });
        return route.fallback();
      }
      const filter = url.searchParams.get('group_id');
      const assignedTo = url.searchParams.get('assigned_to');
      if (assignedTo && controls.clientsError) return route.fulfill({ status: 503, json: { message: 'Clients unavailable' } });
      if (filter && controls.membersError) return route.fulfill({ status: 503, json: { message: 'Members unavailable' } });
      let scoped = filter ? members.filter(member => `eq.${member.group_id}` === filter) : members;
      const supervisorFilter = url.searchParams.get('supervisor_id');
      if (supervisorFilter) scoped = scoped.filter(member => `eq.${member.supervisor_id}` === supervisorFilter);
      if (assignedTo) scoped = scoped.filter(member => `eq.${member.assigned_to}` === assignedTo);
      if (assignedTo?.startsWith('in.(')) scoped = members.filter(member => member.group_id === groupId && member.assigned_to && assignedTo.includes(member.assigned_to));
      if (filter === `eq.${otherGroupId}` && controls.emptyOtherGroup) scoped = [];
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || scoped.length);
      return route.fulfill({ json: scoped.slice(offset, offset + limit) });
    }
    if (url.pathname.endsWith('/user_roles') && url.searchParams.get('select') !== 'role') {
      if (url.searchParams.get('select') === 'user_id,role' && controls.rolesError) return route.fulfill({ status: 503, json: { message: 'Roles unavailable' } });
      return route.fulfill({ json: url.searchParams.get('role') === 'eq.agent' ? roles.filter(row => row.role === 'agent') : roles });
    }
    return route.fallback();
  });
  return { ...backend, groups, supervisor, agent, client, outside, otherGroupId, controls, groupReads, members, roles, member, agentCaseCode, agentEdits, caseChanges };
};

for (const [role, path, target] of [
  ['admin', '/admin?tab=agents', 'agent'], ['admin', '/admin?tab=supervisors', 'supervisor'],
  ['admin', '/admin?tab=admins', 'admin'], ['group_admin', '/group-admin?tab=agents', 'agent'],
  ['group_admin', '/group-admin?tab=supervisors', 'supervisor'], ['supervisor', '/supervisor?tab=agents', 'agent'],
  ['admin', `/admin/groups/${groupId}?tab=admins`, 'admin'],
]) {
  test(`${role} changes ${target} staff credentials from ${path}`, async ({ page }) => {
    const backend = await mockGroupDetails(page, role);
    const staff = target === 'admin' ? backend.members[0] : target === 'supervisor' ? backend.supervisor : backend.agent;
    const submissions: Record<string, unknown>[] = [];
    await page.route(`${supabaseUrl}/functions/v1/update-staff-credentials`, route => {
      const body = route.request().postDataJSON();
      submissions.push(body);
      staff.email = body.newEmail;
      return route.fulfill({ json: { success: true, userId: staff.id } });
    });
    await page.goto(path);
    if (role !== 'admin') await page.getByRole('tab', { name: target === 'agent' ? 'Agents' : 'Supervisors', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: staff.email });
    await row.getByRole('button', { name: 'Change email / password', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Change email / password', exact: true });
    const save = dialog.getByRole('button', { name: 'Save', exact: true });
    await expect(dialog.getByLabel('Email', { exact: true })).toHaveValue(staff.email);
    await expect(save).toBeDisabled();
    await dialog.getByLabel('Email', { exact: true }).fill('Changed-Staff@example.test');
    await dialog.getByLabel('New Password', { exact: true }).fill('New-password-123!');
    await dialog.getByLabel('Confirm Password', { exact: true }).fill('New-password-123!');
    if (path.includes('/groups/')) {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(save).toBeInViewport();
      await page.screenshot({ path: test.info().outputPath('staff-credentials-mobile.png'), fullPage: true });
    }
    await save.click();
    await expect(dialog).toBeHidden();
    expect(submissions).toEqual([{ userId: staff.id, newEmail: 'changed-staff@example.test', newPassword: 'New-password-123!' }]);
    await expect(page.getByRole('row').filter({ hasText: 'changed-staff@example.test' })).toBeVisible();
    expect(backend.pageErrors).toEqual([]);
  });
}

test('staff credentials validate passwords, display Auth errors and clear secrets on close', async ({ page }) => {
  const backend = await mockGroupDetails(page);
  const submissions: Record<string, unknown>[] = [];
  let response: Record<string, unknown> = { error: 'This email address is already registered' };
  await page.route(`${supabaseUrl}/functions/v1/update-staff-credentials`, route => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ status: response.error ? 400 : 200, json: response });
  });
  await page.goto('/admin?tab=agents');
  const trigger = page.getByRole('button', { name: 'Change email / password', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Change email / password', exact: true });
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  const password = dialog.getByLabel('New Password', { exact: true });
  const confirmation = dialog.getByLabel('Confirm Password', { exact: true });
  await password.fill('short'); await confirmation.fill('short'); await expect(save).toBeDisabled();
  await password.fill('New-password-123!'); await expect(save).toBeDisabled();
  await confirmation.fill('New-password-123!');
  await dialog.getByLabel('Email', { exact: true }).fill('taken@example.test');
  await save.click();
  await expect(page.getByText('This email address is already registered', { exact: true }).first()).toBeVisible();
  await expect(dialog).toBeVisible();
  response = {};
  await save.click();
  await expect(page.getByText('Unable to change login details. Please try again.', { exact: true }).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await trigger.click();
  await expect(password).toHaveValue(''); await expect(confirmation).toHaveValue('');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(dialog.getByLabel('Email', { exact: true })).toHaveValue(backend.agent.email);
  response = { success: true, userId: backend.agent.id };
  await dialog.getByLabel('Email', { exact: true }).fill('email-only@example.test');
  await save.click();
  await expect(dialog).toBeHidden();
  expect(submissions[2]).toEqual({ userId: backend.agent.id, newEmail: 'email-only@example.test' });
  await trigger.click();
  await password.fill('Password-only-123!'); await confirmation.fill('Password-only-123!');
  await save.click();
  expect(submissions[3]).toEqual({ userId: backend.agent.id, newPassword: 'Password-only-123!' });
});

for (const mode of ['approval', 'deny'] as const) {
  test(`staff credentials respect ${mode} permission mode`, async ({ page }) => {
    await mockGroupDetails(page, 'group_admin');
    await page.route(`${supabaseUrl}/rest/v1/rpc/get_my_permission`, route => route.fulfill({ json: mode }));
    await page.goto('/group-admin?tab=agents');
    await page.getByRole('tab', { name: 'Agents', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Change email / password', exact: true })).toBeDisabled();
  });
}

for (const role of ['admin', 'group_admin', 'supervisor', 'agent']) {
  test(`${role} changes its client case number from the client list and sees the saved value`, async ({ page }) => {
    const backend = await mockGroupDetails(page, role);
    await page.goto(role === 'admin' ? '/admin' : role === 'group_admin' ? '/group-admin' : role === 'supervisor' ? '/supervisor' : '/agent');
    await page.getByRole('button', { name: 'Change case number for North Client', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Change case number', exact: true });
    await expect(dialog.getByLabel('Case Number', { exact: true })).toHaveValue('N-001');
    await dialog.getByLabel('Case Number', { exact: true }).fill(' changed-123 ');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(backend.caseChanges).toEqual([{ p_customer_id: customerId, p_case_number: 'changed-123' }]);
    await expect(page.getByRole('cell', { name: 'changed-123', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('cell', { name: 'changed-123', exact: true })).toBeVisible();
    expect(backend.pageErrors).toEqual([]);
  });
}

test('client profile case-number dialog keeps errors and input visible and requires confirmed success', async ({ page }) => {
  const backend = await mockGroupDetails(page, 'agent');
  await page.goto(`/customer/${customerId}`);
  await page.getByRole('button', { name: 'Change case number for North Client', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Change case number', exact: true });
  await dialog.getByLabel('Case Number', { exact: true }).fill('');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await dialog.getByLabel('Case Number', { exact: true }).fill('New-Case');
  backend.controls.caseError = 'This email and case number are already registered';
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('already registered');
  await expect(dialog.getByLabel('Case Number', { exact: true })).toHaveValue('New-Case');
  backend.controls.caseError = '';
  backend.controls.unconfirmedCase = true;
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('could not be confirmed');
  backend.controls.unconfirmedCase = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('New-Case', { exact: true })).toHaveCount(2);
  expect(backend.pageErrors).toEqual([]);
});

test('agent profile editing changes a client case without writing an unchanged subscription', async ({ page }) => {
  const backend = await mockGroupDetails(page, 'agent');
  const patches: Record<string, unknown>[] = [];
  await page.route(`${supabaseUrl}/rest/v1/profiles*`, route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    patches.push(route.request().postDataJSON());
    Object.assign(backend.client, route.request().postDataJSON());
    return route.fulfill({ json: { id: customerId } });
  });
  await page.goto(`/customer/${customerId}`);
  await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
  await page.getByRole('textbox', { name: 'Case Number', exact: true }).fill('PROFILE-CASE');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('PROFILE-CASE', { exact: true })).toHaveCount(2);
  expect(patches).toHaveLength(1);
  expect(patches[0].case_number).toBe('PROFILE-CASE');
  expect(patches[0]).not.toHaveProperty('subscription');
});

for (const editor of ['case dialog', 'profile editor']) {
  test(`client transfer from the ${editor} refreshes the assigned agent and saved case spelling`, async ({ page }) => {
    const backend = await mockGroupDetails(page);
    const destination = backend.member('70000000-0000-4000-8000-000000000090', 'Destination', 'Agent', { supervisor_id: backend.supervisor.id });
    backend.members.push(destination);
    backend.roles.push({ user_id: destination.id, role: 'agent' });
    const applyTransfer = () => Object.assign(backend.client, { case_number: 'Case@777', assigned_to: destination.id });
    await page.route(`${supabaseUrl}/rest/v1/rpc/set_client_case_number`, route => {
      applyTransfer();
      return route.fulfill({ json: 'Case@777' });
    });
    await page.route(`${supabaseUrl}/rest/v1/profiles*`, route => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      Object.assign(backend.client, route.request().postDataJSON());
      applyTransfer();
      return route.fulfill({ json: { id: customerId } });
    });
    await page.goto(`/customer/${customerId}`);
    await expect(page.getByRole('combobox').filter({ hasText: 'North Agent' })).toBeVisible();
    if (editor === 'case dialog') {
      await page.getByRole('button', { name: 'Change case number for North Client', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Change case number', exact: true });
      await expect(dialog).toContainText('transfers this client to that agent');
      await dialog.getByLabel('Case Number', { exact: true }).fill('case@777');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog).toBeHidden();
    } else {
      await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
      await page.getByRole('textbox', { name: 'Case Number', exact: true }).fill('case@777');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
    }
    await expect(page.getByText('Case@777', { exact: true })).toHaveCount(2);
    await expect(page.getByRole('combobox').filter({ hasText: 'Destination Agent' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('combobox').filter({ hasText: 'Destination Agent' })).toBeVisible();
    expect(backend.pageErrors).toEqual([]);
  });
}

test('agent edit exposes group and case number and saves them together', async ({ page }) => {
  const backend = await mockGroupDetails(page);
  await page.goto('/admin?tab=agents');
  await page.getByRole('button', { name: 'Edit agent North Agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit agent', exact: true });
  await expect(dialog.getByLabel('Agent Case Code', { exact: true })).toHaveValue(backend.agentCaseCode);
  await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await dialog.getByRole('combobox', { name: 'Group', exact: true }).click();
  await page.getByRole('option', { name: 'South Group', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Assigned Supervisor', exact: true })).toHaveText('Unassigned');
  await dialog.getByLabel('Agent Case Code', { exact: true }).fill('case-1234');
  await page.screenshot({ path: test.info().outputPath('edit-agent-desktop.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(backend.agentEdits).toHaveLength(1);
  expect(backend.agentEdits[0]).toMatchObject({ p_agent_id: backend.agent.id, p_group_id: backend.otherGroupId, p_supervisor_id: null, p_case_code: 'case-1234' });
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'North Agent', exact: true }) });
  await expect(row).toContainText('South Group');
  await expect(row).toContainText('case-1234');
  await page.getByRole('button', { name: 'Edit agent North Agent', exact: true }).click();
  await expect(dialog.getByLabel('Agent Case Code', { exact: true })).toHaveValue('case-1234');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('edit-agent-mobile.png'), fullPage: true });
  expect(backend.pageErrors).toEqual([]);
});

for (const role of ['group_admin', 'supervisor']) {
  test(`${role} can edit its agent case number while the group stays locked`, async ({ page }) => {
    const backend = await mockGroupDetails(page, role);
    await page.goto(role === 'group_admin' ? '/group-admin' : '/supervisor');
    await page.getByRole('tab', { name: 'Agents', exact: true }).click();
    await page.getByRole('button', { name: 'Edit agent North Agent', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit agent', exact: true });
    await expect(dialog.getByRole('combobox', { name: 'Group', exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('Agent Case Code', { exact: true })).toHaveValue(backend.agentCaseCode);
    await dialog.getByLabel('Agent Case Code', { exact: true }).fill('New-4321');
    backend.controls.editError = 'Agent case number is already in use';
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Agent case number is already in use', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Agent Case Code', { exact: true })).toHaveValue('New-4321');
    backend.controls.editError = '';
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(backend.agentEdits[1]).toMatchObject({ p_group_id: groupId, p_supervisor_id: backend.supervisor.id, p_case_code: 'New-4321' });
    expect(backend.pageErrors).toEqual([]);
  });
}

test('create agent has a white dialog, no phone field, and a case number generator', async ({ page }) => {
  await mockGroupDetails(page);
  const creations: Record<string, unknown>[] = [];
  await page.route(`${supabaseUrl}/functions/v1/create-user`, route => {
    creations.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, userId: customerId } });
  });
  await page.goto('/admin?tab=agents');
  await page.getByRole('tabpanel').getByRole('button', { name: 'CREATE', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(dialog.locator('#phone')).toHaveCount(0);
  await dialog.getByLabel('First Name', { exact: true }).fill('Created');
  await dialog.getByLabel('Last Name', { exact: true }).fill('Agent');
  await dialog.locator('#email').fill('new-agent@example.test');
  await dialog.locator('#staffPassword').fill('Test-password-123!');
  await dialog.getByRole('button', { name: 'Generate agent case number', exact: true }).click();
  await expect(dialog.getByLabel('Agent Case Code', { exact: true })).toHaveValue(/^AGT-[A-F0-9]{12}$/);
  await dialog.getByLabel('Agent Case Code', { exact: true }).fill('Case@551');
  await dialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'North Group', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Assigned Supervisor', exact: true }).click();
  await page.getByRole('option', { name: 'North Supervisor', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.locator('button[type=submit]').scrollIntoViewIfNeeded();
  await expect(dialog.locator('button[type=submit]')).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('create-agent-white-mobile.png'), fullPage: true });
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  expect(creations[0]).toMatchObject({ role: 'agent', phone: null, agentCaseCode: 'Case@551' });
});

for (const role of ['admin', 'group_admin', 'supervisor']) {
  test(`${role} customer rows show the assigned agent, group, and supervisor`, async ({ page }) => {
    const backend = await mockGroupDetails(page, role);
    // Account creator is deliberately different from the assigned agent.
    Object.assign(backend.client, { created_by: backend.supervisor.id });
    await page.goto(role === 'admin' ? '/admin' : role === 'group_admin' ? '/group-admin' : '/supervisor');
    await expect(page.getByRole('columnheader', { name: 'Assigned Agent', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Group', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Assigned Supervisor', exact: true })).toBeVisible();
    const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'North Client', exact: true }) });
    await expect(row.getByRole('cell', { name: 'North Agent', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'North Group', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'North Supervisor', exact: true })).toBeVisible();
    if (role !== 'supervisor') {
      const unassigned = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Unassigned Client', exact: true }) });
      await expect(unassigned.getByRole('cell', { name: 'Unassigned', exact: true })).toHaveCount(2);
      await expect(unassigned.getByRole('cell', { name: 'North Group', exact: true })).toBeVisible();
    }
    if (role === 'admin') {
      await page.screenshot({ path: test.info().outputPath('client-assignments-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      const mobileRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: /^North Client/ }) });
      await expect(mobileRow.locator('dl')).toContainText('Assigned Agent: North Agent');
      await expect(mobileRow.locator('dl')).toContainText('Group: North Group');
      await expect(mobileRow.locator('dl')).toContainText('Assigned Supervisor: North Supervisor');
      await mobileRow.locator('dl').scrollIntoViewIfNeeded();
      await expect(mobileRow.locator('dl')).toBeInViewport();
      await page.screenshot({ path: test.info().outputPath('client-assignments-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await page.getByRole('tab', { name: 'Agents', exact: true }).click();
    await expect(page.getByRole('columnheader', { name: 'Group', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Assigned Supervisor', exact: true })).toBeVisible();
    const agentRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'North Agent', exact: true }) });
    await expect(agentRow.getByRole('cell', { name: 'North Group', exact: true })).toBeVisible();
    await expect(agentRow).toContainText('North Supervisor');
    expect(backend.pageErrors).toEqual([]);
  });
}

test('client ownership does not borrow staff from another group or mislabel missing links as unassigned', async ({ page }) => {
  const backend = await mockGroupDetails(page);
  const foreignAgent = backend.member('73000000-0000-4000-8000-000000000001', 'Foreign', 'Agent', { group_id: backend.otherGroupId });
  backend.members.push(foreignAgent, backend.member('73000000-0000-4000-8000-000000000002', 'Invalid', 'Assignment', { assigned_to: foreignAgent.id }));
  backend.roles.push({ id: foreignAgent.id, user_id: foreignAgent.id, role: 'agent' });
  await page.goto('/admin');
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Invalid Assignment', exact: true }) });
  await expect(row.getByRole('cell', { name: 'Not available', exact: true })).toHaveCount(2);
  await expect(row).not.toContainText('Foreign Agent');
  await expect(row.getByRole('cell', { name: 'North Group', exact: true })).toBeVisible();
});

for (const role of ['admin', 'group_admin', 'supervisor']) {
  test(`${role} sees the agent case code in the Agents section and agent profile`, async ({ page }) => {
    const backend = await mockGroupDetails(page, role);
    await page.goto(role === 'admin' ? '/admin?tab=agents' : role === 'group_admin' ? '/group-admin' : '/supervisor');
    if (role !== 'admin') await page.getByRole('tab', { name: 'Agents', exact: true }).click();
    const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'North Agent', exact: true }) });
    await expect(row.getByText(backend.agentCaseCode, { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'North Agent', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Assigned clients', exact: true });
    await expect(dialog.getByText(backend.agentCaseCode, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('cell', { name: 'North Client', exact: true })).toBeVisible();
    await expect(dialog.getByText('Unassigned Client', { exact: true })).toHaveCount(0);
    await dialog.getByRole('link', { name: 'Profile', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/customer/${backend.agent.id}$`));
    await expect(page.getByText(backend.agentCaseCode, { exact: true })).toHaveCount(2);
    await page.reload();
    await expect(page.getByText(backend.agentCaseCode, { exact: true })).toHaveCount(2);
    expect(backend.pageErrors).toEqual([]);
  });
}

test('agent dashboard shows its assigned mixed-case number even without customers on mobile', async ({ page }) => {
  const backend = await mockGroupDetails(page, 'agent');
  backend.controls.codeOverride = 'Case@551';
  backend.client.assigned_to = null;
  const requests: unknown[] = [];
  await page.route(`${supabaseUrl}/rest/v1/rpc/get_agent_case_codes`, route => {
    requests.push(route.request().postDataJSON());
    return route.fallback();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/agent');
  const card = page.getByRole('region', { name: 'Your case number', exact: true });
  await expect(card.getByText('Case@551', { exact: true })).toBeVisible();
  await expect(card).toBeInViewport();
  await expect(page.getByRole('cell', { name: 'No customers assigned to you', exact: true })).toBeVisible();
  expect(requests).toEqual([{ p_agent_ids: [userId] }]);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await card.getByRole('button', { name: 'Copy case code Case@551', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Case@551');
  await page.screenshot({ path: test.info().outputPath('agent-own-case-number-mobile.png'), fullPage: true });
  await page.reload();
  await expect(card.getByText('Case@551', { exact: true })).toBeVisible();
  expect(backend.pageErrors).toEqual([]);
});

test('agent dashboard case lookup failures can be retried without hiding its customers', async ({ page }) => {
  const backend = await mockGroupDetails(page, 'agent');
  backend.controls.codesError = true;
  await page.goto('/agent');
  const card = page.getByRole('region', { name: 'Your case number', exact: true });
  await expect(card.getByRole('alert')).toHaveText('Unable to load the agent case number.');
  await expect(page.getByRole('cell', { name: 'North Client', exact: true })).toBeVisible();
  backend.controls.codesError = false;
  await card.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(card.getByText(backend.agentCaseCode, { exact: true })).toBeVisible();
  await expect(card.getByRole('alert')).toHaveCount(0);
});

test('agent dashboard does not display a customer case number when its own code is unavailable', async ({ page }) => {
  await mockGroupDetails(page, 'agent');
  await page.route(`${supabaseUrl}/rest/v1/rpc/get_agent_case_codes`, route => route.fulfill({ json: [] }));
  await page.goto('/agent');
  const card = page.getByRole('region', { name: 'Your case number', exact: true });
  await expect(card.getByText('Not available', { exact: true })).toBeVisible();
  await expect(card).not.toContainText('N-001');
  await expect(page.getByRole('cell', { name: 'N-001', exact: true })).toBeVisible();
});

test('agent case code lookup failures offer a working retry', async ({ page }) => {
  const backend = await mockGroupDetails(page);
  backend.controls.codesError = true;
  await page.goto('/admin?tab=agents');
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'North Agent', exact: true }) });
  await expect(row.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(row.getByText(backend.agentCaseCode, { exact: true })).toHaveCount(0);
  backend.controls.codesError = false;
  await row.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(row.getByText(backend.agentCaseCode, { exact: true })).toBeVisible();
});

test('supervisors show their group and agent count and open only their agents and clients', async ({ page }) => {
  const backend = await mockGroupDetails(page);
  const otherSupervisor = backend.member('72000000-0000-4000-8000-000000000001', 'Other', 'Supervisor');
  const otherAgent = backend.member('72000000-0000-4000-8000-000000000002', 'Other', 'Agent', { supervisor_id: otherSupervisor.id });
  const foreignAgent = backend.member('72000000-0000-4000-8000-000000000003', 'Foreign', 'Agent', { group_id: backend.otherGroupId, supervisor_id: backend.supervisor.id });
  backend.members.push(otherSupervisor, otherAgent, foreignAgent);
  backend.roles.push({ id: otherSupervisor.id, user_id: otherSupervisor.id, role: 'supervisor' },
    ...[otherAgent, foreignAgent].map(agent => ({ id: agent.id, user_id: agent.id, role: 'agent' })));
  await page.goto('/admin?tab=supervisors');
  const supervisorRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'North Supervisor', exact: true }) });
  await expect(supervisorRow.getByRole('link', { name: 'North Group', exact: true })).toBeVisible();
  const count = supervisorRow.getByRole('button', { name: 'Agents assigned to North Supervisor', exact: true });
  await expect(count).toHaveText('1');
  await page.screenshot({ path: test.info().outputPath('supervisors-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await count.scrollIntoViewIfNeeded();
  await expect(count).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('supervisors-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await count.click();
  const agents = page.getByRole('dialog', { name: 'Agents assigned to North Supervisor', exact: true });
  await expect(agents.getByRole('button', { name: 'North Agent', exact: true })).toBeVisible();
  await expect(agents.getByText('Other Agent', { exact: true })).toHaveCount(0);
  await expect(agents.getByText('Foreign Agent', { exact: true })).toHaveCount(0);
  await expect(agents.getByRole('button', { name: 'Clients assigned to North Agent' })).toHaveText('1');
  await agents.getByRole('button', { name: 'North Agent', exact: true }).click();
  const clients = page.getByRole('dialog', { name: 'Assigned clients', exact: true });
  await expect(clients.getByRole('cell', { name: 'North Client', exact: true })).toBeVisible();
  await expect(clients.getByText('Unassigned Client', { exact: true })).toHaveCount(0);
  await expect(clients.getByText('Outside Client', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(clients.getByRole('button', { name: 'View North Client', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('agent-clients-mobile.png'), fullPage: true });
  await clients.getByRole('button', { name: 'View North Client', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/${customerId}$`));
  expect(backend.groupReads.some(request => request.query.get('assigned_to') === `eq.${backend.agent.id}` && request.query.get('group_id') === `eq.${groupId}`)).toBe(true);
  expect(backend.pageErrors).toEqual([]);
});

test('agent names open clients, show an empty assignment, and recover from load errors', async ({ page }) => {
  const backend = await mockGroupDetails(page);
  const emptyAgent = backend.member('72000000-0000-4000-8000-000000000004', 'Empty', 'Agent');
  backend.members.push(emptyAgent);
  backend.roles.push({ id: emptyAgent.id, user_id: emptyAgent.id, role: 'agent' });
  await page.goto('/admin?tab=agents');
  await page.getByRole('button', { name: 'North Agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Assigned clients', exact: true });
  await expect(dialog.getByRole('cell', { name: 'North Client', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Empty Agent', exact: true }).click();
  await expect(dialog.getByText('No clients assigned to this agent', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('cell', { name: 'North Client', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  backend.controls.clientsError = true;
  await page.getByRole('button', { name: 'North Agent', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Clients unavailable');
  await expect(dialog.getByRole('cell', { name: 'North Client', exact: true })).toHaveCount(0);
  backend.controls.clientsError = false;
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByRole('cell', { name: 'North Client', exact: true })).toBeVisible();
  expect(backend.pageErrors).toEqual([]);
});

test('group admins can drill from supervisors through agents to assigned clients', async ({ page }) => {
  const backend = await mockGroupDetails(page, 'group_admin');
  await page.goto('/group-admin');
  await page.getByRole('tab', { name: 'Supervisors', exact: true }).click();
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'North Supervisor', exact: true }) });
  await expect(row.getByRole('cell', { name: 'North Group', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Agents assigned to North Supervisor' })).toHaveText('1');
  await row.getByRole('button', { name: 'North Supervisor', exact: true }).click();
  await page.getByRole('dialog', { name: 'Agents assigned to North Supervisor' }).getByRole('button', { name: 'North Agent', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Assigned clients', exact: true }).getByRole('cell', { name: 'North Client', exact: true })).toBeVisible();
  expect(backend.groupReads.filter(request => request.query.has('assigned_to')).every(request => request.query.get('group_id') === `eq.${groupId}`)).toBe(true);
  expect(backend.pageErrors).toEqual([]);
});

test('group detail agent names open their client list', async ({ page }) => {
  await mockGroupDetails(page);
  await page.goto(`/admin/groups/${groupId}?tab=agents`);
  await page.getByRole('button', { name: 'North Agent', exact: true }).click();
  await expect(page.getByRole('tab', { name: /^Clients/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('cell', { name: 'North Client', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Unassigned Client', exact: true })).toHaveCount(0);
});

test('agent client lists include clients beyond the first page', async ({ page }) => {
  const backend = await mockGroupDetails(page, 'admin', 500);
  for (const member of backend.members) {
    if (member.case_number?.startsWith('EXTRA-')) member.assigned_to = backend.agent.id;
  }
  await page.goto('/admin?tab=agents');
  await page.getByRole('button', { name: 'North Agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Assigned clients', exact: true });
  await expect(dialog.getByRole('cell', { name: 'EXTRA-499', exact: true })).toHaveCount(1);
  await expect(dialog.getByRole('row')).toHaveCount(502);
  expect(backend.groupReads.some(request => request.query.get('assigned_to') === `eq.${backend.agent.id}` && request.query.get('offset') === '500')).toBe(true);
});

test('supervisors can click their assigned agents to see clients', async ({ page }) => {
  const backend = await mockBackend(page, { role: 'supervisor' });
  await page.goto('/supervisor');
  await page.getByRole('tab', { name: /Agents/ }).click();
  await page.getByRole('button', { name: 'Assigned Agent', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Assigned clients', exact: true }).getByRole('cell', { name: 'Sample Customer', exact: true })).toBeVisible();
  expect(backend.requests.some(request => request.query.get('assigned_to') === 'eq.00000000-0000-4000-8000-000000000004' && request.query.get('group_id') === `eq.${groupId}`)).toBe(true);
  expect(backend.pageErrors).toEqual([]);
});

test('clicking a group opens its admins, supervisors, agents, and clients with correct assignments', async ({ page }) => {
  const backend = await mockGroupDetails(page);
  await page.goto('/admin?tab=groups');
  await page.getByRole('link', { name: 'North Group', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/groups/${groupId}$`));
  await expect(page.getByRole('heading', { name: 'North Group', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Admins\s*1$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Supervisors\s*1$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Agents\s*1$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Clients\s*2$/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'North Client', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Outside Client', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: /^Admins/ }).click();
  await expect(page.getByRole('cell', { name: 'North Admin', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /^Supervisors/ }).click();
  await expect(page.getByRole('cell', { name: 'North Supervisor', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /^Agents/ }).click();
  await expect(page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'North Agent', exact: true }) })).toContainText('North Supervisor');
  await page.getByRole('button', { name: 'Clients assigned to North Agent', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'North Client', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Unassigned Client', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filter', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Unassigned Client', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: /Search name/ }).fill('N-002');
  await expect(page.getByRole('cell', { name: 'North Client', exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Unassigned Client', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: /Search name/ }).fill('');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath('group-details-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath('group-details-mobile.png'), fullPage: true });
  expect(backend.groupReads.some(request => request.path.endsWith('/profiles') && request.query.get('group_id') === `eq.${groupId}`)).toBe(true);
  expect(backend.pageErrors).toEqual([]);
});

test('group detail links open client records and return to the Groups tab', async ({ page }) => {
  await mockGroupDetails(page);
  await page.goto(`/admin/groups/${groupId}`);
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'North Client', exact: true }) });
  await row.getByRole('link', { name: 'View', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customer/${customerId}$`));
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'North Group', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to groups', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?tab=groups$/);
  await expect(page.getByRole('tab', { name: 'Groups', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('an empty group shows zero members without reusing another groups data', async ({ page }) => {
  const backend = await mockGroupDetails(page);
  backend.controls.emptyOtherGroup = true;
  await page.goto(`/admin/groups/${groupId}`);
  await expect(page.getByRole('cell', { name: 'North Client', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to groups', exact: true }).click();
  await page.getByRole('link', { name: 'South Group', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'South Group', exact: true })).toBeVisible();
  await expect(page.getByText('No members in this section.', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'North Client', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Clients\s*0$/ })).toBeVisible();
});

test('a failed group role lookup shows retry instead of misclassifying staff as clients', async ({ page }) => {
  const backend = await mockGroupDetails(page);
  backend.controls.rolesError = true;
  await page.goto(`/admin/groups/${groupId}`);
  await expect(page.getByRole('alert')).toContainText('Unable to load group details');
  await expect(page.getByRole('cell', { name: 'North Supervisor', exact: true })).toHaveCount(0);
  backend.controls.rolesError = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Clients\s*2$/ })).toBeVisible();
});

test('group member counts include later pages of profiles', async ({ page }) => {
  const backend = await mockGroupDetails(page, 'admin', 500);
  await page.goto(`/admin/groups/${groupId}`);
  await expect(page.getByRole('button', { name: /^Clients\s*502$/ })).toBeVisible();
  expect(backend.groupReads.some(request => request.path.endsWith('/profiles') && request.query.get('offset') === '500')).toBe(true);
  await page.getByRole('textbox', { name: /Search name/ }).fill('EXTRA-499');
  await expect(page.getByRole('cell', { name: 'EXTRA-499', exact: true })).toBeVisible();
});

test('a group admin can inspect their own group but cannot inspect another group', async ({ page }) => {
  const backend = await mockGroupDetails(page, 'group_admin');
  await page.goto(`/admin/groups/${groupId}`);
  await expect(page.getByRole('cell', { name: 'North Client', exact: true })).toBeVisible();
  await page.goto(`/admin/groups/${backend.otherGroupId}`);
  await expect(page.getByRole('alert')).toContainText('Group not found or you do not have access');
  await expect(page.getByRole('cell', { name: 'Outside Client', exact: true })).toHaveCount(0);
  expect(backend.groupReads.some(request => request.path.endsWith('/profiles') && request.query.get('group_id') === `eq.${backend.otherGroupId}`)).toBe(false);
});

const mockPermissionSettings = async (page: Page, options: { loadError?: boolean; saveError?: string } = {}) => {
  const backend = await mockBackend(page, { role: 'admin' });
  const settings = ['group_admin', 'supervisor', 'agent'].map(role => ({ role, permission: 'reset_password', mode: role === 'agent' ? 'approval' : 'direct', version: 1, updated_at: '2026-11-22T10:00:00Z' }));
  const controls = { loadError: false, saveError: '', ...options };
  const submissions: { p_changes: { role: string; permission: string; mode: string; version: number }[] }[] = [];
  await page.route(`${supabaseUrl}/rest/v1/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/role_permissions')) return controls.loadError
      ? route.fulfill({ status: 503, json: { message: 'Permissions unavailable' } }) : route.fulfill({ json: settings });
    if (url.pathname.endsWith('/rpc/save_role_permissions')) {
      const body = route.request().postDataJSON();
      submissions.push(body);
      if (controls.saveError) return route.fulfill({ status: 409, json: { code: '40001', message: controls.saveError } });
      for (const change of body.p_changes) {
        const setting = settings.find(row => row.role === change.role)!;
        setting.mode = change.mode; setting.version++;
      }
      return route.fulfill({ json: settings });
    }
    return route.fallback();
  });
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Permissions', exact: true }).click();
  return { ...backend, settings, controls, submissions };
};

test('Superior Admin saves role permissions and the saved setting survives a reload', async ({ page }) => {
  const backend = await mockPermissionSettings(page);
  await expect(page.getByRole('button', { name: 'Save permissions', exact: true })).toBeDisabled();
  const agentPermission = page.getByRole('combobox', { name: 'Agent Reset passwords', exact: true });
  await expect(agentPermission).toHaveText('Require approval');
  await agentPermission.click();
  await page.getByRole('option', { name: 'Allow directly', exact: true }).click();
  await page.getByRole('button', { name: 'Save permissions', exact: true }).click();
  await expect(page.getByText('Permissions saved', { exact: true })).toBeVisible();
  expect(backend.submissions).toEqual([{ p_changes: [{ role: 'agent', permission: 'reset_password', mode: 'direct', version: 1 }] }]);
  await expect(page.getByRole('button', { name: 'Save permissions', exact: true })).toBeDisabled();
  await expect(page.getByText('Superior Admin always has full access.', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('permissions-settings.png'), fullPage: true });
  await page.reload();
  await page.getByRole('tab', { name: 'Permissions', exact: true }).click();
  await expect(agentPermission).toHaveText('Allow directly');
  expect(backend.pageErrors).toEqual([]);
});

test('permission save errors retain changes and allow an explicit reload of saved settings', async ({ page }) => {
  const message = 'Permissions changed. Reload the saved permissions and try again.';
  const backend = await mockPermissionSettings(page, { saveError: message });
  const selector = page.getByRole('combobox', { name: 'Supervisor Reset passwords', exact: true });
  await selector.click();
  await page.getByRole('option', { name: 'Deny', exact: true }).click();
  await page.getByRole('button', { name: 'Save permissions', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(message);
  await expect(selector).toHaveText('Deny');
  expect(backend.settings.find(row => row.role === 'supervisor')?.mode).toBe('direct');
  await page.getByRole('button', { name: 'Reload saved permissions', exact: true }).click();
  await expect(selector).toHaveText('Allow directly');
});

test('a failed permissions load has a working retry and no editable fallback', async ({ page }) => {
  const backend = await mockPermissionSettings(page, { loadError: true });
  await expect(page.getByRole('alert')).toContainText('Unable to load permissions');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  backend.controls.loadError = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Agent Reset passwords', exact: true })).toBeVisible();
});

const mockPasswordAccess = async (page: Page, permissionMode: 'direct' | 'approval' | 'deny', permissionError = false) => {
  const backend = await mockBackend(page, { role: 'agent', permissionMode, permissionError });
  await page.route(`${supabaseUrl}/rest/v1/profiles**`, route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('id') === `eq.${customerId}`) return route.fulfill({ json: {
      id: customerId, email: 'customer@example.test', first_name: 'Sample', last_name: 'Customer', group_id: groupId,
      assigned_to: userId, platform: 'brightfund', case_number: 'TEST-001', status: 'active', case_phase: 'review',
      recovery_search_duration_minutes: 60, recovery_result_details: {},
    } });
    return route.fallback();
  });
  return backend;
};

test('an agent with direct permission changes its assigned client password through the direct dialog', async ({ page }) => {
  const backend = await mockPasswordAccess(page, 'direct');
  const submissions: object[] = [];
  await page.route(`${supabaseUrl}/functions/v1/reset-user-password`, route => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, userId: customerId } });
  });
  await page.goto(`/customer/${customerId}?tab=access`);
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New Password', { exact: true }).fill('Test-password-123!');
  await dialog.getByLabel('Confirm Password', { exact: true }).fill('Test-password-123!');
  await dialog.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(submissions).toEqual([{ userId: customerId, newPassword: 'Test-password-123!' }]);
  expect(backend.pageErrors).toEqual([]);
});

test('approval mode creates a caller-bound request without a direct reset', async ({ page }) => {
  const backend = await mockPasswordAccess(page, 'approval');
  const submissions: object[] = [];
  await page.route(`${supabaseUrl}/rest/v1/rpc/request_password_reset`, route => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: '00000000-0000-4000-8000-000000000077' });
  });
  await page.goto(`/customer/${customerId}?tab=access`);
  await expect(page.getByRole('button', { name: 'Change password', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Request Password Reset', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('textarea').fill('Client requested a reset');
  await dialog.getByRole('button', { name: 'Submit Request', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(submissions).toEqual([{ p_target_user_id: customerId, p_reason: 'Client requested a reset' }]);
  expect(backend.count('reset-user-password', 'POST')).toBe(0);
  expect(backend.count('password_reset_requests', 'POST')).toBe(0);
});

test('deny mode and permission-load failures expose no password-changing action', async ({ page }) => {
  const backend = await mockPasswordAccess(page, 'deny');
  await page.goto(`/customer/${customerId}?tab=access`);
  await expect(page.getByRole('button', { name: 'Password reset disabled', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Change password', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Request Password Reset', exact: true })).toHaveCount(0);
  expect(backend.count('reset-user-password', 'POST')).toBe(0);
});

test('permission failures can be retried and saved changes update the open client page through Realtime', async ({ page }) => {
  const backend = await mockPasswordAccess(page, 'approval', true);
  await page.goto(`/customer/${customerId}?tab=access`);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  backend.state.permissionError = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Request Password Reset', exact: true })).toBeVisible();
  await expect.poll(() => backend.subscriptions.some(subscription => subscription.bindings.some(binding => binding.table === 'role_permissions'))).toBe(true);
  backend.state.permissionMode = 'direct';
  backend.publishChange('role_permissions', { role: 'agent', permission: 'reset_password', mode: 'direct' });
  await expect(page.getByRole('button', { name: 'Change password', exact: true })).toBeVisible();
  backend.state.permissionMode = 'deny';
  backend.publishChange('role_permissions', { role: 'agent', permission: 'reset_password', mode: 'deny' });
  await expect(page.getByRole('button', { name: 'Password reset disabled', exact: true })).toBeDisabled();
});

test('Superior Admin can approve a pending request through the password requests component', async ({ page }) => {
  await mockBackend(page, { role: 'admin' });
  const requestId = '00000000-0000-4000-8000-000000000077';
  let pending = true;
  const submissions: object[] = [];
  await page.route(`${supabaseUrl}/rest/v1/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/password_reset_requests')) return route.fulfill({ json: pending ? [{ id: requestId, target_user_id: customerId, requested_by: '00000000-0000-4000-8000-000000000004', status: 'pending', reason: 'Client request', created_at: '2026-11-22T10:00:00Z' }] : [] });
    if (url.pathname.endsWith('/rpc/get_password_reset_review_permissions')) return route.fulfill({ json: [{ request_id: requestId, can_review: true, can_approve: true }] });
    return route.fallback();
  });
  await page.route(`${supabaseUrl}/functions/v1/approve-password-reset`, route => {
    submissions.push(route.request().postDataJSON()); pending = false;
    return route.fulfill({ json: { success: true } });
  });
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Password requests', exact: true }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New Password', { exact: true }).fill('Test-password-123!');
  await dialog.getByRole('button', { name: 'Approve Reset', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(submissions).toEqual([{ requestId, action: 'approve', newPassword: 'Test-password-123!' }]);
});

test('a role requiring approval cannot configure permissions or approve its own request', async ({ page }) => {
  const backend = await mockBackend(page, { role: 'group_admin', permissionMode: 'approval' });
  const requestId = '00000000-0000-4000-8000-000000000077';
  await page.route(`${supabaseUrl}/rest/v1/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/password_reset_requests')) return route.fulfill({ json: [{ id: requestId, target_user_id: customerId, requested_by: userId, status: 'pending', reason: 'Client request', created_at: '2026-11-22T10:00:00Z' }] });
    if (url.pathname.endsWith('/rpc/get_password_reset_review_permissions')) return route.fulfill({ json: [{ request_id: requestId, can_review: false, can_approve: false }] });
    return route.fallback();
  });
  await page.goto('/group-admin');
  await expect(page.getByRole('tab', { name: 'Permissions', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Password Resets', exact: true }).click();
  await expect(page.getByText('Awaiting approval', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0);
  expect(backend.count('approve-password-reset', 'POST')).toBe(0);
});

const mockBalanceAdjustment = async (page: Page, role = 'admin') => {
  const backend = await mockBackend(page, { role });
  const balances = ['EUR', 'USD', 'CAD'].map(currency => ({ id: `balance-${currency}`, customer_id: customerId, currency, balance: 0, visible_on_dashboard: true }));
  const controls = { error: '', readError: false, delay: 0 };
  const submissions: { p_currency: string; p_amount: number; p_adjustment_type: string; p_reason?: string }[] = [];
  let profileReads = 0;
  await page.route(`${supabaseUrl}/rest/v1/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/profiles') && url.searchParams.get('id') === `eq.${customerId}`) {
      profileReads++;
      return route.fulfill({ json: { id: customerId, first_name: 'Sample', last_name: 'Customer', email: 'customer@example.test', group_id: groupId, platform: 'brightfund', assigned_to: userId, status: 'active', case_phase: 'review', recovery_search_duration_minutes: 60, recovery_result_details: {} } });
    }
    if (url.pathname.endsWith('/customer_balances')) {
      if (controls.readError) return route.fulfill({ status: 400, json: { message: 'Latest balances are temporarily unavailable' } });
      return route.fulfill({ json: balances });
    }
    if (url.pathname.endsWith('/rpc/adjust_fiat_balance')) {
      const body = route.request().postDataJSON();
      submissions.push(body);
      if (controls.delay) await new Promise(resolve => setTimeout(resolve, controls.delay));
      if (controls.error) return route.fulfill({ status: 400, json: { message: controls.error, code: '22003' } });
      const balance = balances.find(item => item.currency === body.p_currency)!;
      balance.balance += body.p_adjustment_type === 'credit' ? body.p_amount : -body.p_amount;
      return route.fulfill({ json: balance.balance });
    }
    return route.fallback();
  });
  await page.goto(`/customer/${customerId}`);
  await page.getByRole('tab', { name: 'Balances', exact: true }).click();
  const openDialog = async (currency = 'EUR') => {
    await page.getByRole('tabpanel').getByText(currency, { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Adjust', exact: true }).click();
    return page.getByRole('dialog');
  };
  return { ...backend, balances, controls, submissions, openDialog, profileReads: () => profileReads };
};

for (const role of ['admin', 'group_admin', 'supervisor', 'agent']) {
  test(`${role} can credit and debit every currency while remaining on Balances`, async ({ page }) => {
    const backend = await mockBalanceAdjustment(page, role);
    const readsBefore = backend.profileReads();
    for (const currency of ['EUR', 'USD', 'CAD']) {
      for (const type of ['Credit', 'Debit']) {
        const dialog = await backend.openDialog(currency);
        await dialog.getByRole('button', { name: type, exact: true }).click();
        await dialog.getByLabel(`Amount (${currency})`, { exact: true }).fill('132874');
        await dialog.getByLabel('Reason (optional)', { exact: true }).fill('Fondi recuperati');
        await dialog.getByRole('button', { name: `${type} Balance`, exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await expect(page.getByRole('tab', { name: 'Balances', exact: true })).toHaveAttribute('aria-selected', 'true');
      }
    }
    expect(backend.submissions).toHaveLength(6);
    expect(backend.balances.map(item => item.balance)).toEqual([0, 0, 0]);
    expect(backend.profileReads()).toBe(readsBefore);
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Balances', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(backend.pageErrors).toEqual([]);
  });
}

test('a balance error displays its actual reason and preserves the entered values', async ({ page }) => {
  const backend = await mockBalanceAdjustment(page);
  backend.controls.error = 'Insufficient EUR balance. Available: 0';
  const dialog = await backend.openDialog();
  await dialog.getByRole('button', { name: 'Debit', exact: true }).click();
  await dialog.getByLabel('Amount (EUR)', { exact: true }).fill('10');
  await dialog.getByLabel('Reason (optional)', { exact: true }).fill('Keep my reason');
  await dialog.getByRole('button', { name: 'Debit Balance', exact: true }).click();
  await expect(page.getByText(backend.controls.error, { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Amount (EUR)', { exact: true })).toHaveValue('10');
  await expect(dialog.getByLabel('Reason (optional)', { exact: true })).toHaveValue('Keep my reason');
  await expect(dialog.getByRole('button', { name: 'Debit Balance', exact: true })).toBeEnabled();
  expect(backend.submissions).toHaveLength(1);
  backend.controls.error = '';
  await dialog.getByRole('button', { name: 'Credit', exact: true }).click();
  await dialog.getByRole('button', { name: 'Credit Balance', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(backend.balances[0].balance).toBe(10);
});

test('token events and repeated submits preserve a pending balance adjustment', async ({ page }) => {
  const backend = await mockBalanceAdjustment(page);
  backend.controls.delay = 500;
  const dialog = await backend.openDialog();
  await dialog.getByLabel('Amount (EUR)', { exact: true }).fill('10');
  const readsBefore = backend.profileReads();
  const channelsBefore = backend.subscriptions.length;
  await backend.broadcast('TOKEN_REFRESHED', { ...backend.session, user: { ...backend.session.user, user_metadata: { language: 'en' } } });
  await page.waitForTimeout(100);
  await expect(dialog.getByLabel('Amount (EUR)', { exact: true })).toHaveValue('10');
  expect(backend.profileReads()).toBe(readsBefore);
  expect(backend.subscriptions).toHaveLength(channelsBefore);
  await dialog.locator('form').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(dialog.getByRole('button', { name: 'Credit Balance', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toBeVisible();
  expect(backend.submissions).toHaveLength(1);
  expect(backend.balances[0].balance).toBe(10);
});

test('a failed background read after credit does not turn a saved adjustment into a failed one', async ({ page }) => {
  const backend = await mockBalanceAdjustment(page);
  const dialog = await backend.openDialog();
  await dialog.getByLabel('Amount (EUR)', { exact: true }).fill('10');
  backend.controls.readError = true;
  await dialog.getByRole('button', { name: 'Credit Balance', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Balance saved; could not refresh the latest balances', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Balances', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(backend.submissions).toHaveLength(1);
  const nextDialog = await backend.openDialog();
  await expect(nextDialog).toContainText(/10,00\s*€/);
  expect(backend.pageErrors).toEqual([]);
});

const submitLogin = async (page: Page) => {
  await page.locator('#login-email').fill('staff@example.test');
  await page.locator('#login-password').fill('test-password');
  await page.locator('form button[type=submit]').click();
};

const openCustomerPassword = async (page: Page) => {
  const backend = await mockBackend(page, { role: 'admin' });
  await page.goto('/admin');
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'customer@example.test', exact: true }) });
  await row.getByRole('button', { name: 'Change password', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Change password', exact: true });
  await expect(dialog).toBeVisible();
  return { backend, dialog };
};

test('admin changes a customer login password directly from the customer list', async ({ page }) => {
  const { backend, dialog } = await openCustomerPassword(page);
  const bodies: object[] = [];
  await page.route(`${supabaseUrl}/functions/v1/reset-user-password`, route => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, userId: customerId } });
  });
  await expect(dialog).toContainText('customer@example.test');
  await expect(dialog.getByLabel('New Password', { exact: true })).toHaveAttribute('type', 'password');
  await dialog.getByLabel('New Password', { exact: true }).fill('New-Login-Password-123!');
  await dialog.getByLabel('Confirm Password', { exact: true }).fill('New-Login-Password-123!');
  await dialog.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Password has been reset successfully', { exact: true }).first()).toBeVisible();
  expect(bodies).toEqual([{ userId: customerId, newPassword: 'New-Login-Password-123!' }]);
  expect(backend.pageErrors).toEqual([]);
});

test('password confirmation and minimum length prevent an invalid submission', async ({ page }) => {
  const { backend, dialog } = await openCustomerPassword(page);
  const save = dialog.getByRole('button', { name: 'Change password', exact: true });
  await expect(save).toBeDisabled();
  await dialog.getByLabel('New Password', { exact: true }).fill('short12');
  await dialog.getByLabel('Confirm Password', { exact: true }).fill('short12');
  await expect(save).toBeDisabled();
  await dialog.getByLabel('New Password', { exact: true }).fill('Long-Enough-Password!');
  await expect(dialog.getByText('Passwords do not match', { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  expect(backend.count('reset-user-password', 'POST')).toBe(0);
});

test('Auth password policy errors remain visible and the dialog stays open', async ({ page }) => {
  const { dialog } = await openCustomerPassword(page);
  await page.route(`${supabaseUrl}/functions/v1/reset-user-password`, route => route.fulfill({
    status: 400, json: { error: 'Password must contain a special character' },
  }));
  await dialog.getByLabel('New Password', { exact: true }).fill('LongEnoughPassword123');
  await dialog.getByLabel('Confirm Password', { exact: true }).fill('LongEnoughPassword123');
  await dialog.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByText('Password must contain a special character', { exact: true }).first()).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Change password', exact: true })).toBeEnabled();
  await expect(page.getByText('Password has been reset successfully', { exact: true })).toHaveCount(0);
});

test('password dialog requires explicit backend success and clears secrets on close', async ({ page }) => {
  const { dialog } = await openCustomerPassword(page);
  await page.route(`${supabaseUrl}/functions/v1/reset-user-password`, route => route.fulfill({ json: {} }));
  await dialog.getByRole('button', { name: 'Generate Secure Password', exact: true }).click();
  const generated = await dialog.getByLabel('New Password', { exact: true }).inputValue();
  expect(generated).toHaveLength(16);
  expect(generated).toMatch(/[A-Z]/);
  expect(generated).toMatch(/[a-z]/);
  expect(generated).toMatch(/[0-9]/);
  expect(generated).toMatch(/[!@#$%&*]/);
  await expect(dialog.getByLabel('Confirm Password', { exact: true })).toHaveValue(generated);
  await dialog.getByRole('button', { name: 'Hide password', exact: true }).click();
  await expect(dialog.getByLabel('New Password', { exact: true })).toHaveAttribute('type', 'password');
  await dialog.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByText('Unable to change the password. Please try again.', { exact: true }).first()).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'customer@example.test', exact: true }) });
  await row.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(dialog.getByLabel('New Password', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Confirm Password', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('New Password', { exact: true })).toHaveAttribute('type', 'password');
});

const mockAgentAssignment = async (page: Page, options: { grouped?: boolean; error?: boolean; role?: string; assigned?: boolean; groupError?: boolean } = {}) => {
  await mockBackend(page, { role: options.role || 'admin' });
  const eligibleAgentId = '00000000-0000-4000-8000-000000000004';
  const otherGroupId = '00000000-0000-4000-8000-000000000005';
  const agentProfiles = [
    { id: eligibleAgentId, first_name: 'Eligible', last_name: 'Agent', group_id: groupId, platform: 'brightfund' },
    { id: '00000000-0000-4000-8000-000000000006', first_name: 'Other', last_name: 'Group', group_id: otherGroupId, platform: 'brightfund' },
    { id: '00000000-0000-4000-8000-000000000007', first_name: 'Other', last_name: 'Brand', group_id: groupId, platform: 'chargeback' },
  ];
  const customer = {
    id: customerId, email: 'customer@example.test', first_name: 'Sample', last_name: 'Customer',
    group_id: options.grouped ? groupId : null, platform: 'brightfund', assigned_to: options.assigned ? eligibleAgentId : null as string | null,
    status: 'active', created_at: '2026-01-01T00:00:00Z', preferred_currency: 'USD', case_phase: 'review',
    recovery_search_duration_minutes: 60, recovery_result_details: {},
  };
  const updates: object[] = [];
  const groupMoves: object[] = [];
  const errorMessage = 'Customers can only be assigned to an agent in the same group and platform';
  await page.route(`${supabaseUrl}/rest/v1/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/rpc/set_customer_group')) {
      const move = route.request().postDataJSON();
      groupMoves.push(move);
      if (options.groupError) return route.fulfill({ status: 403, json: { message: 'Only administrators can move customers between groups' } });
      if (customer.group_id !== move.p_group_id) customer.assigned_to = null;
      customer.group_id = move.p_group_id;
      return route.fulfill({ json: customer });
    }
    if (url.pathname.endsWith('/groups')) {
      return route.fulfill({ json: [
        { id: groupId, name: 'Test Group', platform: 'brightfund' },
        { id: otherGroupId, name: 'Second Group', platform: 'brightfund' },
        { id: '00000000-0000-4000-8000-000000000008', name: 'Other Brand Group', platform: 'chargeback' },
      ] });
    }
    if (url.pathname.endsWith('/user_roles') && url.searchParams.get('role') === 'eq.agent') {
      return route.fulfill({ json: agentProfiles.map(agent => ({ user_id: agent.id })) });
    }
    if (url.pathname.endsWith('/profiles')) {
      if (route.request().method() === 'PATCH') {
        const update = route.request().postDataJSON();
        updates.push(update);
        if (options.error) return route.fulfill({ status: 400, json: { code: '23514', message: errorMessage } });
        customer.assigned_to = update.assigned_to;
        return route.fulfill({ json: { id: customerId } });
      }
      if (url.searchParams.get('id') === `eq.${customerId}`) return route.fulfill({ json: customer });
      if (url.searchParams.get('id')?.startsWith('in.')) return route.fulfill({ json: agentProfiles });
    }
    return route.fallback();
  });
  return { eligibleAgentId, customer, updates, errorMessage, groupMoves, otherGroupId };
};

const assignedAgentSelect = (page: Page) =>
  page.getByText('Assigned Agent:', { exact: true }).locator('..').getByRole('combobox');

const mockStaffHierarchy = async (page: Page, role = 'admin', denyAssignment = false) => {
  await mockBackend(page, { role });
  const staff = [
    { id: '00000000-0000-4000-8000-000000000014', first_name: 'Team', last_name: 'Agent', email: 'agent@example.test', group_id: groupId, supervisor_id: null as string | null, role: 'agent', assigned_to: null },
    { id: '00000000-0000-4000-8000-000000000015', first_name: 'Team', last_name: 'Supervisor', email: 'supervisor@example.test', group_id: groupId, supervisor_id: null, role: 'supervisor', assigned_to: null },
    { id: '00000000-0000-4000-8000-000000000016', first_name: 'Outside', last_name: 'Supervisor', email: 'outside@example.test', group_id: '00000000-0000-4000-8000-000000000099', supervisor_id: null, role: 'supervisor', assigned_to: null },
  ];
  const assignments: object[] = [];
  await page.route(`${supabaseUrl}/rest/v1/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/groups')) {
      const group = { id: groupId, name: 'Test Group', platform: 'brightfund' };
      return route.fulfill({ json: url.searchParams.has('id') ? group : [group] });
    }
    if (url.pathname.endsWith('/rpc/set_agent_supervisor')) {
      const body = route.request().postDataJSON();
      assignments.push(body);
      if (denyAssignment) return route.fulfill({ status: 403, json: { message: 'Agent is outside your permitted scope' } });
      staff[0].supervisor_id = body.p_supervisor_id;
      return route.fulfill({ json: null });
    }
    if (url.pathname.endsWith('/profiles') && (!url.searchParams.has('id') || url.searchParams.get('id')?.startsWith('in.'))) {
      return route.fulfill({ json: url.searchParams.get('group_id') ? staff.filter(person => `eq.${person.group_id}` === url.searchParams.get('group_id')) : staff });
    }
    if (url.pathname.endsWith('/user_roles') && url.searchParams.get('select') === '*') return route.fulfill({ json: staff.map(person => ({ id: person.id, user_id: person.id, role: person.role })) });
    return route.fallback();
  });
  return { staff, assignments };
};

for (const role of ['admin', 'group_admin']) {
  test(`${role} assigns an agent to a supervisor from the same group`, async ({ page }) => {
    const backend = await mockStaffHierarchy(page, role);
    await page.goto(role === 'admin' ? '/admin' : '/group-admin');
    await page.getByRole('tab', { name: 'Agents', exact: true }).click();
    const selector = page.getByRole('combobox', { name: 'Assigned Supervisor', exact: true });
    await selector.click();
    await expect(page.getByRole('option', { name: 'Outside Supervisor', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: 'Team Supervisor', exact: true }).click();
    await expect(selector).toHaveText('Team Supervisor');
    expect(backend.assignments).toEqual([{ p_agent_id: backend.staff[0].id, p_supervisor_id: backend.staff[1].id }]);
  });
}

test('a denied supervisor assignment keeps the agent unassigned and displays the reason', async ({ page }) => {
  await mockStaffHierarchy(page, 'group_admin', true);
  await page.goto('/group-admin');
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  const selector = page.getByRole('combobox', { name: 'Assigned Supervisor', exact: true });
  await selector.click();
  await page.getByRole('option', { name: 'Team Supervisor', exact: true }).click();
  await expect(page.getByText('Agent is outside your permitted scope', { exact: true })).toBeVisible();
  await expect(selector).toHaveText('Unassigned');
});

test('agent creation requires the selected group supervisor', async ({ page }) => {
  const backend = await mockStaffHierarchy(page);
  const creations: Record<string, unknown>[] = [];
  await page.route(`${supabaseUrl}/functions/v1/create-user`, route => {
    creations.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, userId: customerId } });
  });
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await page.getByRole('tabpanel').getByRole('button', { name: 'CREATE', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#firstName').fill('New');
  await dialog.locator('#lastName').fill('Agent');
  await dialog.locator('#email').fill('new-agent@example.test');
  await dialog.locator('#staffPassword').fill('Test-password-123!');
  await expect(dialog.locator('#phone')).toHaveCount(0);
  await dialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Test Group', exact: true }).click();
  await expect(dialog.locator('button[type=submit]')).toBeDisabled();
  await dialog.getByRole('combobox', { name: 'Assigned Supervisor', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Outside Supervisor', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'Team Supervisor', exact: true }).click();
  await dialog.locator('#staffPassword').fill('seven77');
  await expect(dialog.getByRole('status')).toHaveText('Password must be at least 8 characters');
  await expect(dialog.locator('#staffPassword')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.locator('button[type=submit]')).toBeDisabled();
  expect(creations).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(dialog.locator('#staffPassword')).toHaveAttribute('type', 'text');
  await dialog.locator('#staffPassword').fill('Test-password-123!');
  await expect(dialog.locator('button[type=submit]')).toBeEnabled();
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  expect(creations).toHaveLength(1);
  expect(creations[0]).toMatchObject({ role: 'agent', groupId, supervisorId: backend.staff[1].id, phone: null });
});

test('agent creation displays the backend failure and allows a corrected retry', async ({ page }) => {
  await mockGroupDetails(page);
  let fail = true;
  await page.route(`${supabaseUrl}/functions/v1/create-user`, route => route.fulfill(fail
    ? { status: 400, json: { error: 'A user with this email address already exists. Please use a different email.' } }
    : { json: { success: true, userId: customerId } }));
  await page.goto('/admin?tab=agents');
  await page.getByRole('tabpanel').getByRole('button', { name: 'CREATE', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill('taken@example.test');
  await dialog.getByLabel('Password', { exact: true }).fill('Test-password-123!');
  await dialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'North Group', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Assigned Supervisor', exact: true }).click();
  await page.getByRole('option', { name: 'North Supervisor', exact: true }).click();
  await dialog.locator('button[type=submit]').click();
  await expect(page.getByText('A user with this email address already exists. Please use a different email.', { exact: true }).first()).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Email', { exact: true })).toHaveValue('taken@example.test');
  await expect(dialog.locator('button[type=submit]')).toBeEnabled();
  fail = false;
  await dialog.getByLabel('Email', { exact: true }).fill('available@example.test');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
});

test('supervisor dashboard requests only its agents and their clients', async ({ page }) => {
  const backend = await mockBackend(page, { role: 'supervisor' });
  await page.goto('/supervisor');
  await expect(page.getByRole('cell', { name: 'customer@example.test', exact: true })).toBeVisible();
  expect(backend.requests.some(request => request.path.endsWith('/profiles') && request.query.get('supervisor_id') === `eq.${userId}`)).toBe(true);
  expect(backend.requests.some(request => request.path.endsWith('/profiles') && request.query.get('assigned_to')?.startsWith('in.'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Promote', exact: true })).toHaveCount(0);
});

test('Superior Admin groups an unassigned client before selecting an agent', async ({ page }) => {
  const backend = await mockAgentAssignment(page);
  await page.goto(`/customer/${customerId}`);
  await page.getByRole('combobox', { name: 'Group', exact: true }).click();
  await page.getByRole('option', { name: 'Test Group', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Group', exact: true })).toHaveText('Test Group');
  await assignedAgentSelect(page).click();
  await page.getByRole('option', { name: 'Eligible Agent', exact: true }).click();
  await expect(assignedAgentSelect(page)).toHaveText('Eligible Agent');
  expect(backend.updates).toEqual([{ assigned_to: backend.eligibleAgentId }]);
  expect(backend.customer.group_id).toBe(groupId);
});

for (const grouped of [false, true]) {
  test(`Superior Admin sees only same-group agents with an ${grouped ? 'existing' : 'unset'} client group`, async ({ page }) => {
    await mockAgentAssignment(page, { grouped });
    await page.goto(`/customer/${customerId}`);
    await assignedAgentSelect(page).click();
    if (grouped) await expect(page.getByRole('option', { name: 'Eligible Agent', exact: true })).toBeVisible();
    else await expect(page.getByRole('option', { name: 'Eligible Agent', exact: true })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Other Brand', exact: true })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Other Group', exact: true })).toHaveCount(0);
  });
}

test('assignment errors display the database message instead of Unexpected error', async ({ page }) => {
  const backend = await mockAgentAssignment(page, { error: true, grouped: true });
  await page.goto(`/customer/${customerId}`);
  await assignedAgentSelect(page).click();
  await page.getByRole('option', { name: 'Eligible Agent', exact: true }).click();
  await expect(page.getByText(backend.errorMessage, { exact: true })).toBeVisible();
  await expect(page.getByText('Unexpected error', { exact: true })).toHaveCount(0);
});

test('administrator can select a group before assigning any agent', async ({ page }) => {
  const backend = await mockAgentAssignment(page);
  await page.goto(`/customer/${customerId}`);
  const groupSelect = page.getByRole('combobox', { name: 'Group', exact: true });
  await expect(groupSelect).toHaveText('No group');
  await groupSelect.click();
  await expect(page.getByRole('option', { name: 'Other Brand Group', exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('customer-group-selector.png') });
  await page.getByRole('option', { name: 'Test Group', exact: true }).click();
  await expect(groupSelect).toHaveText('Test Group');
  await expect(assignedAgentSelect(page)).toHaveText('Unassigned');
  expect(backend.groupMoves).toEqual([{ p_customer_id: customerId, p_group_id: groupId }]);
});

test('moving groups clears the old agent and shows only agents in the destination group', async ({ page }) => {
  const backend = await mockAgentAssignment(page, { grouped: true, assigned: true });
  await page.goto(`/customer/${customerId}`);
  await expect(assignedAgentSelect(page)).toHaveText('Eligible Agent');
  await page.getByRole('combobox', { name: 'Group', exact: true }).click();
  await page.getByRole('option', { name: 'Second Group', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Group', exact: true })).toHaveText('Second Group');
  await expect(assignedAgentSelect(page)).toHaveText('Unassigned');
  await assignedAgentSelect(page).click();
  await expect(page.getByRole('option', { name: 'Other Group', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Eligible Agent', exact: true })).toHaveCount(0);
  expect(backend.groupMoves).toEqual([{ p_customer_id: customerId, p_group_id: backend.otherGroupId }]);
});

test('administrator can remove a customer from their group', async ({ page }) => {
  const backend = await mockAgentAssignment(page, { grouped: true, assigned: true });
  await page.goto(`/customer/${customerId}`);
  await page.getByRole('combobox', { name: 'Group', exact: true }).click();
  await page.getByRole('option', { name: 'No group', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Group', exact: true })).toHaveText('No group');
  await expect(assignedAgentSelect(page)).toHaveText('Unassigned');
  expect(backend.groupMoves).toEqual([{ p_customer_id: customerId, p_group_id: null }]);
});

test('group transfer permission errors are displayed without changing the current group', async ({ page }) => {
  await mockAgentAssignment(page, { groupError: true });
  await page.goto(`/customer/${customerId}`);
  await page.getByRole('combobox', { name: 'Group', exact: true }).click();
  await page.getByRole('option', { name: 'Test Group', exact: true }).click();
  await expect(page.getByText('Only administrators can move customers between groups', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Group', exact: true })).toHaveText('No group');
});

test('non-administrator staff have no group transfer control', async ({ page }) => {
  await mockAgentAssignment(page, { role: 'supervisor', grouped: true });
  await page.goto(`/customer/${customerId}`);
  await expect(assignedAgentSelect(page)).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Group', exact: true })).toHaveCount(0);
});

const fillRegistration = async (page: Page) => {
  await page.locator('#first-name').fill('New');
  await page.locator('#last-name').fill('Customer');
  await page.locator('#signup-email').fill('new-customer@example.test');
  await page.locator('#signup-case-number').fill('CASE-NEW');
  await page.locator('#signup-password').fill('Test-password-123');
  await page.locator('#confirm-password').fill('Test-password-123');
};

test('client registration uses a case number without registration codes', async ({ page }) => {
  const backend = await mockBackend(page, { restored: false, role: 'user' });
  const signups: Record<string, unknown>[] = [];
  await page.route(`${supabaseUrl}/functions/v1/register-client`, route => {
    const body = route.request().postDataJSON();
    signups.push(body);
    const session = makeSession();
    backend.setSession(session);
    return route.fulfill({ json: { success: true, session } });
  });
  await page.goto('/auth?mode=signup');
  await expect(page.locator('#signup-promocode')).toHaveCount(0);
  await fillRegistration(page);
  await page.locator('#signup-case-number').fill('');
  await page.locator('form button[type=submit]').click();
  expect(signups).toHaveLength(0);
  await page.locator('#signup-case-number').fill('CASE-NEW');
  await page.locator('form button[type=submit]').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(signups).toHaveLength(1);
  expect(signups[0]).toEqual({ email: 'new-customer@example.test', password: 'Test-password-123', firstName: 'New', lastName: 'Customer', caseNumber: 'CASE-NEW' });
  expect(backend.count('validate_promocode', 'POST')).toBe(0);
  expect(backend.pageErrors).toEqual([]);
});

test('client registration displays Case@552 with the entered capitalization on overview and My Case', async ({ page }) => {
  const backend = await mockBackend(page, { restored: false, role: 'user' });
  let storedCase = '';
  await page.route(`${supabaseUrl}/functions/v1/register-client`, route => {
    const body = route.request().postDataJSON();
    expect(body.caseNumber).toBe('Case@552');
    storedCase = body.caseNumber;
    const session = makeSession();
    backend.setSession(session);
    return route.fulfill({ json: { success: true, session } });
  });
  await page.route(`${supabaseUrl}/rest/v1/profiles*`, route => {
    if (new URL(route.request().url()).searchParams.get('id') !== `eq.${userId}`) return route.fallback();
    return route.fulfill({ json: {
      id: userId, email: 'new-customer@example.test', first_name: 'New', last_name: 'Customer',
      group_id: null, assigned_to: null, case_number: storedCase, status: 'active',
      preferred_currency: 'USD', display_currency: 'USD', case_phase: 'submitted',
      recovery_search_duration_minutes: 60, recovery_result_details: {},
    } });
  });
  await page.goto('/auth?mode=signup');
  await fillRegistration(page);
  await page.locator('#signup-case-number').fill('Case@552');
  await page.locator('form button[type=submit]').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const number = page.getByText('Your Case Number', { exact: true }).locator('..');
  await expect(number).toContainText('Case@552');
  await expect(number.getByText('Case@552', { exact: true })).toHaveCSS('text-transform', 'none');
  await expect(page.getByText('CASE@552', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'My Case', exact: true }).first().click();
  await expect(number).toContainText('Case@552');
  await expect(page.getByText('CASE@552', { exact: true })).toHaveCount(0);
  expect(backend.pageErrors).toEqual([]);
});

test('agent dashboard loads its assigned clients while retired code tables deny access', async ({ page }) => {
  const backend = await mockBackend(page, { role: 'agent' });
  const retiredReads: string[] = [];
  for (const table of ['agent_signup_codes', 'promocodes']) {
    await page.route(`${supabaseUrl}/rest/v1/${table}*`, route => {
      retiredReads.push(table);
      return route.fulfill({ status: 403, json: { code: '42501', message: `permission denied for table ${table}` } });
    });
  }
  await page.goto('/agent');
  await expect(page.getByRole('cell', { name: 'customer@example.test', exact: true })).toBeVisible();
  await expect(page.getByText('1 Assigned Customers', { exact: true })).toBeVisible();
  await expect(page.getByText(/permission denied for table/)).toHaveCount(0);
  expect(backend.count('agent_signup_codes')).toBe(0);
  expect(backend.count('promocodes')).toBe(0);
  expect(retiredReads).toEqual([]);
  expect(backend.pageErrors).toEqual([]);
});

for (const [role, path] of [['admin', '/admin'], ['group_admin', '/group-admin'], ['agent', '/agent']]) {
  test(`${role} CRM has no promo management or agent signup codes`, async ({ page }) => {
    const backend = await mockBackend(page, { role });
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByRole('tab', { name: /promo/i })).toHaveCount(0);
    await expect(page.getByText(/agent signup code/i)).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: /signup code/i })).toHaveCount(0);
    expect(backend.count('promocodes')).toBe(0);
    expect(backend.count('agent_signup_codes')).toBe(0);
    expect(backend.pageErrors).toEqual([]);
  });
}

test('administrator can create a customer without requiring a group', async ({ page }) => {
  await mockBackend(page, { role: 'admin' });
  const created: { groupId: string | null; role: string }[] = [];
  await page.route(`${supabaseUrl}/functions/v1/create-user`, route => {
    created.push(route.request().postDataJSON());
    return route.fulfill({ json: { userId: customerId, platform: 'brightfund', success: true } });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: /create client/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#firstName').fill('New');
  await dialog.locator('#lastName').fill('Customer');
  await dialog.locator('#email').fill('new-customer@example.test');
  await dialog.locator('#password').fill('Test-password-123');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).not.toBeVisible();
  expect(created).toHaveLength(1);
  expect(created[0].groupId).toBeNull();
  expect(created[0].role).toBe('user');
});

test('guest login only downloads its own page and does not query private tables', async ({ page }) => {
  const backend = await mockBackend(page, { restored: false });
  const scripts: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.goto('/auth');
  await expect(page.locator('#login-email')).toBeVisible();
  await expect(page.locator('form button[type=submit]')).toBeEnabled();
  expect(backend.requests).toHaveLength(0);
  expect(scripts.some(script => /\/(Agent|Admin|CustomerDetail)-/.test(script))).toBe(false);
  expect(backend.pageErrors).toEqual([]);
});

for (const [role, path] of [['agent', '/agent'], ['supervisor', '/supervisor'], ['group_admin', '/group-admin'], ['admin', '/admin'], ['user', '/dashboard']]) {
  test(`restored ${role} session opens the correct dashboard with one role lookup`, async ({ page }) => {
    const backend = await mockBackend(page, { role });
    await page.goto('/auth');
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator('h1')).toBeVisible();
    if (role !== 'user') await expect(page.getByRole('cell', { name: 'customer@example.test', exact: true })).toBeVisible();
    expect(backend.count('user_roles')).toBe(role === 'agent' || role === 'user' ? 1 : 2);
    expect(backend.count('token', 'POST')).toBe(0);
    expect(backend.pageErrors).toEqual([]);
  });
}

test('fresh agent login waits for IP approval and avoids duplicate user/role requests', async ({ page }) => {
  const backend = await mockBackend(page, { restored: false, validateDelay: 800 });
  await page.goto('/auth');
  await submitLogin(page);
  await expect(page.getByText('Completing sign in…')).toBeVisible();
  expect(backend.validationCompleted()).toBe(false);
  expect(backend.count('user_roles')).toBe(0);
  await expect(page).toHaveURL(/\/agent$/);
  await expect(page.getByRole('cell', { name: 'customer@example.test', exact: true })).toBeVisible();
  expect(backend.validationCompleted()).toBe(true);
  expect(backend.count('user_roles')).toBe(1);
  expect(backend.count('user')).toBe(1);
  expect(backend.pageErrors).toEqual([]);
});

test('denied IP cannot navigate to or load the staff dashboard', async ({ page }) => {
  const backend = await mockBackend(page, { restored: false, allowed: false });
  await page.goto('/auth');
  await submitLogin(page);
  await expect(page.getByText('Test location denied').first()).toBeVisible();
  await expect(page.locator('#login-email')).toBeVisible();
  await expect(page).toHaveURL(/\/auth$/);
  expect(backend.count('user_roles')).toBe(0);
  expect(backend.count('profiles')).toBe(0);
});

test('MFA completes before any session is installed in the browser', async ({ page }) => {
  const backend = await mockBackend(page, { restored: false, mfa: true });
  await page.goto('/auth');
  await submitLogin(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(backend.count('token', 'POST')).toBe(0);
  expect(backend.count('user')).toBe(0);
  expect(backend.count('account-login', 'POST')).toBe(1);
  await page.getByPlaceholder('000000').fill('123456');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page).toHaveURL(/\/agent$/);
  await expect(page.getByRole('cell', { name: 'customer@example.test', exact: true })).toBeVisible();
  expect(backend.count('token', 'POST')).toBe(0);
  expect(backend.count('account-login', 'POST')).toBe(2);
});

test('token and focus events do not reload roles, customers or subscriptions', async ({ page }) => {
  const backend = await mockBackend(page);
  await page.goto('/agent');
  await expect(page.getByRole('cell', { name: 'customer@example.test', exact: true })).toBeVisible();
  await expect.poll(() => backend.subscriptions.length).toBe(4);
  const before = backend.requests.length;
  const subscriptionsBefore = backend.subscriptions.length;
  for (let index = 0; index < 3; index++) {
    await backend.broadcast('TOKEN_REFRESHED', { ...backend.session, access_token: `${backend.session.access_token}-${index}` });
  }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(300);
  expect(backend.requests).toHaveLength(before);
  expect(backend.subscriptions).toHaveLength(subscriptionsBefore);
  await expect(page.getByRole('cell', { name: 'customer@example.test', exact: true })).toBeVisible();
  expect(backend.pageErrors).toEqual([]);
});

test('role service failure shows retry without a redirect loop', async ({ page }) => {
  const backend = await mockBackend(page, { roleError: true });
  await page.goto('/agent');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(backend.count('user_roles')).toBe(1);
  await expect(page).toHaveURL(/\/agent$/);
  backend.state.roleError = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('cell', { name: 'customer@example.test', exact: true })).toBeVisible();
  expect(backend.count('user_roles')).toBe(2);
});

test('missing agent profile produces an actionable error instead of a blank page', async ({ page }) => {
  await mockBackend(page, { missingProfile: true });
  await page.goto('/agent');
  await expect(page.getByText('Your agent profile is unavailable. Please contact your administrator.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('customer layout and pages share data across navigation and token refresh', async ({ page }) => {
  const backend = await mockBackend(page, { role: 'user' });
  await page.goto('/dashboard');
  await expect(page.locator('h1')).toBeVisible();
  await expect.poll(() => backend.count('profiles')).toBe(1);
  expect(backend.count('customer_balances')).toBe(1);
  expect(backend.count('portfolio_items')).toBe(1);
  const before = backend.count('profiles');
  await page.getByRole('link', { name: 'Wallet', exact: true }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/wallet$/);
  await backend.broadcast('TOKEN_REFRESHED', backend.session);
  await page.waitForTimeout(200);
  expect(backend.count('profiles')).toBe(before);
  expect(backend.count('customer_balances')).toBe(1);
  expect(backend.pageErrors).toEqual([]);
});

test('missing customer profile is displayed clearly and can be retried', async ({ page }) => {
  const backend = await mockBackend(page, { role: 'user', missingProfile: true });
  await page.goto('/dashboard');
  await expect(page.getByText('Your account profile is unavailable. Please contact your administrator.')).toBeVisible();
  backend.state.missingProfile = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('h1')).toBeVisible();
  expect(backend.pageErrors).toEqual([]);
});

test('expired, rate-limited session returns to a usable login form', async ({ page }) => {
  const backend = await mockBackend(page, { expiredSession: true });
  await page.goto('/agent');
  await expect(page.locator('#login-email')).toBeVisible();
  await expect(page.locator('form button[type=submit]')).toBeEnabled();
  expect(backend.count('token', 'POST')).toBeLessThanOrEqual(2);
  expect(backend.pageErrors).toEqual([]);
});

test('customer cannot open an agent route', async ({ page }) => {
  await mockBackend(page, { role: 'user' });
  await page.goto('/agent');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('h1')).toBeVisible();
});

test('logout clears the cached staff role before the next login', async ({ page }) => {
  const backend = await mockBackend(page);
  await page.goto('/agent');
  await expect(page.getByRole('cell', { name: 'customer@example.test', exact: true })).toBeVisible();
  await backend.broadcast('SIGNED_OUT', null);
  await expect(page.locator('#login-email')).toBeVisible();
  backend.state.role = 'user';
  await backend.broadcast('SIGNED_IN', backend.session);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('h1')).toBeVisible();
  expect(backend.count('user_roles')).toBe(2);
  expect(backend.pageErrors).toEqual([]);
});

test('an unavailable MFA service does not bypass verification', async ({ page }) => {
  const backend = await mockBackend(page, { restored: false, mfaError: true });
  await page.goto('/auth');
  await submitLogin(page);
  await expect(page.locator('form button[type=submit]')).toBeEnabled();
  expect(backend.count('token', 'POST')).toBe(0);
  await expect(page).toHaveURL(/\/auth$/);
});

test('failed dashboard download displays a recovery screen', async ({ page }) => {
  await mockBackend(page);
  await page.route('**/assets/Agent-*.js', route => route.abort());
  await page.goto('/agent');
  await expect(page.getByText('This page could not load. Please try reloading it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('signed-in client case number follows its active agent change immediately on overview and My Case', async ({ page }) => {
  const backend = await mockBackend(page, { role: 'user' });
  await page.goto('/dashboard');
  const caseCard = page.getByText('Your Case Number', { exact: true }).locator('..');
  await expect(caseCard).toContainText('TEST-001');
  await expect.poll(() => backend.subscriptions.filter(item => item.bindings.some(binding => binding.table === 'profiles')).length).toBe(1);
  const reads = backend.count('profiles');
  const profile = { id: userId, first_name: 'Client', last_name: 'One', case_number: 'Case@553',
    assigned_to: '34000000-0000-4000-8000-000000000002', group_id: groupId,
    display_currency: 'USD', case_phase: 'review', status: 'active' };
  backend.updateProfile(profile);
  await expect(caseCard).toContainText('Case@553');
  expect(backend.count('profiles')).toBe(reads);
  await page.getByRole('link', { name: 'My Case', exact: true }).first().click();
  await expect(caseCard).toContainText('Case@553');
  backend.updateProfile({ ...profile, case_number: 'case@554' });
  await expect(caseCard).toContainText('case@554');
  await expect(page.getByText('Case@553', { exact: true })).toHaveCount(0);
  expect(backend.count('profiles')).toBe(reads);
  expect(backend.pageErrors).toEqual([]);
});

const mockReviewedTransaction = async (page: Page, initialStatus = 'approved') => {
  const backend = await mockBackend(page, { role: 'admin' });
  const transaction = {
    id: '36000000-0000-4000-8000-000000000001', customer_id: customerId,
    type: 'withdraw', amount: 5500, currency: 'EUR', method: 'bank_transfer', status: initialStatus,
    processed_by: initialStatus === 'pending' ? null : userId,
    processed_at: initialStatus === 'pending' ? null : '2026-11-23T12:00:00Z',
    created_at: '2026-11-23T11:00:00Z', review_message: 'Previous approval message',
  };
  const controls = { error: '', unconfirmed: false, delay: 0 };
  const submissions: Record<string, unknown>[] = [];
  await page.route(`${supabaseUrl}/rest/v1/transaction_requests*`, route => route.fulfill({ json: [transaction] }));
  await page.route(`${supabaseUrl}/rest/v1/rpc/review_transaction_request`, async route => {
    expect(route.request().headers().accept).toContain('application/vnd.pgrst.object+json');
    const body = route.request().postDataJSON();
    submissions.push(body);
    if (controls.delay) await new Promise(resolve => setTimeout(resolve, controls.delay));
    if (controls.error) return route.fulfill({ status: 400, json: { message: controls.error } });
    if (controls.unconfirmed) return route.fulfill({ json: {} });
    expect(body.p_expected_status).toBe(transaction.status);
    transaction.status = body.p_status;
    transaction.review_message = body.p_message;
    transaction.processed_by = body.p_status === 'pending' ? null : userId;
    transaction.processed_at = body.p_status === 'pending' ? null : '2026-11-23T13:00:00Z';
    return route.fulfill({ json: transaction });
  });
  await page.goto(`/customer/${customerId}?tab=transactions`);
  return { ...backend, transaction, controls, submissions };
};

test('approved withdrawal can be reopened, rejected, processed and approved again from the client record', async ({ page }) => {
  const backend = await mockReviewedTransaction(page);
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Change status', exact: true }) });
  for (const [status,label] of [['pending','Pending'],['rejected','Rejected'],['processing','Processing'],['approved','Approved']]) {
    const expected = backend.transaction.status;
    await row.getByRole('button', { name: 'Change status', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Change transaction status', exact: true });
    await expect(dialog.getByRole('button', { name: 'Save status', exact: true })).toBeDisabled();
    await dialog.getByRole('combobox', { name: 'Status', exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Message to client', exact: true }).fill(`Now ${status}`);
    await dialog.getByRole('button', { name: 'Save status', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText(label);
    await expect(row).toContainText(`Now ${status}`);
    expect(backend.submissions.at(-1)).toEqual({
      p_transaction_id: backend.transaction.id, p_status: status, p_expected_status: expected, p_message: `Now ${status}`,
    });
  }
  expect(backend.pageErrors).toEqual([]);
});

test('transaction status errors keep the dialog open, prevent duplicate submissions and require confirmed success', async ({ page }) => {
  const backend = await mockReviewedTransaction(page);
  await page.getByRole('button', { name: 'Change status', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Change transaction status', exact: true });
  await dialog.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: 'Pending', exact: true }).click();
  backend.controls.error = 'This request changed. Refresh it before saving.';
  backend.controls.delay = 400;
  await dialog.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Save status', exact: true })).toBeDisabled();
  await expect(page.getByText(backend.controls.error, { exact: true }).first()).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(backend.submissions).toHaveLength(1);
  backend.controls.error = ''; backend.controls.unconfirmed = true;
  await dialog.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(page.getByText('Unable to confirm the transaction status change.', { exact: true }).first()).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(backend.transaction.status).toBe('approved');
});

test('pending dashboard requests retain the quick approve action', async ({ page }) => {
  const backend = await mockReviewedTransaction(page,'pending');
  await page.getByRole('button', { name: 'Approve and message client', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Approve withdraw request', exact: true });
  await dialog.getByRole('button', { name: 'Confirm approval', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(backend.submissions[0]).toMatchObject({ p_status: 'approved', p_expected_status: 'pending' });
});

test('client sees status and message updates when an approved transaction returns to pending', async ({ page }) => {
  const backend = await mockBackend(page, { role: 'user' });
  const transaction = { id: '36000000-0000-4000-8000-000000000001', customer_id: userId, type: 'withdraw', amount: 5500,
    currency: 'EUR', method: 'bank_transfer', status: 'approved', review_message: 'Approved before', created_at: '2026-11-23T11:00:00Z', notes: null };
  await page.route(`${supabaseUrl}/rest/v1/transaction_requests*`, route => route.fulfill({ json: [transaction] }));
  await page.goto('/dashboard/transactions');
  await expect(page.getByText('Approved before', { exact: true })).toBeVisible();
  await expect.poll(() => backend.subscriptions.some(subscription => subscription.bindings.some(binding => binding.table === 'transaction_requests'))).toBe(true);
  backend.publishChange('transaction_requests',{ ...transaction,status:'pending',review_message:'Returned for another review' });
  await expect(page.getByText('Returned for another review', { exact: true })).toBeVisible();
  await expect(page.getByText('Approved before', { exact: true })).toHaveCount(0);
});

test('shared customer subscription still delivers profile updates without a refetch', async ({ page }) => {
  const backend = await mockBackend(page, { role: 'user' });
  await page.goto('/dashboard');
  await expect(page.locator('h1')).toBeVisible();
  await expect.poll(() => backend.subscriptions.filter(item => item.bindings.some(binding => binding.table === 'profiles')).length).toBe(1);
  expect(backend.subscriptions.find(item => item.bindings.some(binding => binding.table === 'profiles'))?.bindings).toHaveLength(6);
  const before = backend.count('profiles');
  backend.updateProfile({ id: userId, first_name: 'LiveUpdate', last_name: 'Customer', display_currency: 'USD', case_phase: 'review' });
  await expect(page.locator('h1')).toContainText('LiveUpdate');
  expect(backend.count('profiles')).toBe(before);
  expect(backend.pageErrors).toEqual([]);
});

test('registration opens the new account without showing its internal address', async ({ page }) => {
  const backend = await mockBackend(page, { restored: false, role: 'user' });
  const alias = 'new-customer+case-0123456789abcdef0123456789abcdef@example.test';
  await page.route(`${supabaseUrl}/functions/v1/register-client`, route => {
    const body = route.request().postDataJSON();
    expect(body.email).toBe('new-customer@example.test');
    expect(body.caseNumber).toBe('CASE-NEW');
    const session = makeSession();
    const registered = { ...session, user: { ...session.user, email: alias, user_metadata: { display_email: body.email } } };
    backend.setSession(registered);
    return route.fulfill({ json: { success: true, session: registered } });
  });
  await page.goto('/auth?mode=signup');
  await fillRegistration(page);
  await page.locator('form button[type=submit]').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('new-customer@example.test', { exact: true }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(alias);
  await expect(page.getByRole('button', { name: 'Copy login email', exact: true })).toHaveCount(0);
  expect(backend.count('signup', 'POST')).toBe(0);
  expect(backend.pageErrors).toEqual([]);
});

test('registration errors other than duplicate emails do not retry or claim account creation', async ({ page }) => {
  await mockBackend(page, { restored: false, role: 'user' });
  let signups = 0;
  await page.route(`${supabaseUrl}/functions/v1/register-client`, route => {
    signups++;
    return route.fulfill({ status: 400, json: { error: 'Please choose a stronger password' } });
  });
  await page.goto('/auth?mode=signup');
  await fillRegistration(page);
  await page.locator('form button[type=submit]').click();
  await expect(page.getByText('Please choose a stronger password', { exact: true })).toBeVisible();
  expect(signups).toBe(1);
  await expect(page.getByText('Account created!', { exact: true })).toHaveCount(0);
});

test('staff can create and reset a second client without any internal address appearing', async ({ page }) => {
  await mockBackend(page, { role: 'admin' });
  const loginEmail = 'customer+account-0123456789abcdef0123456789abcdef@example.test';
  const duplicateId = '00000000-0000-4000-8000-000000000004';
  let created = false;
  const resets: { userId: string; newPassword: string }[] = [];
  await page.route(`${supabaseUrl}/rest/v1/profiles**`, route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || url.searchParams.get('id')?.startsWith('eq.')) return route.fallback();
    return route.fulfill({ json: [
      { id: customerId, email: 'customer@example.test', login_email: 'customer@example.test', first_name: 'Sample', last_name: 'Customer', case_number: 'CASE-1' },
      ...(created ? [{ id: duplicateId, email: 'customer@example.test', login_email: loginEmail, first_name: 'Sample', last_name: 'Customer', case_number: 'CASE-2' }] : []),
    ] });
  });
  await page.route(`${supabaseUrl}/functions/v1/create-user`, route => {
    expect(route.request().postDataJSON().email).toBe('customer@example.test');
    expect(route.request().postDataJSON().caseNumber).toBe('CASE-2');
    created = true;
    return route.fulfill({ json: { userId: duplicateId, email: 'customer@example.test', caseNumber: 'CASE-2', success: true } });
  });
  await page.route(`${supabaseUrl}/functions/v1/reset-user-password`, route => {
    resets.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, userId: duplicateId } });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: /create client/i }).click();
  let dialog = page.getByRole('dialog');
  await dialog.locator('#firstName').fill('Sample');
  await dialog.locator('#lastName').fill('Customer');
  await dialog.locator('#email').fill('customer@example.test');
  await dialog.locator('#password').fill('Test-password-123');
  await dialog.locator('#caseNumber').fill('CASE-2');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).not.toBeVisible();
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'CASE-2', exact: true }) });
  await expect(row).toBeVisible();
  await expect(page.locator('body')).not.toContainText(loginEmail);
  await row.getByRole('button', { name: 'Change password', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('customer@example.test');
  await expect(dialog).toContainText('CASE-2');
  await expect(dialog).not.toContainText(loginEmail);
  await dialog.getByLabel('New Password', { exact: true }).fill('Separate-password-123');
  await dialog.getByLabel('Confirm Password', { exact: true }).fill('Separate-password-123');
  await dialog.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(resets).toEqual([{ userId: duplicateId, newPassword: 'Separate-password-123' }]);
});

test('the same email and password open each case directly without a chooser or internal addresses', async ({ browser }) => {
  for (const [id, caseNumber] of [[userId, 'Case@551'], [customerId, 'caseOther']]) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const backend = await mockBackend(page, { restored: false, role: 'user' });
      const alias = 'shared+account-0123456789abcdef0123456789abcdef@example.test';
      await page.route(`${supabaseUrl}/functions/v1/account-login`, route => {
        expect(route.request().postDataJSON()).toEqual({ email: 'shared@example.test', password: 'Same-password-123', caseNumber });
        const session = makeSession(id);
        const signedIn = { ...session, user: { ...session.user, email: id === userId ? 'shared@example.test' : alias, user_metadata: { display_email: 'shared@example.test' } } };
        backend.setSession(signedIn);
        return route.fulfill({ json: { session: signedIn } });
      });
      await page.goto('/auth');
      await page.locator('#login-email').fill('shared@example.test');
      await page.locator('#login-case-number').fill(caseNumber);
      await page.locator('#login-password').fill('Same-password-123');
      await page.locator('form button[type=submit]').click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect.poll(() => backend.requests.some(request => request.path.endsWith('/profiles') && request.query.get('id') === `eq.${id}`)).toBe(true);
      await expect(page.locator('body')).not.toContainText(alias);
      await expect(page.getByText('Choose your account', { exact: true })).toHaveCount(0);
      expect(backend.pageErrors).toEqual([]);
    } finally { await context.close(); }
  }
});

test('an incorrect case number cannot open another account or fall back to an account chooser', async ({ page }) => {
  const backend = await mockBackend(page, { restored: false, role: 'user' });
  await page.route(`${supabaseUrl}/functions/v1/account-login`, route => {
    const body = route.request().postDataJSON();
    expect(body).toEqual({ email: 'shared@example.test', password: 'Same-password-123', caseNumber: 'wrong-case' });
    return route.fulfill({ status: 401, json: { error: 'Invalid email, case number, or password' } });
  });
  await page.goto('/auth');
  await page.locator('#login-email').fill('shared@example.test');
  await page.locator('#login-password').fill('Same-password-123');
  await page.locator('#login-case-number').fill(' wrong-case ');
  await page.locator('form button[type=submit]').click();
  await expect(page.getByText('Invalid email, case number, or password', { exact: true })).toBeVisible();
  expect(backend.count('user')).toBe(0);
  expect(backend.count('user_roles')).toBe(0);
  await expect(page.getByText('Choose your account', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/auth$/);
});

test('registration requires a case number and rejects reuse of the same email/case pair', async ({ page }) => {
  await mockBackend(page, { restored: false, role: 'user' });
  const requests: { caseNumber: string }[] = [];
  await page.route(`${supabaseUrl}/functions/v1/register-client`, route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: { error: 'This email and case number are already registered. Please sign in.' } });
  });
  await page.goto('/auth?mode=signup');
  await fillRegistration(page);
  await page.locator('#signup-case-number').fill('');
  await page.locator('form button[type=submit]').click();
  expect(requests).toHaveLength(0);
  await page.locator('#signup-case-number').fill(' case-used ');
  await page.locator('form button[type=submit]').click();
  await expect(page.getByText('This email and case number are already registered. Please sign in.', { exact: true })).toBeVisible();
  expect(requests[0].caseNumber).toBe('case-used');
  await expect(page.locator('#signup-case-number')).toHaveValue(' case-used ');
});

for (const [role, home] of [['admin', '/admin'], ['group_admin', '/group-admin'], ['supervisor', '/supervisor'], ['agent', '/agent']]) {
  test(`${role} signs in with email and password while leaving the client case blank`, async ({ page }) => {
    await mockBackend(page, { role, restored: false });
    await page.route(`${supabaseUrl}/functions/v1/account-login`, route => {
      expect(route.request().postDataJSON()).toEqual({ email: 'staff@example.test', password: 'Staff-password-123' });
      return route.fulfill({ json: { session: makeSession() } });
    });
    await page.goto('/auth');
    await expect(page.locator('label[for="login-case-number"]')).toHaveText('Case Number');
    await expect(page.locator('#login-case-number')).not.toHaveAttribute('required');
    await expect(page.locator('body')).not.toContainText('clients only');
    await expect(page.locator('body')).not.toContainText('Staff can leave this blank');
    await page.locator('#login-email').fill('staff@example.test');
    await page.locator('#login-password').fill('Staff-password-123');
    await page.locator('form button[type=submit]').click();
    await expect(page).toHaveURL(new RegExp(`${home}$`));
  });
}

test('bulk staff credentials export email and password without a case-number column', async ({ page }) => {
  await mockBackend(page, { role: 'admin' });
  await page.route(`${supabaseUrl}/rest/v1/groups**`, route => route.fulfill({ json: [{ id: groupId, name: 'Test Group' }] }));
  const supervisorId = '00000000-0000-4000-8000-000000000009';
  await page.route(`${supabaseUrl}/rest/v1/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/profiles') && !url.searchParams.has('id')) return route.fulfill({ json: [{ id: supervisorId, first_name: 'Bulk', last_name: 'Supervisor', email: 'supervisor@example.test', group_id: groupId }] });
    if (url.pathname.endsWith('/user_roles') && url.searchParams.get('select') === '*') return route.fulfill({ json: [{ id: supervisorId, user_id: supervisorId, role: 'supervisor' }] });
    return route.fallback();
  });
  let createdEmail = '';
  await page.route(`${supabaseUrl}/functions/v1/create-user`, route => {
    const body = route.request().postDataJSON();
    expect(body.role).toBe('agent');
    expect(body.supervisorId).toBe(supervisorId);
    createdEmail = body.email;
    return route.fulfill({ json: { success: true, userId: customerId, email: createdEmail } });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: /bulk create/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type=number]').fill('1');
  await dialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Agents', exact: true }).click();
  await dialog.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: 'Test Group', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Assigned Supervisor', exact: true }).click();
  await page.getByRole('option', { name: 'Bulk Supervisor', exact: true }).click();
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByText(createdEmail, { exact: true })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: /download credentials/i }).click(),
  ]);
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('Email,Password');
  expect(csv).not.toContain('Case Number');
});

test('bulk client credentials retain their assigned case numbers for export', async ({ page }) => {
  await mockBackend(page, { role: 'admin' });
  await page.route(`${supabaseUrl}/rest/v1/groups**`, route => route.fulfill({ json: [{ id: groupId, name: 'Test Group' }] }));
  let createdEmail = '';
  await page.route(`${supabaseUrl}/functions/v1/create-user`, route => {
    createdEmail = route.request().postDataJSON().email;
    return route.fulfill({ json: { success: true, userId: customerId, email: createdEmail, caseNumber: 'CASE-DEMO-1' } });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: /bulk create/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type=number]').fill('1');
  await dialog.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: 'Test Group', exact: true }).click();
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByText('CASE-DEMO-1', { exact: true })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: /download credentials/i }).click(),
  ]);
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('Email,Case Number,Password');
  expect(csv).toContain(`"${createdEmail}","CASE-DEMO-1",`);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});


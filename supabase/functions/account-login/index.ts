import { createClient, type Session } from 'https://esm.sh/@supabase/supabase-js@2';
import { authCors, authJson, GatewayError, gatewayFailure, limitAuthRequests, openLoginTicket, sealLoginTicket } from '../_shared/authGateway.ts';
import { normalizeCaseNumber, isValidCaseNumber } from '../_shared/clientAccounts.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: authCors });
  if (req.method !== 'POST') return authJson(405, { error: 'Method not allowed' });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    const admin = createClient(url, secret, authOptions);
    let body;
    try { body = await req.json(); } catch { throw new GatewayError(400, 'Invalid request'); }

    const finish = async (session: Session, email: string, ticket?: string) => {
      // The MFA ticket remains bound to the exact case account authenticated.
      const { data: mfa, error } = await admin.from('user_mfa').select('is_enabled').eq('user_id', session.user.id).maybeSingle();
      if (error) throw new GatewayError(503, 'Unable to verify account security. Please try again.');
      if (mfa?.is_enabled) {
        if (typeof body.code !== 'string' || !body.code) return authJson(200, {
          mfaRequired: true, ticket: ticket || await sealLoginTicket(session, email, req, secret),
        });
        const { data: verified, error: verifyError } = await admin.functions.invoke('mfa-validate', { body: { userId: session.user.id, code: body.code } });
        if (verifyError || verified?.valid !== true || verified?.mfaRequired === false) {
          throw new GatewayError(401, 'Invalid verification code. Please try again.');
        }
      }
      return authJson(200, { session });
    };

    if (typeof body?.ticket === 'string') {
      const ticket = await openLoginTicket(body.ticket, req, secret);
      await limitAuthRequests(req, admin, secret, 'login-completion', ticket.email);
      return await finish(ticket.session, ticket.email, body.ticket);
    }

    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const caseNumber = normalizeCaseNumber(body?.caseNumber);
    if (!email || email.length > 254 || typeof body?.password !== 'string' || !body.password || body.password.length > 1024) {
      throw new GatewayError(400, 'Enter your email and password.');
    }
    if (caseNumber && !isValidCaseNumber(caseNumber)) throw new GatewayError(400, 'Enter a valid case number of up to 100 characters.');
    await limitAuthRequests(req, admin, secret, 'login', email);
    let loginEmail = email;
    let expectedUserId: string | undefined;
    if (caseNumber) {
      const { data: profiles, error } = await admin.from('profiles').select('id, login_email')
        .ilike('email', email.replace(/[\\%_]/g, '\\$&')).ilike('case_number', caseNumber.replace(/[\\%_]/g, '\\$&')).limit(2);
      if (error) throw new GatewayError(503, 'Sign in is temporarily unavailable. Please try again.');
      if (profiles?.length !== 1 || !profiles[0].login_email) throw new GatewayError(401, 'Invalid email, case number, or password');
      loginEmail = profiles[0].login_email;
      expectedUserId = profiles[0].id;
    } else {
      const { data: staff, error } = await admin.rpc('get_staff_login_account', { p_email: email });
      if (error) throw new GatewayError(503, 'Unable to verify account access. Please try again.');
      if (staff?.length > 1) throw new GatewayError(401, 'Unable to identify a unique staff account. Please contact an administrator.');
      if (staff?.length === 1) {
        loginEmail = staff[0].login_email;
        expectedUserId = staff[0].id;
      }
    }
    const client = createClient(url, publicKey, authOptions);
    const result = await client.auth.signInWithPassword({ email: loginEmail, password: body.password });
    if (result.error) {
      if (result.error.status === 429) throw new GatewayError(429, 'Too many attempts. Please wait a few minutes and try again.');
      if (!['invalid_credentials', 'email_not_confirmed', 'user_banned'].includes(result.error.code || '')) {
        throw new GatewayError(503, 'Sign in is temporarily unavailable. Please try again.');
      }
      throw new GatewayError(401, 'Invalid email, case number, or password');
    }
    if (!result.data.session || !result.data.user || (expectedUserId && result.data.user.id !== expectedUserId)) {
      throw new GatewayError(401, 'Invalid email, case number, or password');
    }
    // Existing staff retain email/password sign-in. A client must identify its
    // case, even if its password also happens to match another client account.
    if (!caseNumber) {
      const { data: role, error } = await admin.from('user_roles').select('role').eq('user_id', result.data.user.id).maybeSingle();
      if (error) throw new GatewayError(503, 'Unable to verify account access. Please try again.');
      if (!role || !['admin', 'group_admin', 'supervisor', 'agent'].includes(role.role)) {
        throw new GatewayError(400, 'Enter your case number to sign in to a client account.');
      }
    }
    return await finish(result.data.session, email);
  } catch (error) { return gatewayFailure(error); }
});

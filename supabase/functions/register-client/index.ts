import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createCaseLoginEmail, isDuplicateEmailError, normalizeCaseNumber, isValidCaseNumber } from '../_shared/clientAccounts.ts';
import { authCors, authJson, GatewayError, gatewayFailure, limitAuthRequests } from '../_shared/authGateway.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: authCors });
  if (req.method !== 'POST') return authJson(405, { error: 'Method not allowed' });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    let body;
    try { body = await req.json(); } catch { throw new GatewayError(400, 'Invalid request'); }
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const caseNumber = normalizeCaseNumber(body?.caseNumber);
    if (!email || email.length > 254 || typeof body?.password !== 'string' || body.password.length < 6 || body.password.length > 1024) {
      throw new GatewayError(400, 'Enter a valid email and a password of at least 6 characters.');
    }
    const admin = createClient(url, secret, options);
    await limitAuthRequests(req, admin, secret, 'register', email);
    if (!isValidCaseNumber(caseNumber)) throw new GatewayError(400, 'Enter a valid case number of up to 100 characters.');
    const { data: existing, error: lookupError } = await admin.from('profiles').select('id')
      .ilike('email', email.replace(/[\\%_]/g, '\\$&')).ilike('case_number', caseNumber.replace(/[\\%_]/g, '\\$&')).limit(1);
    if (lookupError) throw new GatewayError(503, 'Registration is temporarily unavailable. Please try again.');
    if (existing?.length) throw new GatewayError(409, 'This email and case number are already registered. Please sign in.');
    // Public registration creates clients. Staff accounts are created in the CRM.
    // Preserve Auth password rules and the configured email confirmation flow.
    const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, options);
    const loginEmail = await createCaseLoginEmail(email, caseNumber);
    const { data, error } = await client.auth.signUp({
      email: loginEmail, password: body.password,
      options: { data: {
        first_name: typeof body.firstName === 'string' ? body.firstName.trim() : '',
        last_name: typeof body.lastName === 'string' ? body.lastName.trim() : '',
        display_email: email,
        case_number: caseNumber,
      } },
    });
    if (isDuplicateEmailError(error) || (!error && !data.session && data.user?.identities?.length === 0)) {
      throw new GatewayError(409, 'This email and case number are already registered. Please sign in.');
    }
    if (error) throw new GatewayError(error.status === 429 ? 429 : 400,
      error.code === 'weak_password' ? 'Please choose a stronger password.' : 'Unable to create account. Please check your details and try again.');
    if (!data.user) throw new GatewayError(503, 'Unable to confirm account creation. Please try again.');
    return authJson(200, { success: true, session: data.session });
  } catch (error) { return gatewayFailure(error); }
});

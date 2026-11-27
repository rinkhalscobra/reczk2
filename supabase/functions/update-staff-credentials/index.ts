import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token) return json(401, { error: 'Unauthorized' });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user: actor }, error: authError } = await admin.auth.getUser(token);
    if (authError || !actor) return json(401, { error: 'Unauthorized' });
    const { data: actorRole, error: roleError } = await admin.from('user_roles')
      .select('role').eq('user_id', actor.id).maybeSingle();
    if (roleError) return json(500, { error: 'Unable to verify your permissions' });
    if (!actorRole || !['admin', 'group_admin', 'supervisor'].includes(actorRole.role)) {
      return json(403, { error: 'You are not authorized to change staff credentials' });
    }
    let body;
    try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
    const { userId, newEmail, newPassword } = body ?? {};
    if (typeof userId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId)) {
      return json(400, { error: 'A valid userId is required' });
    }
    if (userId === actor.id) return json(400, { error: 'Use account recovery to change your own credentials' });
    if (newEmail === undefined && newPassword === undefined) return json(400, { error: 'Provide a new email or password' });
    const email = typeof newEmail === 'string' ? newEmail.trim().toLowerCase() : '';
    if (newEmail !== undefined && (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return json(400, { error: 'A valid email address is required' });
    }
    if (newPassword !== undefined && (typeof newPassword !== 'string' || newPassword.length < 8 || !newPassword.trim())) {
      return json(400, { error: 'Password must be at least 8 characters and cannot be blank' });
    }
    const [profileResult, targetRoleResult] = await Promise.all([
      admin.from('profiles').select('id, is_archived').eq('id', userId).maybeSingle(),
      admin.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
    ]);
    if (profileResult.error || targetRoleResult.error) return json(500, { error: 'Unable to verify the target account' });
    if (!profileResult.data || profileResult.data.is_archived) return json(404, { error: 'Staff account not found' });
    if (!['admin', 'group_admin', 'supervisor', 'agent'].includes(targetRoleResult.data?.role)) {
      return json(403, { error: 'This action is only available for staff accounts' });
    }
    // Email changes also grant account access, so honor password permissions for both fields.
    // The database checks office, platform and the supervisor's assigned subtree.
    const { data: access, error: scopeError } = await admin.rpc('get_password_reset_access', {
      p_actor: actor.id, p_target: userId,
    });
    if (scopeError) return json(500, { error: 'Unable to verify your permissions' });
    if (access !== 'direct') return json(403, { error: 'You are not authorized to change these staff credentials directly' });

    // One Auth update: the email-sync database trigger runs in the same transaction.
    // Never write passwords to profiles, responses or logs.
    const attributes = {
      ...(newEmail !== undefined ? { email, email_confirm: true, user_metadata: { display_email: email } } : {}),
      ...(newPassword !== undefined ? { password: newPassword } : {}),
    };
    const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(userId, attributes);
    if (updateError) return json(400, { error: updateError.message });
    if (updated?.user?.id !== userId || (newEmail !== undefined && updated.user.email?.toLowerCase() !== email)) {
      return json(500, { error: 'Unable to confirm the credentials change' });
    }
    return json(200, { success: true, userId });
  } catch {
    return json(500, { error: 'Unable to change staff credentials. Please try again.' });
  }
});

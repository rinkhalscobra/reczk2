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
    if (!actorRole || !['admin', 'group_admin', 'supervisor', 'agent'].includes(actorRole.role)) {
      return json(403, { error: 'You are not authorized to change this password' });
    }

    let body;
    try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
    const { userId, newPassword } = body ?? {};
    if (typeof userId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId)) {
      return json(400, { error: 'A valid userId is required' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8 || !newPassword.trim()) {
      return json(400, { error: 'Password must be at least 8 characters and cannot be blank' });
    }
    if (actor.id === userId) return json(400, { error: 'Use the account recovery flow to change your own password' });

    const [profileResult, targetRoleResult] = await Promise.all([
      admin.from('profiles').select('id, group_id').eq('id', userId).maybeSingle(),
      admin.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
    ]);
    if (profileResult.error || targetRoleResult.error) return json(500, { error: 'Unable to verify the target account' });
    const target = profileResult.data;
    if (!target) return json(404, { error: 'User not found' });

    const { data: access, error: scopeError } = await admin.rpc('get_password_reset_access', {
      p_actor: actor.id, p_target: userId,
    });
    if (scopeError) return json(500, { error: 'Unable to verify your permissions' });
    if (access !== 'direct') return json(403, { error: access === 'approval'
      ? 'Approval is required to reset this password' : 'You are not authorized to change this password' });

    // The password is sent only to Supabase Auth, never to application tables or logs.
    const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
    if (updateError) return json(400, { error: updateError.message });
    if (updated?.user?.id !== userId) return json(500, { error: 'Unable to confirm the password change' });

    console.log(`Auth password changed for ${userId} by ${actor.id}`);
    return json(200, { success: true, userId });
  } catch {
    console.error('Unexpected failure in reset-user-password');
    return json(500, { error: 'Unable to change the password. Please try again.' });
  }
});

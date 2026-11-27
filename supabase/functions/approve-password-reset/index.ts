import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async req => {
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
    let body;
    try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
    const { requestId, action, newPassword } = body ?? {};
    if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId)
      || !['approve', 'reject'].includes(action)) return json(400, { error: 'A valid request and action are required' });
    if (action === 'approve' && (typeof newPassword !== 'string' || newPassword.length < 8 || !newPassword.trim())) {
      return json(400, { error: 'A new password of at least 8 characters is required for approval' });
    }
    // Claim under a database row lock before issuing an external Auth write.
    const { data: claim, error: claimError } = await admin.rpc('claim_password_reset_request', {
      p_actor: actor.id, p_request_id: requestId, p_action: action,
    });
    if (claimError) return json(claimError.code === '42501' ? 403 : claimError.code === '55000' ? 409 : 503, {
      error: claimError.code === '42501' || claimError.code === '55000' ? claimError.message : 'Unable to verify approval permissions. Please try again.',
    });
    if (!claim?.token || typeof claim.target_user_id !== 'string') return json(503, { error: 'Unable to confirm the request claim' });
    if (action === 'approve') {
      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(claim.target_user_id, { password: newPassword });
      if (updateError) {
        const release = await admin.rpc('finish_password_reset_request', { p_actor: actor.id, p_request_id: requestId, p_token: claim.token, p_success: false });
        if (release.error || release.data !== true) return json(503, { error: 'The password was not changed, but the request could not be released. Contact Superior Admin.' });
        return json(400, { error: updateError.message });
      }
      // Retain the claim when the external write has an uncertain outcome.
      if (updated?.user?.id !== claim.target_user_id) return json(503, { error: 'Unable to confirm the password change. Contact Superior Admin before retrying.' });
    }
    const { data: finished, error: finishError } = await admin.rpc('finish_password_reset_request', {
      p_actor: actor.id, p_request_id: requestId, p_token: claim.token, p_success: true,
    });
    if (finishError || finished !== true) return json(503, { error: action === 'approve'
      ? 'The password was changed, but the request status could not be saved. Contact Superior Admin.'
      : 'Unable to confirm the request status. Contact Superior Admin.' });
    return json(200, { success: true });
  } catch {
    return json(500, { error: 'Unable to process the password reset request' });
  }
});

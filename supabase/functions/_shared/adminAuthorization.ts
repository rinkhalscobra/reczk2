import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function isAdminRequest(req: Request, admin: SupabaseClient): Promise<boolean> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return false;

  const { data: role, error: roleError } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  return !roleError && role?.role === 'admin';
}

export function adminOnlyResponse(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: 'Administrator authorization required' }), {
    status: 403,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

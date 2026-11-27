import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, userId } = await req.json();
    
    console.log(`MFA check for: ${email || userId}`);

    if (!email && !userId) {
      return new Response(JSON.stringify({ error: 'Email or userId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Resolve the exact login identity, not a potentially shared contact email.
    let targetUserId = userId;
    if (!targetUserId && email) {
      const { data: foundUser, error: userError } = await supabaseAdmin
        .from('profiles').select('id').eq('login_email', String(email).trim().toLowerCase()).maybeSingle();
      if (userError) {
        console.error('User lookup error:', userError);
        throw userError;
      }
      if (!foundUser) {
        return new Response(JSON.stringify({ mfaRequired: false }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      targetUserId = foundUser.id;
    }

    // Check if user is admin or group_admin
    const { data: roleData } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', targetUserId)
      .single();

    // Only require MFA for admin and group_admin roles
    if (!roleData || (roleData.role !== 'admin' && roleData.role !== 'group_admin')) {
      return new Response(JSON.stringify({ 
        mfaRequired: false,
        isAdminRole: false 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if MFA is enabled for this user
    const { data: mfaData } = await supabaseAdmin
      .from('user_mfa')
      .select('is_enabled')
      .eq('user_id', targetUserId)
      .single();

    const mfaEnabled = mfaData?.is_enabled || false;

    console.log(`MFA check result for ${targetUserId}: isAdminRole=true, mfaEnabled=${mfaEnabled}`);

    return new Response(JSON.stringify({ 
      mfaRequired: mfaEnabled,
      isAdminRole: true,
      mfaEnabled
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('MFA check error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

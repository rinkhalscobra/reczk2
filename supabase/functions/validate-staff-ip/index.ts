import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { publicContactEmail } from '../_shared/clientAccounts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LogEntry {
  user_id: string | null;
  email: string | null;
  ipv4_address: string | null;
  ipv6_address: string | null;
  user_agent: string | null;
  action: 'ALLOWED' | 'DENIED' | 'ERROR';
  reason: string;
  matched_rule_id: string | null;
}

interface IPWhitelistRule {
  id: string;
  ip_address: string;
  action: 'ALLOW' | 'DENY';
  subject: string;
  user_id: string | null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Helper function to log validation attempt
  const logValidation = async (entry: LogEntry) => {
    try {
      await supabase.from('ip_validation_logs').insert(entry);
    } catch (err) {
      console.error('Failed to log IP validation:', err);
    }
  };

  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return new Response(
        JSON.stringify({ allowed: false, reason: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ allowed: false, reason: 'Invalid authentication token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const user_id = user.id;
    const email = publicContactEmail(user) || null;
    const forwardedIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const connectingIp = req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || forwardedIp;
    const ipsToCheck = connectingIp ? [connectingIp] : [];
    const client_ipv4 = ipsToCheck.find((ip) => ip.includes('.')) || null;
    const client_ipv6 = ipsToCheck.find((ip) => ip.includes(':')) || null;
    const user_agent = req.headers.get('user-agent');

    console.log(`Validating IP for user: ${user_id}, IPs: ${ipsToCheck.join(', ')}`);

    // Check if user has a staff role (admin, group_admin, supervisor, agent)
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user_id)
      .maybeSingle();

    if (roleError) {
      console.error('Error fetching role:', roleError);
      await logValidation({
        user_id,
        email: email || null,
        ipv4_address: client_ipv4 || null,
        ipv6_address: client_ipv6 || null,
        user_agent: user_agent || null,
        action: 'ERROR',
        reason: 'Error fetching role',
        matched_rule_id: null,
      });
      return new Response(
        JSON.stringify({ allowed: false, reason: 'Unable to verify staff role' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If no role (regular user/client), allow access - no IP restrictions (don't log regular users)
    if (!roleData) {
      console.log('User has no staff role, allowing access');
      return new Response(
        JSON.stringify({ allowed: true, reason: 'Not a staff member' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const staffRoles = ['admin', 'group_admin', 'supervisor', 'agent'];
    if (!staffRoles.includes(roleData.role)) {
      console.log('User role is not staff, allowing access');
      return new Response(
        JSON.stringify({ allowed: true, reason: 'Not a staff role' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`User is staff with role: ${roleData.role}`);

    // Get user's profile for group and email
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('group_id, email')
      .eq('id', user_id)
      .maybeSingle();

    if (profileError) {
      console.error('Error fetching profile:', profileError);
      await logValidation({
        user_id,
        email: email || null,
        ipv4_address: client_ipv4 || null,
        ipv6_address: client_ipv6 || null,
        user_agent: user_agent || null,
        action: 'ERROR',
        reason: 'Error fetching profile',
        matched_rule_id: null,
      });
      return new Response(
        JSON.stringify({ allowed: false, reason: 'Unable to verify staff profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userEmail = profile?.email || email || null;

    // Fetch global IP whitelist rules (group_id is NULL - applies to all staff)
    const { data: globalRules, error: globalRulesError } = await supabase
      .from('ip_whitelist')
      .select('*')
      .is('group_id', null);

    if (globalRulesError) {
      throw new Error(`Unable to fetch global IP rules: ${globalRulesError.message}`);
    }

    // Fetch group-specific IP whitelist rules (if user has a group)
    let groupRules: IPWhitelistRule[] = [];
    if (profile?.group_id) {
      const { data: grpRules, error: grpRulesError } = await supabase
        .from('ip_whitelist')
        .select('*')
        .eq('group_id', profile.group_id);

      if (grpRulesError) {
        throw new Error(`Unable to fetch group IP rules: ${grpRulesError.message}`);
      } else {
        groupRules = (grpRules || []) as IPWhitelistRule[];
      }
    }

    // Combine global and group-specific rules
    const rules: IPWhitelistRule[] = [
      ...((globalRules || []) as IPWhitelistRule[]),
      ...groupRules,
    ];

    // If no rules exist, allow access (no restrictions configured)
    if (rules.length === 0) {
      console.log('No IP rules configured (global or group), allowing access');
      await logValidation({
        user_id,
        email: userEmail,
        ipv4_address: client_ipv4 || null,
        ipv6_address: client_ipv6 || null,
        user_agent: user_agent || null,
        action: 'ALLOWED',
        reason: 'No IP rules configured',
        matched_rule_id: null,
      });
      return new Response(
        JSON.stringify({ allowed: true, reason: 'No IP rules configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${rules.length} IP rules for group`);

    // Check if client IP matches any rule
    // Filter rules that apply to this user (STAFF applies to all, SPECIFIC_USER must match user_id)
    const applicableRules = rules.filter(rule => {
      if (rule.subject === 'STAFF' || rule.subject === 'EVERYONE') return true;
      if (rule.subject === 'SPECIFIC_USER' && rule.user_id === user_id) return true;
      return false;
    });

    if (applicableRules.length === 0) {
      console.log('No applicable rules for this user, allowing access');
      await logValidation({
        user_id,
        email: userEmail,
        ipv4_address: client_ipv4 || null,
        ipv6_address: client_ipv6 || null,
        user_agent: user_agent || null,
        action: 'ALLOWED',
        reason: 'No applicable rules',
        matched_rule_id: null,
      });
      return new Response(
        JSON.stringify({ allowed: true, reason: 'No applicable rules' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for DENY rules first (they take precedence)
    const denyRules = applicableRules.filter(r => r.action === 'DENY');
    for (const ip of ipsToCheck) {
      for (const rule of denyRules) {
        if (matchIP(ip, rule.ip_address)) {
          console.log(`IP ${ip} matched DENY rule: ${rule.ip_address}`);
          await logValidation({
            user_id,
            email: userEmail,
            ipv4_address: client_ipv4 || null,
            ipv6_address: client_ipv6 || null,
            user_agent: user_agent || null,
            action: 'DENIED',
            reason: `IP ${ip} matched DENY rule: ${rule.ip_address}`,
            matched_rule_id: rule.id,
          });
          return new Response(
            JSON.stringify({ allowed: false, reason: 'IP address is explicitly denied' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Check ALLOW rules
    const allowRules = applicableRules.filter(r => r.action === 'ALLOW');
    
    // If there are ALLOW rules, at least one of the user's IPs must match
    if (allowRules.length > 0) {
      for (const ip of ipsToCheck) {
        for (const rule of allowRules) {
          if (matchIP(ip, rule.ip_address)) {
            console.log(`IP ${ip} matched ALLOW rule: ${rule.ip_address}`);
            await logValidation({
              user_id,
              email: userEmail,
              ipv4_address: client_ipv4 || null,
              ipv6_address: client_ipv6 || null,
              user_agent: user_agent || null,
              action: 'ALLOWED',
              reason: `IP ${ip} matched ALLOW rule: ${rule.ip_address}`,
              matched_rule_id: rule.id,
            });
            return new Response(
              JSON.stringify({ allowed: true, reason: 'IP address is allowed' }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
      }
      
      // No IP matched any ALLOW rule
      console.log(`None of the IPs (${ipsToCheck.join(', ')}) matched any ALLOW rule`);
      await logValidation({
        user_id,
        email: userEmail,
        ipv4_address: client_ipv4 || null,
        ipv6_address: client_ipv6 || null,
        user_agent: user_agent || null,
        action: 'DENIED',
        reason: `None of the IPs (${ipsToCheck.join(', ')}) matched any ALLOW rule`,
        matched_rule_id: null,
      });
      return new Response(
        JSON.stringify({ allowed: false, reason: 'IP address is not in the whitelist' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No ALLOW rules configured, allow by default
    await logValidation({
      user_id,
      email: userEmail,
      ipv4_address: client_ipv4 || null,
      ipv6_address: client_ipv6 || null,
      user_agent: user_agent || null,
      action: 'ALLOWED',
      reason: 'No ALLOW rules configured',
      matched_rule_id: null,
    });
    return new Response(
      JSON.stringify({ allowed: true, reason: 'No ALLOW rules configured' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in validate-staff-ip:', error);
    return new Response(
      JSON.stringify({ allowed: false, reason: 'IP validation failed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// Helper function to match IP addresses (supports wildcard *)
function matchIP(clientIP: string, ruleIP: string): boolean {
  if (!clientIP) return false;
  if (ruleIP === '*') return true;
  
  // Exact match
  if (clientIP === ruleIP) return true;
  
  // CIDR-style wildcard matching (e.g., 192.168.1.*)
  if (ruleIP.includes('*')) {
    const pattern = ruleIP.replace(/\./g, '\\.').replace(/\*/g, '.*');
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(clientIP);
  }
  
  return false;
}

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createCaseLoginEmail, isDuplicateEmailError, normalizeCaseNumber, isValidCaseNumber } from "../_shared/clientAccounts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create admin client with service role key
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify the requesting user is authorized
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || token === "undefined" || token === "null") {
      throw new Error("Unauthorized");
    }

    const { data: { user: requestingUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !requestingUser) {
      console.error("JWT verification failed:", authError);
      throw new Error("Unauthorized");
    }

    // Check if requesting user has permission (admin, supervisor, or agent)
    const [{ data: roleData, error: roleError }, { data: creatorProfile, error: creatorError }] = await Promise.all([
      supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", requestingUser.id)
        .single(),
      supabaseAdmin
        .from("profiles")
        .select("platform, group_id")
        .eq("id", requestingUser.id)
        .single(),
    ]);

    if (roleError || creatorError || !creatorProfile) {
      throw new Error("Could not verify user role");
    }

    const creatorPlatform = creatorProfile?.platform || "brightfund";
    const userRole = roleData?.role;
    const isAdmin = userRole === "admin";
    const isGroupAdmin = userRole === "group_admin";
    const isSupervisor = userRole === "supervisor";
    const isAgent = userRole === "agent";

    if (!isAdmin && !isGroupAdmin && !isSupervisor && !isAgent) {
      throw new Error("Only staff members can create users");
    }

    // Get request body
    const { email: rawEmail, password, firstName, lastName, username, phone, caseNumber, agentCaseCode, role, groupId, assignedTo, supervisorId } = await req.json();
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";

    if (!email || !password || !role || (!groupId && !(isAdmin && role === "user"))) {
      throw new Error("Missing required fields: email, password, role, groupId");
    }

    if (typeof password !== "string" || password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    const customAgentCode = role === 'agent' && typeof agentCaseCode === 'string' ? agentCaseCode.trim() : '';
    if (customAgentCode && !isValidCaseNumber(customAgentCode)) {
      throw new Error('Agent case number must contain 1 to 100 characters without control characters');
    }

    // Validate role permissions
    // Admins can create any role except admin through bulk
    // Group Admins can create supervisors, agents and users in their group (not admin or group_admin)
    // Supervisors can only create agents and users in their group
    // Agents can only create users assigned to themselves

    if (isAgent) {
      if (role !== "user") {
        throw new Error("Agents can only create client accounts");
      }
      if (!creatorProfile?.group_id || creatorProfile.group_id !== groupId) {
        throw new Error("Agents can only create clients in their own group");
      }
    } else if (isSupervisor) {
      if (!["agent", "user"].includes(role)) {
        throw new Error("Supervisors can only create agents or clients");
      }
      // Verify supervisor is in the same group
      if (!creatorProfile?.group_id || creatorProfile.group_id !== groupId) {
        throw new Error("Supervisors can only create users in their own group");
      }
    } else if (isGroupAdmin) {
      if (!["supervisor", "agent", "user"].includes(role)) {
        throw new Error("Group admins can only create supervisors, agents, or clients");
      }
      // Verify group admin is in the same group
      if (!creatorProfile?.group_id || creatorProfile.group_id !== groupId) {
        throw new Error("Group admins can only create users in their own group");
      }
    } else if (isAdmin) {
      if (!["group_admin", "supervisor", "agent", "user"].includes(role)) {
        throw new Error("Invalid role. Must be group_admin, supervisor, agent, or user");
      }
    }

    // Determine target platform from the group's tag (falls back to creator).
    let targetPlatform = creatorPlatform;
    const { data: targetGroup } = groupId ? await supabaseAdmin
      .from("groups")
      .select("name, platform")
      .eq("id", groupId)
      .maybeSingle() : { data: null };
    if (groupId && !targetGroup) {
      throw new Error("The selected group does not exist");
    }
    if (targetGroup?.platform) {
      targetPlatform = targetGroup.platform;
    } else if (targetGroup?.name && /^zyra/i.test(targetGroup.name)) {
      targetPlatform = "brightfund";
    }
    if (!isAdmin && targetPlatform !== creatorPlatform) throw new Error('The selected group is outside your permitted scope');

    const finalSupervisorId = role === 'agent' ? (isSupervisor ? requestingUser.id : supervisorId) : null;
    if (role === 'agent') {
      if (!finalSupervisorId) throw new Error('Select a supervisor for the new agent');
      const [supervisorProfile, supervisorRole] = await Promise.all([
        supabaseAdmin.from('profiles').select('group_id, platform').eq('id', finalSupervisorId).maybeSingle(),
        supabaseAdmin.from('user_roles').select('role').eq('user_id', finalSupervisorId).maybeSingle(),
      ]);
      if (supervisorProfile.error || supervisorRole.error || supervisorRole.data?.role !== 'supervisor'
        || supervisorProfile.data?.group_id !== groupId || supervisorProfile.data?.platform !== targetPlatform) {
        throw new Error('Select a supervisor in the selected group');
      }
    }
    if (isSupervisor && role === 'user' && !assignedTo) {
      throw new Error('Select one of your assigned agents for this client');
    }
    console.log(`Creating user: ${email} role=${role} by=${userRole} platform=${targetPlatform}`);

    let clientCaseNumber = role === "user" ? normalizeCaseNumber(caseNumber) : '';
    if (role === "user" && !clientCaseNumber) {
      const { data, error } = await supabaseAdmin.rpc('allocate_client_case_number');
      if (error || typeof data !== 'string') throw new Error('Unable to allocate a case number');
      clientCaseNumber = data;
    }
    if (clientCaseNumber && !isValidCaseNumber(clientCaseNumber)) throw new Error('Enter a valid case number of up to 100 characters');
    if (role === "user") {
      const { data: existing, error } = await supabaseAdmin.from('profiles').select('id')
        .ilike('email', email.replace(/[\\%_]/g, '\\$&')).ilike('case_number', clientCaseNumber.replace(/[\\%_]/g, '\\$&')).limit(1);
      if (error) throw new Error('Unable to verify the case number');
      if (existing?.length) throw new Error('This email and case number are already registered');
    }
    const loginEmail = role === "user" ? await createCaseLoginEmail(email, clientCaseNumber) : email;
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: loginEmail, password, email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName, platform: targetPlatform, display_email: email, case_number: clientCaseNumber || undefined },
    });

    if (createError) {
      console.error("Error creating user:", createError);
      if (isDuplicateEmailError(createError)) {
        return new Response(
          JSON.stringify({
            success: false,
            code: role === 'user' ? 'case_exists' : 'email_exists',
            error: role === 'user' ? 'This email and case number are already registered.' : 'A user with this email address already exists. Please use a different email.',
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
      throw new Error(createError.message);
    }

    if (!newUser.user) {
      throw new Error("Failed to create user");
    }

    const userId = newUser.user.id;
    console.log(`User created with ID: ${userId}`);

    // Determine who the user should be assigned to
    let finalAssignedTo = role === "user" ? assignedTo : null;
    if (isAgent && role === "user") {
      // Agents creating clients - auto-assign to themselves
      finalAssignedTo = requestingUser.id;
    }
    let finalGroupId = groupId || null;
    if (role === 'user') {
      const { data: initialProfile, error } = await supabaseAdmin.from('profiles')
        .select('assigned_to, group_id, platform, case_number').eq('id', userId).single();
      if (error || !initialProfile) {
        await supabaseAdmin.auth.admin.deleteUser(userId);
        throw new Error('Unable to verify the new client assignment');
      }
      // Keep a trusted assignment made by the signup trigger when no agent was
      // explicitly selected. The normal role/office checks below still apply.
      if (!finalAssignedTo && initialProfile.assigned_to) {
        finalAssignedTo = initialProfile.assigned_to;
        if (isAdmin && !finalGroupId) {
          finalGroupId = initialProfile.group_id;
          targetPlatform = initialProfile.platform;
        }
      }
      if (finalAssignedTo && initialProfile.assigned_to === finalAssignedTo && initialProfile.case_number) {
        clientCaseNumber = initialProfile.case_number;
      }
    }

    if (finalAssignedTo) {
      const [{ data: assigneeProfile, error: assigneeProfileError }, { data: assigneeRole, error: assigneeRoleError }] = await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("group_id, platform, supervisor_id")
          .eq("id", finalAssignedTo)
          .maybeSingle(),
        supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", finalAssignedTo)
          .maybeSingle(),
      ]);

      if (
        assigneeProfileError || assigneeRoleError || assigneeRole?.role !== "agent" || !assigneeProfile ||
        assigneeProfile.group_id !== finalGroupId || assigneeProfile.platform !== targetPlatform ||
        (isSupervisor && assigneeProfile.supervisor_id !== requestingUser.id)
      ) {
        await supabaseAdmin.auth.admin.deleteUser(userId);
        throw new Error("The assigned account must be an agent in the selected group");
      }
    }

    // Keep contact details separate from the Auth login identity.
    const { data: savedProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({
        group_id: finalGroupId,
        created_by: requestingUser.id,
        first_name: firstName,
        last_name: lastName,
        username: typeof username === "string" && username.trim() ? username.trim() : null,
        phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
        ...(clientCaseNumber ? { case_number: clientCaseNumber } : {}),
        assigned_to: finalAssignedTo || null,
        platform: targetPlatform,
        email: email,
        display_email: email,
      })
      .eq("id", userId).select('case_number').single();

    if (profileError) {
      console.error("Error updating profile:", profileError);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(`Failed to initialize user profile: ${profileError.message}`);
    }
    if (role === 'user') {
      if (typeof savedProfile?.case_number !== 'string' || !savedProfile.case_number) {
        await supabaseAdmin.auth.admin.deleteUser(userId);
        throw new Error('Unable to confirm the assigned client case number');
      }
      // The active assigned agent may have supplied the authoritative code.
      clientCaseNumber = savedProfile.case_number;
    }

    // Create the user role (skip for regular users as they have no entry in user_roles)
    if (role !== "user") {
      const { error: roleInsertError } = await supabaseAdmin
        .from("user_roles")
        .insert({
          user_id: userId,
          role: role,
        });

      if (roleInsertError) {
        console.error("Error inserting role:", roleInsertError);
        await supabaseAdmin.auth.admin.deleteUser(userId);
        throw new Error(`Failed to assign role: ${roleInsertError.message}`);
      }
    }
    if (finalSupervisorId) {
      const { error } = await supabaseAdmin.from('profiles').update({ supervisor_id: finalSupervisorId }).eq('id', userId);
      if (error) {
        await supabaseAdmin.auth.admin.deleteUser(userId);
        throw new Error('Unable to assign the new agent to the selected supervisor');
      }
    }
    if (role === 'agent' && customAgentCode) {
      const { error } = await supabaseAdmin.rpc('set_agent_case_code', { p_agent_id: userId, p_case_code: customAgentCode });
      if (error) {
        await supabaseAdmin.auth.admin.deleteUser(userId);
        throw new Error(error.message || 'Unable to set the agent case number');
      }
    }

    console.log(`User ${email} created successfully with role ${role}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        userId,
        email,
        caseNumber: clientCaseNumber || undefined,
        role,
        platform: targetPlatform,
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200 
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in create-user function:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400 
      }
    );
  }
});

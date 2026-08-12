// Admin-only: create a new app user (auth user + profile + role).
// Moved here from a TanStack Start server function so it can run without a
// Node server — the frontend is a static SPA and can't run server code itself.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { corsHeaders } from "../_shared/cors.ts";

const CreateUserInput = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  full_name: z.string().min(1).max(120),
  role: z.enum(["admin", "account_manager", "marketer"]),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Unauthorized: No authorization header provided");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the caller's JWT and identity using their own token.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) {
      throw new Error("Unauthorized: Invalid token");
    }
    const callerId = userData.user.id;

    // Service-role client for privileged operations.
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: roleRows, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (roleErr) throw new Error("Failed to verify role");
    const isAdmin = (roleRows ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    const body = await req.json();
    const data = CreateUserInput.parse(body);

    const { data: created, error: createErr } =
      await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: { full_name: data.full_name },
      });
    if (createErr || !created.user) {
      throw new Error(createErr?.message ?? "Failed to create user");
    }
    const newUserId = created.user.id;

    await supabaseAdmin.from("profiles").upsert({
      id: newUserId,
      email: data.email,
      full_name: data.full_name,
      status: "approved",
    });

    await supabaseAdmin.from("user_roles").delete().eq("user_id", newUserId);
    const { error: roleInsErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newUserId, role: data.role });
    if (roleInsErr) throw new Error("Failed to assign role");

    return new Response(JSON.stringify({ id: newUserId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Admin-only: edit or delete an existing app user. Dispatches on `action`
// in the JSON body: "update" | "delete". Mirrors admin-create-user's auth
// pattern (verify caller's own JWT, then check they hold the admin role).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { corsHeaders } from "../_shared/cors.ts";

const UpdateInput = z.object({
  action: z.literal("update"),
  user_id: z.string().uuid(),
  full_name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).max(128).optional(),
});

const DeleteInput = z.object({
  action: z.literal("delete"),
  user_id: z.string().uuid(),
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

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) {
      throw new Error("Unauthorized: Invalid token");
    }
    const callerId = userData.user.id;

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: roleRows, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (roleErr) throw new Error("Failed to verify role");
    const isAdmin = (roleRows ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    const body = await req.json();

    if (body?.action === "delete") {
      const data = DeleteInput.parse(body);
      if (data.user_id === callerId) {
        throw new Error("لا يمكنك حذف حسابك الخاص");
      }
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
      if (delErr) throw new Error(delErr.message);
      return json({ ok: true });
    }

    if (body?.action === "update") {
      const data = UpdateInput.parse(body);
      const authPatch: Record<string, unknown> = {};
      if (data.email) authPatch.email = data.email;
      if (data.password) authPatch.password = data.password;
      if (data.full_name) authPatch.user_metadata = { full_name: data.full_name };
      if (Object.keys(authPatch).length > 0) {
        const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, authPatch);
        if (updErr) throw new Error(updErr.message);
      }
      const profilePatch: Record<string, unknown> = {};
      if (data.full_name) profilePatch.full_name = data.full_name;
      if (data.email) profilePatch.email = data.email;
      if (Object.keys(profilePatch).length > 0) {
        const { error: profErr } = await supabaseAdmin
          .from("profiles")
          .update(profilePatch)
          .eq("id", data.user_id);
        if (profErr) throw new Error(profErr.message);
      }
      return json({ ok: true });
    }

    throw new Error(`Unknown action: ${body?.action}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ error: message }, 400);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Connects a Meta (Facebook) ad account to this system without OAuth.
//
// Why: Meta's OAuth login dialog only works for people who already have a
// role on our app (admin/developer/tester) unless the relevant permissions
// go through Meta's App Review for Advanced Access — a slow, uncertain
// process that still wouldn't let a non-technical marketer self-serve.
//
// Instead we use Meta's own agency pattern: the marketer shares their ad
// account with our Business Portfolio on facebook.com ("Assign Partner"),
// then tells us the account id here. We use one long-lived System User
// token (created once in our Business Manager, never per-marketer) to
// confirm the share and read performance data for every account shared
// with us this way. No OAuth, no per-account secret, no review queue.
//
// Dispatches on `action` in the JSON body: "verify_and_link" | "unlink".
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const GRAPH_VERSION = "v21.0";

/** Accepts "123...", "act_123...", or that with stray whitespace. */
function normalizeAdAccountId(raw: string): string {
  const digits = raw.trim().replace(/^act_/i, "");
  if (!/^\d+$/.test(digits)) {
    throw new Error("رقم الحساب الإعلاني غير صحيح — المفروض يكون أرقام بس (ممكن يبدأ بـ act_)");
  }
  return `act_${digits}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized: No authorization header provided");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Unauthorized: Invalid token");
    const userId = userData.user.id;

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();
    const action = body?.action as string;

    // Who's calling, and which marketer (if any) they're allowed to act for.
    // Shared by both actions below.
    const { data: roleRows } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", userId);
    const roles = new Set((roleRows ?? []).map((r: { role: string }) => r.role));
    const isStaff = roles.has("admin") || roles.has("account_manager");

    if (action === "verify_and_link") {
      const externalId = normalizeAdAccountId(body?.ad_account_id as string ?? "");

      const systemUserToken = Deno.env.get("META_SYSTEM_USER_TOKEN");
      const systemUserId = Deno.env.get("META_SYSTEM_USER_ID");
      if (!systemUserToken || !systemUserId) {
        throw new Error("إعداد الربط لسه مش مكتمل من عندنا — تواصل مع الدعم الفني.");
      }

      let ownMarketerId: string | null = null;
      if (!isStaff && roles.has("marketer")) {
        const { data: myMarketer } = await supabaseAdmin
          .from("marketers").select("id").eq("user_id", userId).maybeSingle();
        ownMarketerId = myMarketer?.id ?? null;
        if (!ownMarketerId) {
          throw new Error("حسابك لسه مش مربوط بسجل مسوّق — تواصل مع مدير الحساب.");
        }
      }

      // Confirm the account is actually reachable with our system user —
      // i.e. the marketer really did share it with our business as a partner.
      const infoUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${externalId}`);
      infoUrl.searchParams.set("fields", "id,name,currency");
      infoUrl.searchParams.set("access_token", systemUserToken);
      const infoRes = await fetch(infoUrl.toString());
      const infoJson = await infoRes.json();
      if (!infoRes.ok || infoJson.error) {
        throw new Error(
          "الحساب ده لسه مش متشارك معانا على فيسبوك — راجع خطوة \"Assign Partner\" وتأكد من رقم الحساب.",
        );
      }

      // Grant our system user read-only (ANALYZE) access on the account.
      // Idempotent: Meta no-ops or errors harmlessly if it's already granted.
      const assignUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${externalId}/assigned_users`);
      const assignRes = await fetch(assignUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          user: systemUserId,
          tasks: JSON.stringify(["ANALYZE"]),
          access_token: systemUserToken,
        }),
      });
      if (!assignRes.ok) {
        const assignJson = await assignRes.json().catch(() => ({}));
        console.error("[meta-oauth] assigned_users grant failed (continuing):", assignJson);
      }

      const { data: existing } = await supabaseAdmin
        .from("ad_accounts")
        .select("id, marketer_id")
        .eq("platform", "meta")
        .eq("external_account_id", externalId)
        .maybeSingle();

      // Never let a marketer take over an account already linked to someone else.
      if (ownMarketerId && existing?.marketer_id && existing.marketer_id !== ownMarketerId) {
        throw new Error("الحساب الإعلاني ده مربوط بالفعل بمسوّق تاني. تواصل مع مدير الحساب.");
      }

      const payload: Record<string, unknown> = {
        platform: "meta" as const,
        external_account_id: externalId,
        ad_account_id: externalId,
        account_name: infoJson.name ?? null,
        currency: infoJson.currency ?? null,
        access_status: "active",
        connection_status: "connected",
      };
      if (ownMarketerId) payload.marketer_id = ownMarketerId;

      let adAccountId: string;
      if (existing?.id) {
        const { error } = await supabaseAdmin.from("ad_accounts").update(payload).eq("id", existing.id);
        if (error) throw new Error(error.message);
        adAccountId = existing.id;
      } else {
        const { data: inserted, error } = await supabaseAdmin
          .from("ad_accounts").insert(payload).select("id").single();
        if (error) throw new Error(error.message);
        adAccountId = inserted.id;
      }

      return json({ adAccountId, accountName: infoJson.name ?? externalId });
    }

    if (action === "unlink") {
      const adAccountId = body?.ad_account_id as string;
      if (!adAccountId) throw new Error("ad_account_id is required");

      const { data: account, error: accErr } = await supabaseAdmin
        .from("ad_accounts")
        .select("id, marketer_id, external_account_id")
        .eq("id", adAccountId)
        .maybeSingle();
      if (accErr) throw new Error(accErr.message);
      if (!account) throw new Error("Ad account not found");

      let authorized = roles.has("admin");
      if (!authorized && roles.has("account_manager") && account.marketer_id) {
        const { data: marketer } = await supabaseAdmin
          .from("marketers").select("account_manager_id").eq("id", account.marketer_id).maybeSingle();
        authorized = marketer?.account_manager_id === userId;
      }
      if (!authorized && roles.has("marketer") && account.marketer_id) {
        const { data: myMarketer } = await supabaseAdmin
          .from("marketers").select("id").eq("user_id", userId).maybeSingle();
        authorized = myMarketer?.id === account.marketer_id;
      }
      if (!authorized) throw new Error("Forbidden: not authorized to disconnect this ad account");

      // Best-effort: drop our system user's access task on the account.
      // Historical campaigns/spend/insights rows are left untouched — this
      // only severs the live connection, never deletes performance data.
      const systemUserToken = Deno.env.get("META_SYSTEM_USER_TOKEN");
      const systemUserId = Deno.env.get("META_SYSTEM_USER_ID");
      if (systemUserToken && systemUserId && account.external_account_id) {
        const url = new URL(
          `https://graph.facebook.com/${GRAPH_VERSION}/${account.external_account_id}/assigned_users`,
        );
        url.searchParams.set("user", systemUserId);
        url.searchParams.set("access_token", systemUserToken);
        await fetch(url.toString(), { method: "DELETE" }).catch((e) =>
          console.error("[meta-oauth] assigned_users revoke failed (continuing):", e),
        );
      }

      const { error: updErr } = await supabaseAdmin
        .from("ad_accounts")
        .update({ connection_status: "not_connected" })
        .eq("id", adAccountId);
      if (updErr) throw new Error(updErr.message);

      return json({ ok: true });
    }

    throw new Error(`Unknown action: ${action}`);
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

// Meta (Facebook) Ads OAuth — steps 4 & 5 of the connect wizard.
// Moved here from TanStack Start server functions so it can run without a
// Node server. Dispatches on `action` in the JSON body: "start" | "list" | "link".
// The redirect step (Meta → us) lives in the separate `meta-oauth-callback`
// function, since it's a public GET the browser navigates to directly.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type MetaAccount = {
  externalId: string;
  name: string;
  currency: string;
  business: string;
  accountStatus: number | null;
};

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
    const userId = userData.user.id;

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const action = body?.action as string;

    if (action === "start") {
      const appId = Deno.env.get("META_APP_ID");
      if (!appId) throw new Error("META_APP_ID not configured");

      const state = crypto.randomUUID().replace(/-/g, "");
      const { error } = await supabaseAdmin.from("meta_oauth_sessions").insert({
        state,
        user_id: userId,
        access_token: "PENDING",
      });
      if (error) throw new Error(error.message);

      const redirectUri = `${supabaseUrl}/functions/v1/meta-oauth-callback`;
      const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
      url.searchParams.set("client_id", appId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      url.searchParams.set("response_type", "code");
      // A Facebook Login for Business config_id defines its own permission
      // set — sending `scope` alongside it makes Meta reject the request
      // ("Feature Unavailable") for anyone but the app's own admins/devs.
      const configId = Deno.env.get("META_LOGIN_CONFIG_ID");
      if (configId) {
        url.searchParams.set("config_id", configId);
      } else {
        url.searchParams.set("scope", "ads_read,business_management");
      }

      return json({ authorizeUrl: url.toString() });
    }

    if (action === "list") {
      const state = body?.state as string;
      const { data: session, error } = await supabaseAdmin
        .from("meta_oauth_sessions")
        .select("access_token, user_id")
        .eq("state", state)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!session) throw new Error("OAuth session not found or expired");
      if (session.user_id !== userId) throw new Error("Forbidden");
      if (session.access_token === "PENDING") {
        throw new Error("OAuth not completed yet");
      }

      const url = new URL("https://graph.facebook.com/v21.0/me/adaccounts");
      url.searchParams.set(
        "fields",
        "account_id,name,currency,business{name},account_status",
      );
      url.searchParams.set("access_token", session.access_token);
      url.searchParams.set("limit", "200");

      const res = await fetch(url.toString());
      const rawText = await res.text();
      let graphJson: {
        data?: Array<{
          account_id: string;
          name: string;
          currency: string;
          account_status?: number;
          business?: { name?: string };
        }>;
        error?: {
          message?: string;
          type?: string;
          code?: number;
          error_subcode?: number;
          fbtrace_id?: string;
        };
      } = {};
      try {
        graphJson = JSON.parse(rawText);
      } catch {
        /* ignore parse failure, handled by !res.ok below */
      }

      if (!res.ok || graphJson.error) {
        const err = graphJson.error ?? {};
        throw new Error(
          JSON.stringify({
            kind: "graph_error",
            status: res.status,
            message: err.message ?? "Meta API error",
            type: err.type,
            code: err.code,
            subcode: err.error_subcode,
            fbtrace_id: err.fbtrace_id,
          }),
        );
      }

      const accounts: MetaAccount[] = (graphJson.data ?? []).map((a) => ({
        externalId: `act_${a.account_id}`,
        name: a.name,
        currency: a.currency,
        business: a.business?.name ?? "—",
        accountStatus: a.account_status ?? null,
      }));

      return json({ accounts });
    }

    if (action === "link") {
      const state = body?.state as string;
      const externalId = body?.externalId as string;
      const name = body?.name as string;
      const currency = body?.currency as string;
      const business = body?.business as string;

      const { data: session, error: sErr } = await supabaseAdmin
        .from("meta_oauth_sessions")
        .select("access_token, expires_at, user_id")
        .eq("state", state)
        .maybeSingle();
      if (sErr) throw new Error(sErr.message);
      if (!session) throw new Error("OAuth session not found or expired");
      if (session.user_id !== userId) throw new Error("Forbidden");

      // Marketers linking their own account get auto-assigned to themselves;
      // admin/account_manager keep the existing behaviour of connecting the
      // raw account first and assigning it to a marketer afterwards from
      // "حسابات الإعلانات".
      const { data: roleRows } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      const roles = new Set((roleRows ?? []).map((r: { role: string }) => r.role));
      const isStaff = roles.has("admin") || roles.has("account_manager");

      let ownMarketerId: string | null = null;
      if (!isStaff && roles.has("marketer")) {
        const { data: myMarketer } = await supabaseAdmin
          .from("marketers")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();
        ownMarketerId = myMarketer?.id ?? null;
        if (!ownMarketerId) {
          throw new Error("حسابك لسه مش مربوط بسجل مسوّق — تواصل مع مدير الحساب.");
        }
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
        account_name: name,
        business_name: business,
        currency,
        access_status: "active",
        connection_status: "connected",
      };
      if (ownMarketerId) payload.marketer_id = ownMarketerId;

      let adAccountId: string;
      if (existing?.id) {
        const { error } = await supabaseAdmin
          .from("ad_accounts")
          .update(payload)
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
        adAccountId = existing.id;
      } else {
        const { data: inserted, error } = await supabaseAdmin
          .from("ad_accounts")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        adAccountId = inserted.id;
      }

      const { error: secretErr } = await supabaseAdmin
        .from("ad_account_secrets")
        .upsert({
          ad_account_id: adAccountId,
          access_token: session.access_token,
          token_expires_at: session.expires_at,
        });
      if (secretErr) throw new Error(secretErr.message);

      await supabaseAdmin.from("meta_oauth_sessions").delete().eq("state", state);

      return json({ adAccountId });
    }

    if (action === "unlink") {
      const adAccountId = body?.ad_account_id as string;
      if (!adAccountId) throw new Error("ad_account_id is required");

      const { data: account, error: accErr } = await supabaseAdmin
        .from("ad_accounts")
        .select("id, marketer_id")
        .eq("id", adAccountId)
        .maybeSingle();
      if (accErr) throw new Error(accErr.message);
      if (!account) throw new Error("Ad account not found");

      const { data: roleRows } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      const roles = new Set((roleRows ?? []).map((r: { role: string }) => r.role));
      let authorized = roles.has("admin");
      if (!authorized && roles.has("account_manager") && account.marketer_id) {
        const { data: marketer } = await supabaseAdmin
          .from("marketers")
          .select("account_manager_id")
          .eq("id", account.marketer_id)
          .maybeSingle();
        authorized = marketer?.account_manager_id === userId;
      }
      if (!authorized && roles.has("marketer") && account.marketer_id) {
        const { data: myMarketer } = await supabaseAdmin
          .from("marketers")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();
        authorized = myMarketer?.id === account.marketer_id;
      }
      if (!authorized) throw new Error("Forbidden: not authorized to disconnect this ad account");

      // Revoke our stored access token and mark the account not connected.
      // Historical campaigns/spend/insights rows are left untouched — this
      // only severs the live Meta connection, never deletes performance data.
      await supabaseAdmin.from("ad_account_secrets").delete().eq("ad_account_id", adAccountId);
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

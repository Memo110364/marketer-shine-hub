import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PUBLIC_ORIGIN = "https://marketer-shine-hub.lovable.app";
const REDIRECT_URI = `${PUBLIC_ORIGIN}/api/public/meta/callback`;
const META_SCOPE = "ads_read,business_management";

type AuthedContext = {
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
  userId: string;
};

/**
 * Only admins and account managers may manage ad account connections.
 * Roles are verified server-side with the caller's own (RLS-scoped) client,
 * never with the service-role client and never from client-supplied data.
 */
async function requireAdAccountManager(context: AuthedContext): Promise<"admin" | "account_manager"> {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (isAdmin === true) return "admin";

  const { data: isManager } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "account_manager",
  });
  if (isManager === true) return "account_manager";

  throw new Error("Forbidden: ad account connections are restricted to administrators");
}

/** Step 4: create a one-time state row and return the Meta authorize URL. */
export const startMetaOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const appId = process.env.META_APP_ID;
    if (!appId) throw new Error("META_APP_ID not configured");

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Random state stored against the current user — callback resolves the
    // token back into this row and the next server fn re-verifies the user.
    const state = crypto.randomUUID().replace(/-/g, "");
    const { error } = await supabaseAdmin.from("meta_oauth_sessions").insert({
      state,
      user_id: context.userId,
      // placeholder token until the callback exchanges the code
      access_token: "PENDING",
    });
    if (error) throw new Error(error.message);

    const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", META_SCOPE);
    const configId = process.env.META_LOGIN_CONFIG_ID;
    if (configId) url.searchParams.set("config_id", configId);

    const authorizeUrl = url.toString();
    console.log("[startMetaOAuth] authorize URL:", authorizeUrl);
    console.log(
      "[startMetaOAuth] includes config_id:",
      authorizeUrl.includes("config_id="),
    );

    return { authorizeUrl };
  });

type MetaAccount = {
  externalId: string;
  name: string;
  currency: string;
  business: string;
  accountStatus: number | null;
};

/** Step 5: using the stored token, list ad accounts available to the user. */
export const listMetaAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { state: string }) => data)
  .handler(async ({ data, context }): Promise<{ accounts: MetaAccount[] }> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: session, error } = await supabaseAdmin
      .from("meta_oauth_sessions")
      .select("access_token, user_id")
      .eq("state", data.state)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session) throw new Error("OAuth session not found or expired");
    if (session.user_id !== context.userId) throw new Error("Forbidden");
    if (session.access_token === "PENDING")
      throw new Error("OAuth not completed yet");

    const url = new URL("https://graph.facebook.com/v21.0/me/adaccounts");
    url.searchParams.set(
      "fields",
      "account_id,name,currency,business{name},account_status",
    );
    url.searchParams.set("access_token", session.access_token);
    url.searchParams.set("limit", "200");

    const debugUrl = url
      .toString()
      .replace(session.access_token, "***REDACTED***");
    console.log("[listMetaAccounts] 1. endpoint:", debugUrl);
    console.log(
      "[listMetaAccounts] token length:",
      session.access_token.length,
    );

    // 2. inspect token scopes via debug_token
    try {
      const appId = process.env.META_APP_ID;
      const appSecret = process.env.META_APP_SECRET;
      if (appId && appSecret) {
        const dbgUrl = new URL(
          "https://graph.facebook.com/v21.0/debug_token",
        );
        dbgUrl.searchParams.set("input_token", session.access_token);
        dbgUrl.searchParams.set(
          "access_token",
          `${appId}|${appSecret}`,
        );
        const dbgRes = await fetch(dbgUrl.toString());
        const dbgJson = await dbgRes.json();
        console.log(
          "[listMetaAccounts] 2. debug_token status:",
          dbgRes.status,
        );
        console.log(
          "[listMetaAccounts] 2. debug_token response:",
          JSON.stringify(dbgJson),
        );
        console.log(
          "[listMetaAccounts] 2. scopes:",
          JSON.stringify(dbgJson?.data?.scopes),
        );
        console.log(
          "[listMetaAccounts] 2. granular_scopes:",
          JSON.stringify(dbgJson?.data?.granular_scopes),
        );
      } else {
        console.log(
          "[listMetaAccounts] 2. skipped — META_APP_ID/SECRET missing",
        );
      }
    } catch (e) {
      console.log("[listMetaAccounts] 2. debug_token threw:", String(e));
    }

    // 2b. /me/permissions
    try {
      const permUrl = new URL(
        "https://graph.facebook.com/v21.0/me/permissions",
      );
      permUrl.searchParams.set("access_token", session.access_token);
      const permRes = await fetch(permUrl.toString());
      const permJson = await permRes.json();
      console.log(
        "[listMetaAccounts] 2b. /me/permissions status:",
        permRes.status,
      );
      console.log(
        "[listMetaAccounts] 2b. /me/permissions response:",
        JSON.stringify(permJson),
      );
      const missing = (permJson?.data ?? []).filter(
        (p: { status?: string }) => p.status !== "granted",
      );
      if (missing.length > 0) {
        console.log(
          "[listMetaAccounts] 2b. MISSING/DECLINED permissions:",
          JSON.stringify(missing),
        );
      }
    } catch (e) {
      console.log("[listMetaAccounts] 2b. permissions threw:", String(e));
    }

    const res = await fetch(url.toString());
    const rawText = await res.text();
    console.log("[listMetaAccounts] 5. response status:", res.status);
    console.log("[listMetaAccounts] 3. raw response:", rawText);

    let json: {
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
      json = JSON.parse(rawText);
    } catch (e) {
      console.log("[listMetaAccounts] JSON parse error:", String(e));
    }
    console.log("[listMetaAccounts] 4. full JSON:", JSON.stringify(json));

    if (json.error) {
      console.log(
        "[listMetaAccounts] 6. Graph API error:",
        JSON.stringify(json.error),
      );
    }

    const accountsArr = json.data ?? [];
    console.log(
      "[listMetaAccounts] 7. number of ad accounts:",
      accountsArr.length,
    );
    if (accountsArr.length === 0) {
      console.log(
        "[listMetaAccounts] EMPTY data array. Full Meta response:",
        JSON.stringify(json),
      );
    }

    if (!res.ok || json.error) {
      const err = json.error ?? {};
      // Throw a JSON-encoded message so the client can parse structured
      // Graph error details and show a friendly Arabic message + specifics.
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

    return {
      accounts: accountsArr.map((a) => ({
        externalId: `act_${a.account_id}`,
        name: a.name,
        currency: a.currency,
        business: a.business?.name ?? "—",
        accountStatus: a.account_status ?? null,
      })),
    };
  });

/** Step 6: persist the chosen account into ad_accounts and clear the session. */
export const linkMetaAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      state: string;
      externalId: string;
      name: string;
      currency: string;
      business: string;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: session, error: sErr } = await supabaseAdmin
      .from("meta_oauth_sessions")
      .select("access_token, expires_at, user_id")
      .eq("state", data.state)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!session) throw new Error("OAuth session not found or expired");
    if (session.user_id !== context.userId) throw new Error("Forbidden");

    // Find existing row keyed by external id, or insert a new one.
    const { data: existing } = await supabaseAdmin
      .from("ad_accounts")
      .select("id")
      .eq("platform", "meta")
      .eq("external_account_id", data.externalId)
      .maybeSingle();

    const payload = {
      platform: "meta" as const,
      external_account_id: data.externalId,
      ad_account_id: data.externalId,
      account_name: data.name,
      business_name: data.business,
      currency: data.currency,
      access_status: "active",
      connection_status: "connected",
    };

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

    // Store sensitive OAuth token in the admin-only secrets table.
    const { error: secretErr } = await supabaseAdmin
      .from("ad_account_secrets")
      .upsert({
        ad_account_id: adAccountId,
        access_token: session.access_token,
        token_expires_at: session.expires_at,
      });
    if (secretErr) throw new Error(secretErr.message);

    // Consume the state row so it cannot be replayed.
    await supabaseAdmin
      .from("meta_oauth_sessions")
      .delete()
      .eq("state", data.state);

    return { adAccountId };
  });

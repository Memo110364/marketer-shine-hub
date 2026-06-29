import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PUBLIC_ORIGIN = "https://marketer-shine-hub.lovable.app";
const REDIRECT_URI = `${PUBLIC_ORIGIN}/api/public/meta/callback`;
const META_SCOPE = "ads_read,business_management";

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
    url.searchParams.set("scope", META_SCOPE);
    url.searchParams.set("response_type", "code");

    return { authorizeUrl: url.toString() };
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

    const res = await fetch(url.toString());
    const json = (await res.json()) as {
      data?: Array<{
        account_id: string;
        name: string;
        currency: string;
        account_status?: number;
        business?: { name?: string };
      }>;
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(json.error?.message ?? "Meta API error");

    return {
      accounts: (json.data ?? []).map((a) => ({
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
      access_token: session.access_token,
      token_expires_at: session.expires_at,
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

    // Consume the state row so it cannot be replayed.
    await supabaseAdmin
      .from("meta_oauth_sessions")
      .delete()
      .eq("state", data.state);

    return { adAccountId };
  });

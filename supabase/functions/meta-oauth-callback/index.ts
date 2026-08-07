// Meta OAuth redirect target — Meta sends the user's browser here directly
// (no Authorization header), so this function must allow unauthenticated
// requests (verify_jwt = false in supabase/config.toml).
//
// Register this EXACT URL in Meta Developers → Facebook Login for Business →
// Settings → Valid OAuth Redirect URIs:
//   https://<PROJECT_REF>.supabase.co/functions/v1/meta-oauth-callback
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  const errorReason = url.searchParams.get("error_reason");
  const errorCode = url.searchParams.get("error_code");

  // The frontend's own origin — the SPA the user actually sees.
  const appOrigin = Deno.env.get("PUBLIC_APP_ORIGIN");
  if (!appOrigin) {
    return new Response("Server not configured: PUBLIC_APP_ORIGIN missing", {
      status: 500,
    });
  }

  const fail = (
    msg: string,
    extra: Record<string, string | null | undefined> = {},
  ) => {
    const params = new URLSearchParams();
    params.set("step", "4");
    params.set("meta_error", msg);
    if (errorDescription) params.set("meta_error_description", errorDescription);
    if (errorReason) params.set("meta_error_reason", errorReason);
    if (errorCode) params.set("meta_error_code", errorCode);
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
    }
    return Response.redirect(
      `${appOrigin}/ad-accounts/connect-meta?${params.toString()}`,
      302,
    );
  };

  if (error) return fail(error, {});
  if (!code) return fail("missing_code");

  const appId = Deno.env.get("META_APP_ID");
  const appSecret = Deno.env.get("META_APP_SECRET");
  if (!appId || !appSecret) return fail("server_not_configured");

  const redirectUri = `${url.protocol}//${url.host}/functions/v1/meta-oauth-callback`;

  // 1) Exchange code → short-lived user access token
  const tokenUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);

  const tokenRes = await fetch(tokenUrl.toString());
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    error?: {
      message?: string;
      type?: string;
      code?: number;
      error_subcode?: number;
      fbtrace_id?: string;
    };
  };
  if (!tokenRes.ok || !tokenJson.access_token) {
    return fail(tokenJson.error?.message || "token_exchange_failed", {
      meta_error_type: tokenJson.error?.type,
      meta_error_code: tokenJson.error?.code ? String(tokenJson.error.code) : undefined,
      meta_error_subcode: tokenJson.error?.error_subcode
        ? String(tokenJson.error.error_subcode)
        : undefined,
      meta_fbtrace_id: tokenJson.error?.fbtrace_id,
    });
  }

  // 2) Upgrade to long-lived token (~60 days)
  const longUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", appId);
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("fb_exchange_token", tokenJson.access_token);

  const longRes = await fetch(longUrl.toString());
  const longJson = (await longRes.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  const accessToken = longJson.access_token ?? tokenJson.access_token;
  const expiresAt = longJson.expires_in
    ? new Date(Date.now() + longJson.expires_in * 1000).toISOString()
    : null;

  // 3) Save the long-lived token against the state row created when the
  //    wizard kicked off OAuth. The next call reads it back.
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error: updateErr } = await supabaseAdmin
    .from("meta_oauth_sessions")
    .update({ access_token: accessToken, expires_at: expiresAt })
    .eq("state", state);
  if (updateErr) return fail(updateErr.message);

  await supabaseAdmin.from("integration_sync_logs").insert({
    platform: "meta",
    status: "success",
    error_message: `oauth_callback ok expires_at=${expiresAt ?? "n/a"}`,
  });

  // 4) Hand off to the connect wizard to pick which ad account to link.
  return Response.redirect(
    `${appOrigin}/ad-accounts/connect-meta?step=5&state=${encodeURIComponent(state)}`,
    302,
  );
});

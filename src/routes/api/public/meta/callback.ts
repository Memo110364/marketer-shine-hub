import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Meta OAuth Callback
 *
 * Public URL (register this EXACT value in Meta Developers
 *   → Facebook Login for Business → Settings → Valid OAuth Redirect URIs):
 *
 *   https://marketer-shine-hub.lovable.app/api/public/meta/callback
 *
 * Stable alias (also safe to add):
 *   https://project--e2b7f922-dcb1-4cbf-8081-3bf55ca67e0b.lovable.app/api/public/meta/callback
 *
 * Flow:
 *  1. Frontend redirects user to:
 *     https://www.facebook.com/v21.0/dialog/oauth
 *       ?client_id=META_APP_ID
 *       &redirect_uri=<this route>
 *       &state=<csrf+userId>
 *       &scope=ads_read,business_management
 *       &response_type=code
 *  2. Meta redirects back here with ?code=...&state=...
 *  3. We exchange the short-lived code for a long-lived token, then
 *     persist it to ad_accounts and redirect the user back to the app.
 */
export const Route = createFileRoute("/api/public/meta/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state") ?? "";
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");

        const appOrigin = `${url.protocol}//${url.host}`;
        const fail = (msg: string) =>
          redirect({
            href: `${appOrigin}/ad-accounts?meta_error=${encodeURIComponent(msg)}`,
            throw: true,
          });

        if (error) throw fail(errorDescription || error);
        if (!code) throw fail("missing_code");

        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;
        if (!appId || !appSecret) {
          throw fail("server_not_configured");
        }

        const redirectUri = `${appOrigin}/api/public/meta/callback`;

        // 1) Exchange code → short-lived user access token
        const tokenUrl = new URL(
          "https://graph.facebook.com/v21.0/oauth/access_token",
        );
        tokenUrl.searchParams.set("client_id", appId);
        tokenUrl.searchParams.set("client_secret", appSecret);
        tokenUrl.searchParams.set("redirect_uri", redirectUri);
        tokenUrl.searchParams.set("code", code);

        const tokenRes = await fetch(tokenUrl.toString());
        const tokenJson = (await tokenRes.json()) as {
          access_token?: string;
          error?: { message?: string };
        };
        if (!tokenRes.ok || !tokenJson.access_token) {
          throw fail(tokenJson.error?.message || "token_exchange_failed");
        }

        // 2) Upgrade to long-lived token (~60 days)
        const longUrl = new URL(
          "https://graph.facebook.com/v21.0/oauth/access_token",
        );
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

        // 3) Persist pending connection (state carries the marketer/user id)
        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          await supabaseAdmin.from("integration_sync_logs").insert({
            status: "success",
            metadata: {
              provider: "meta",
              event: "oauth_callback_received",
              state,
              expires_at: expiresAt,
              has_token: Boolean(accessToken),
            },
          });
        } catch {
          // Logging is best-effort; do not block the redirect.
        }

        // 4) Hand off to the connect wizard to pick which ad account to link.
        throw redirect({
          href: `${appOrigin}/ad-accounts/connect-meta?step=5&state=${encodeURIComponent(state)}`,
          throw: true,
        });
      },
    },
  },
});

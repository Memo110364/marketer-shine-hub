// Pulls campaign-level performance from the Meta Marketing API for one
// already-connected ad account: the campaign list (name/objective/status/
// budget) plus a daily insights breakdown (spend/impressions/clicks/
// results) for a trailing window. Upserts into ad_campaigns /
// ad_campaign_insights_daily and logs the run into integration_sync_logs,
// mirroring the shape meta-oauth already uses for the connect wizard.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const GRAPH_VERSION = "v21.0";
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

// Ranked by how close the action type is to "a real customer showed
// interest", for businesses with no pixel/CAPI (phone/WhatsApp orders).
// Meta reports whichever of these actually applies to the campaign's
// objective — we just pick the most meaningful one that's present.
const RESULT_PRIORITY = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.messaging_first_reply",
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "link_click",
];

type GraphAction = { action_type: string; value: string };
type GraphCampaign = {
  id: string;
  name: string;
  objective?: string;
  status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
};
type GraphInsightRow = {
  campaign_id: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  ctr?: string;
  actions?: GraphAction[];
  cost_per_action_type?: GraphAction[];
};

function pickPrimaryResult(actions: GraphAction[] | undefined, costs: GraphAction[] | undefined) {
  if (!actions || actions.length === 0) return { type: null, count: null, cost: null };
  let chosen = RESULT_PRIORITY.map((t) => actions.find((a) => a.action_type === t)).find(Boolean);
  if (!chosen) chosen = actions[0];
  const count = Number(chosen.value) || 0;
  const costEntry = costs?.find((c) => c.action_type === chosen!.action_type);
  const cost = costEntry ? Number(costEntry.value) || null : null;
  return { type: chosen.action_type, count, cost };
}

type GraphResponse = {
  data?: GraphCampaign[] | GraphInsightRow[];
  paging?: { next?: string };
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

async function fetchGraph(url: URL): Promise<GraphResponse> {
  const res = await fetch(url.toString());
  const rawText = await res.text();
  let json: GraphResponse = {};
  try {
    json = JSON.parse(rawText);
  } catch {
    /* handled by !res.ok below */
  }
  if (!res.ok || json.error) {
    const err = json.error ?? {};
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
  return json;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  let logId: string | null = null;
  let adAccountId: string | null = null;
  let marketerId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized: No authorization header provided");

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Unauthorized: Invalid token");
    const userId = userData.user.id;

    const body = await req.json();
    adAccountId = body?.ad_account_id as string;
    const days = Math.min(Math.max(Number(body?.days) || DEFAULT_DAYS, 1), MAX_DAYS);
    if (!adAccountId) throw new Error("ad_account_id is required");

    const { data: account, error: accErr } = await supabaseAdmin
      .from("ad_accounts")
      .select("id, marketer_id, platform, external_account_id, connection_status, currency")
      .eq("id", adAccountId)
      .maybeSingle();
    if (accErr) throw new Error(accErr.message);
    if (!account) throw new Error("Ad account not found");
    if (account.platform !== "meta")
      throw new Error("Only Meta accounts are supported by this sync");
    if (!account.external_account_id)
      throw new Error("This account has no linked Meta ad account id");
    marketerId = account.marketer_id;

    // Authorization: admin, or the account manager who owns this marketer.
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    let authorized = roleSet.has("admin");
    if (!authorized && roleSet.has("account_manager") && account.marketer_id) {
      const { data: marketer } = await supabaseAdmin
        .from("marketers")
        .select("account_manager_id")
        .eq("id", account.marketer_id)
        .maybeSingle();
      authorized = marketer?.account_manager_id === userId;
    }
    if (!authorized) throw new Error("Forbidden: not authorized to sync this ad account");

    const { data: secret, error: secretErr } = await supabaseAdmin
      .from("ad_account_secrets")
      .select("access_token, token_expires_at")
      .eq("ad_account_id", adAccountId)
      .maybeSingle();
    if (secretErr) throw new Error(secretErr.message);
    if (!secret?.access_token)
      throw new Error("No access token stored for this ad account — reconnect it");
    if (secret.token_expires_at && new Date(secret.token_expires_at) < new Date()) {
      await supabaseAdmin
        .from("ad_accounts")
        .update({ connection_status: "expired" })
        .eq("id", adAccountId);
      throw new Error("Access token expired — reconnect this ad account");
    }

    const { data: logRow, error: logErr } = await supabaseAdmin
      .from("integration_sync_logs")
      .insert({
        platform: "meta",
        ad_account_id: adAccountId,
        marketer_id: account.marketer_id,
        status: "running",
      })
      .select("id")
      .single();
    if (logErr) throw new Error(logErr.message);
    logId = logRow.id;

    const accessToken = secret.access_token as string;
    const externalAccountId = account.external_account_id as string;

    // 1) Campaign registry
    const campaignsUrl = new URL(
      `https://graph.facebook.com/${GRAPH_VERSION}/${externalAccountId}/campaigns`,
    );
    campaignsUrl.searchParams.set(
      "fields",
      "id,name,objective,status,daily_budget,lifetime_budget",
    );
    campaignsUrl.searchParams.set("access_token", accessToken);
    campaignsUrl.searchParams.set("limit", "500");
    const campaignsJson = await fetchGraph(campaignsUrl);
    const campaigns = (campaignsJson.data ?? []) as GraphCampaign[];

    let campaignsUpserted = 0;
    const campaignIdByExternal = new Map<string, string>();
    for (const c of campaigns) {
      const { data: row, error } = await supabaseAdmin
        .from("ad_campaigns")
        .upsert(
          {
            ad_account_id: adAccountId,
            marketer_id: account.marketer_id,
            platform: "meta",
            external_campaign_id: c.id,
            name: c.name,
            objective: c.objective ?? null,
            status: c.status ?? null,
            daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
            lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
            currency: account.currency ?? "EGP",
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "ad_account_id,external_campaign_id" },
        )
        .select("id, external_campaign_id")
        .single();
      if (error) throw new Error(error.message);
      campaignIdByExternal.set(row.external_campaign_id, row.id);
      campaignsUpserted++;
    }

    // 2) Daily insights for the trailing window
    const until = new Date();
    const since = new Date(until.getTime() - (days - 1) * 86400 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const insightsUrl = new URL(
      `https://graph.facebook.com/${GRAPH_VERSION}/${externalAccountId}/insights`,
    );
    insightsUrl.searchParams.set("level", "campaign");
    insightsUrl.searchParams.set("time_increment", "1");
    insightsUrl.searchParams.set(
      "time_range",
      JSON.stringify({ since: fmt(since), until: fmt(until) }),
    );
    insightsUrl.searchParams.set(
      "fields",
      "campaign_id,spend,impressions,clicks,reach,ctr,actions,cost_per_action_type",
    );
    insightsUrl.searchParams.set("access_token", accessToken);
    insightsUrl.searchParams.set("limit", "500");

    let insightRows: GraphInsightRow[] = [];
    let nextUrl: string | null = insightsUrl.toString();
    while (nextUrl) {
      const page = await fetchGraph(new URL(nextUrl));
      insightRows = insightRows.concat((page.data ?? []) as GraphInsightRow[]);
      nextUrl = page.paging?.next ?? null;
    }

    let insightsUpserted = 0;
    for (const row of insightRows) {
      const campaignId = campaignIdByExternal.get(row.campaign_id);
      if (!campaignId) continue; // campaign not in current active list (rare edge case)
      const result = pickPrimaryResult(row.actions, row.cost_per_action_type);
      const { error } = await supabaseAdmin.from("ad_campaign_insights_daily").upsert(
        {
          campaign_id: campaignId,
          marketer_id: account.marketer_id,
          insight_date: row.date_start,
          spend_amount: Number(row.spend) || 0,
          impressions: Number(row.impressions) || 0,
          clicks: Number(row.clicks) || 0,
          reach: Number(row.reach) || 0,
          ctr: row.ctr ? Number(row.ctr) : null,
          results_breakdown: row.actions ?? null,
          primary_result_type: result.type,
          primary_result_count: result.count,
          cost_per_result: result.cost,
          currency: account.currency ?? "EGP",
          source: "meta_api",
          synced_at: new Date().toISOString(),
        },
        { onConflict: "campaign_id,insight_date,source" },
      );
      if (error) throw new Error(error.message);
      insightsUpserted++;
    }

    await supabaseAdmin
      .from("ad_accounts")
      .update({ last_sync_at: new Date().toISOString(), connection_status: "connected" })
      .eq("id", adAccountId);

    await supabaseAdmin
      .from("integration_sync_logs")
      .update({
        status: "success",
        sync_finished_at: new Date().toISOString(),
        records_created: campaignsUpserted + insightsUpserted,
        records_updated: 0,
      })
      .eq("id", logId);

    return json({
      campaigns: campaignsUpserted,
      insightRows: insightsUpserted,
      since: fmt(since),
      until: fmt(until),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (logId) {
      await supabaseAdmin
        .from("integration_sync_logs")
        .update({
          status: "error",
          sync_finished_at: new Date().toISOString(),
          error_message: message,
        })
        .eq("id", logId);
    } else if (adAccountId) {
      await supabaseAdmin.from("integration_sync_logs").insert({
        platform: "meta",
        ad_account_id: adAccountId,
        marketer_id: marketerId,
        status: "error",
        sync_finished_at: new Date().toISOString(),
        error_message: message,
      });
    }
    return json({ error: message }, 400);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

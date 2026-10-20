// Scheduled companion to meta-insights-sync: pulls fresh Meta performance
// data for every connected ad account automatically, so marketers never
// have to wait on an admin/account_manager to click "مزامنة الآن".
// Triggered only by our own pg_cron job (CRON_SECRET), never by a client —
// verify_jwt is off at the gateway since a plain secret isn't a Supabase JWT.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GRAPH_VERSION = "v21.0";
// Routine runs only need a short trailing window — the first sync right
// after linking (or an admin's manual "مزامنة الآن") already pulls 30 days
// of history; this just keeps the last week's numbers current.
const SYNC_DAYS = 7;

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

type AdAccountRow = {
  id: string;
  marketer_id: string | null;
  platform: string;
  external_account_id: string | null;
  connection_status: string;
  currency: string | null;
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

// deno-lint-ignore no-explicit-any
async function syncOneAccount(supabaseAdmin: any, account: AdAccountRow, accessToken: string) {
  const { data: logRow, error: logErr } = await supabaseAdmin
    .from("integration_sync_logs")
    .insert({ platform: "meta", ad_account_id: account.id, marketer_id: account.marketer_id, status: "running" })
    .select("id")
    .single();
  if (logErr) throw new Error(logErr.message);
  const logId = logRow.id;

  try {
    const externalAccountId = account.external_account_id as string;

    const campaignsUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${externalAccountId}/campaigns`);
    campaignsUrl.searchParams.set("fields", "id,name,objective,status,daily_budget,lifetime_budget");
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
            ad_account_id: account.id,
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

    const until = new Date();
    const since = new Date(until.getTime() - (SYNC_DAYS - 1) * 86400 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const insightsUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${externalAccountId}/insights`);
    insightsUrl.searchParams.set("level", "campaign");
    insightsUrl.searchParams.set("time_increment", "1");
    insightsUrl.searchParams.set("time_range", JSON.stringify({ since: fmt(since), until: fmt(until) }));
    insightsUrl.searchParams.set("fields", "campaign_id,spend,impressions,clicks,reach,ctr,actions,cost_per_action_type");
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
      if (!campaignId) continue;
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

    let spendDaysUpserted = 0;
    if (account.marketer_id) {
      const spendByDate = new Map<string, number>();
      for (const row of insightRows) {
        const amt = Number(row.spend) || 0;
        spendByDate.set(row.date_start, (spendByDate.get(row.date_start) ?? 0) + amt);
      }
      for (const [date, spend] of spendByDate) {
        const { error } = await supabaseAdmin.from("ad_spend_daily").upsert(
          {
            marketer_id: account.marketer_id,
            ad_account_id: account.id,
            platform: "meta",
            spend_date: date,
            spend_amount: spend,
            currency: account.currency ?? "EGP",
            source: "meta_api",
            sync_status: "ok",
          },
          { onConflict: "ad_account_id,spend_date,source" },
        );
        if (error) throw new Error(error.message);
        spendDaysUpserted++;
      }
    }

    await supabaseAdmin
      .from("ad_accounts")
      .update({ last_sync_at: new Date().toISOString(), connection_status: "connected" })
      .eq("id", account.id);

    await supabaseAdmin
      .from("integration_sync_logs")
      .update({
        status: "success",
        sync_finished_at: new Date().toISOString(),
        records_created: campaignsUpserted + insightsUpserted + spendDaysUpserted,
        records_updated: 0,
      })
      .eq("id", logId);

    return { campaigns: campaignsUpserted, insightRows: insightsUpserted, spendDays: spendDaysUpserted };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await supabaseAdmin
      .from("integration_sync_logs")
      .update({ status: "error", sync_finished_at: new Date().toISOString(), error_message: message })
      .eq("id", logId);
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!cronSecret || callerToken !== cronSecret) {
      throw new Error("Unauthorized");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // One shared System User token reads every connected account — see
    // meta-oauth's "verify_and_link" action for how an account gets shared.
    const systemUserToken = Deno.env.get("META_SYSTEM_USER_TOKEN");
    if (!systemUserToken) throw new Error("META_SYSTEM_USER_TOKEN not configured");

    const { data: accounts, error } = await supabaseAdmin
      .from("ad_accounts")
      .select("id, marketer_id, platform, external_account_id, connection_status, currency")
      .eq("platform", "meta")
      .eq("connection_status", "connected")
      .not("external_account_id", "is", null);
    if (error) throw new Error(error.message);

    const results: Array<{ ad_account_id: string; ok: boolean; detail: unknown }> = [];
    for (const account of (accounts ?? []) as AdAccountRow[]) {
      try {
        const r = await syncOneAccount(supabaseAdmin, account, systemUserToken);
        results.push({ ad_account_id: account.id, ok: true, detail: r });
      } catch (e) {
        results.push({ ad_account_id: account.id, ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
    }

    return json({ accountsSynced: results.length, results });
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

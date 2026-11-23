// Sends the ad spend recorded here to the shipping-audit system
// (audit.angazny.com), which used to be fed by exporting a spreadsheet and
// uploading it there by hand.
//
// It drains public.ad_spend_sync_queue, which the triggers in
// 20261123100000_sync_ad_spend_to_audit_system.sql fill whenever a spend
// record is added, edited or deleted (or a marketer is renamed), posts a
// batch to the audit system's /api/ad-spend/sync, and writes back what that
// system answered for each record. Nothing is ever sent twice as a new line:
// each record is identified over there by its id here, so a re-send updates
// the same line.
//
// Called by our own pg_cron job (CRON_SECRET) and by the "طلب مزامنة"
// button, which runs as the signed-in admin or account manager — so
// verify_jwt stays off at the gateway and both are checked here.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// The audit side refuses more than 500 records in one post.
const BATCH = 500;

// How many batches one run drains, so the first run after this is
// installed can clear a whole backlog without anyone pressing again, while
// a run still finishes well inside the function's time.
const MAX_BATCHES = 10;

// PostgREST takes the ids in the query string, and a few hundred UUIDs
// overflow the URL, so every `in` list goes over in slices this size.
const IDS_PER_REQUEST = 50;

/** @returns the list cut into slices of at most `size`. */
function slices<T>(items: T[], size = IDS_PER_REQUEST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }

  return out;
}

/** A thrown PostgREST error is a plain object, which String() turns into nothing readable. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return error !== null && typeof error === "object" ? JSON.stringify(error) : String(error);
}

// What the audit system answers for a record, and what it means for the
// queue row. A record it refuses stays visible with its reason rather than
// being retried forever.
const OUTCOMES: Record<string, { status: "sent" | "skipped" | "failed"; note?: string }> = {
  created: { status: "sent" },
  updated: { status: "sent" },
  adopted: { status: "sent" },
  deleted: { status: "sent" },
  missing: { status: "skipped", note: "مش موجود هناك أصلاً" },
  before_start: { status: "skipped", note: "قبل بداية التشغيل في نظام المراجعة" },
  month_closed: { status: "failed", note: "الشهر مقفول في نظام المراجعة" },
};

type QueueRow = {
  transaction_id: string;
  op: "upsert" | "delete";
};

type SpendRow = {
  id: string;
  amount: number | string;
  fawry_code: string | null;
  transaction_date: string;
  spend_type: string;

  marketers: { name: string | null; marketer_code: string | null } | null;
};

// Shown as "نوع الصرف" on the audit side, so it reads the same there.
const SPEND_TYPE_LABELS: Record<string, string> = {
  meta_ads: "إعلانات ميتا",
  tiktok_ads: "إعلانات تيك توك",
  easy_order: "Easy Order",
  test_ads: "إعلانات تيست",
  salary: "مرتب",
  other: "أخرى",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auditUrl = Deno.env.get("AUDIT_SYNC_URL");
  const auditToken = Deno.env.get("AUDIT_SYNC_TOKEN");
  const cronSecret = Deno.env.get("CRON_SECRET");

  const callerToken = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Either our own cron job, or a signed-in admin / account manager.
  let allowed = Boolean(cronSecret) && callerToken === cronSecret;

  if (!allowed && callerToken) {
    const { data: caller } = await admin.auth.getUser(callerToken);
    if (caller?.user) {
      const { data: roles } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", caller.user.id);
      allowed = (roles ?? []).some((r) => r.role === "admin" || r.role === "account_manager");
    }
  }

  if (!allowed) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!auditUrl || !auditToken) {
    return json({ error: "AUDIT_SYNC_URL / AUDIT_SYNC_TOKEN غير مضبوطين" }, 500);
  }

  try {
    const counts: Record<string, number> = {};
    let queuedTotal = 0;
    let sent = 0;
    let more = false;

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const { data: queued, error: queueError } = await admin
        .from("ad_spend_sync_queue")
        .select("transaction_id, op")
        .eq("status", "pending")
        .order("queued_at", { ascending: true })
        .limit(BATCH);

      if (queueError) throw queueError;

      const rows = (queued ?? []) as QueueRow[];
      if (rows.length === 0) break;

      queuedTotal += rows.length;
      const upsertIds = rows.filter((r) => r.op === "upsert").map((r) => r.transaction_id);

      const spend: SpendRow[] = [];

      for (const ids of slices(upsertIds)) {
        const { data, error } = await admin
          .from("ad_spend_transactions")
          .select("id, amount, fawry_code, transaction_date, spend_type, marketers(name, marketer_code)")
          .in("id", ids);

        if (error) throw error;

        spend.push(...((data ?? []) as unknown as SpendRow[]));
      }

      const byId = new Map(spend.map((row) => [row.id, row]));

      const records = rows.map((row) => {
        const record = byId.get(row.transaction_id);

        // Queued as an edit but gone since (deleted while it waited): the
        // audit system is told to drop it too.
        if (row.op === "delete" || !record) {
          return { external_id: row.transaction_id, deleted: true };
        }

        return {
          external_id: record.id,
          marketer_code: record.marketers?.marketer_code ?? null,
          marketer_name: record.marketers?.name ?? null,
          spent_on: record.transaction_date,
          kind: SPEND_TYPE_LABELS[record.spend_type] ?? record.spend_type,
          amount: String(record.amount),
          fawry_code: record.fawry_code,
        };
      });

      const response = await fetch(`${auditUrl.replace(/\/$/, "")}/api/ad-spend/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${auditToken}`,
        },
        body: JSON.stringify({ records }),
      });

      const text = await response.text();

      if (!response.ok) {
        // The whole batch was refused: each row keeps its reason, and the
        // run stops rather than hammering a system that is down.
        const reason = `نظام المراجعة رد بـ ${response.status}: ${text.slice(0, 300)}`;

        for (const ids of slices(rows.map((r) => r.transaction_id))) {
          await admin
            .from("ad_spend_sync_queue")
            .update({ status: "failed", last_error: reason })
            .in("transaction_id", ids);
        }

        return json({ error: reason, queued: queuedTotal, sent, counts }, 502);
      }

      const results: Record<string, string> = JSON.parse(text).results ?? {};
      const now = new Date().toISOString();

      // One update per outcome rather than per row, so a full re-send of
      // thousands of records is a handful of statements.
      const byOutcome = new Map<string, string[]>();
      for (const row of rows) {
        const outcome = results[row.transaction_id] ?? "no_answer";
        counts[outcome] = (counts[outcome] ?? 0) + 1;
        byOutcome.set(outcome, [...(byOutcome.get(outcome) ?? []), row.transaction_id]);
      }

      for (const [outcome, all] of byOutcome) {
        const known = OUTCOMES[outcome] ?? { status: "failed" as const, note: `رد مش مفهوم: ${outcome}` };

        for (const ids of slices(all)) {
          const { error } = await admin
            .from("ad_spend_sync_queue")
            .update({
              status: known.status,
              last_error: known.note ?? null,
              synced_at: known.status === "failed" ? null : now,
            })
            .in("transaction_id", ids);

          if (error) throw error;
        }

        if (known.status !== "failed") sent += all.length;
      }

      // A short batch means the queue is drained; a full one may not be.
      more = rows.length === BATCH;
      if (!more) break;
    }

    return json({ queued: queuedTotal, sent, counts, more });
  } catch (error) {
    console.error("audit-ad-spend-sync failed", error);

    return json({ error: describe(error) }, 500);
  }
});

// Daily ops digest — one Telegram message per active marketer, posted to a
// single admin/account-manager group. Summarizes month-to-date spend,
// commission, top products, delivery status and an end-of-month projection,
// plus two advisory flags (spend > commission; manual vs Meta-synced spend
// mismatch). This is a read-only reporting job: it never writes to any
// financial or bonus table, and deliberately duplicates the bonus engine's
// "performance ad spend" arithmetic (funding - test spend) rather than
// calling load_bonus_month_inputs, which requires a real admin/account-
// manager JWT (auth.uid()) that a cron-triggered service-role call doesn't
// have.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const DELIVERED_STATUSES = ["delivered", "done"];
const RETURNED_STATUSES = ["refunded", "refund_request"];
const COMMISSION_EXCLUDED_STATUSES = ["refunded", "refund_request", "cancelled"];
const RECONCILE_TOLERANCE = 0.15;

type ParsedItem = { quantity: number; base_product_name: string };

// Ported 1:1 from src/lib/parse-product.ts — keep in sync if that changes.
function parseProductField(raw: unknown): ParsedItem[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  const segments = text.split("|").map((s) => s.trim()).filter(Boolean);
  return segments.map((seg) => {
    let quantity = 1;
    let rest = seg;
    const qMatch = rest.match(/^\s*(\d+)\s*[*x×]\s*(.*)$/i);
    if (qMatch) {
      quantity = Math.max(1, parseInt(qMatch[1], 10) || 1);
      rest = qMatch[2];
    }
    const bracket = rest.match(/^(.*?)\[([^\]]*)\]\s*$/);
    const baseName = (bracket ? bracket[1] : rest).trim();
    return { quantity, base_product_name: baseName || seg };
  });
}

const TEST_RESULT_LABELS: Record<string, string> = {
  in_progress: "جاري الاختبار",
  successful: "ناجح",
  promising: "واعد",
  weak: "ضعيف",
  discontinued: "متوقف",
};

function fmtMoney(n: number): string {
  return Math.round(n).toLocaleString("en-US") + " ج.م";
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // verify_jwt only checks the Authorization header is SOME validly signed
    // Supabase JWT — the public anon key (baked into the frontend bundle)
    // satisfies that. This function reads every marketer's financial data
    // and can send real Telegram messages, so it must additionally require
    // a second, independent shared secret that only our own cron job knows
    // — a plain custom secret rather than the project's service-role key,
    // so there's no ambiguity between Supabase's legacy/new key formats.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!cronSecret || callerToken !== cronSecret) {
      return json({ error: "Forbidden: cron access only" }, 403);
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
    if (!botToken || !chatId) {
      throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured");
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run !== false; // default true — must opt OUT explicitly to actually send
    const asOf: string = body?.as_of_date || new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const [y, m, d] = asOf.split("-").map(Number);
    const periodStart = `${y}-${String(m).padStart(2, "0")}-01`;
    const periodEnd = asOf;
    const totalDaysInMonth = daysInMonth(y, m);
    const daysElapsed = Math.max(d, 1);

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: marketers, error: mErr } = await supabaseAdmin
      .from("marketers")
      .select("id, name, marketer_code")
      .eq("status", "active")
      .order("name");
    if (mErr) throw new Error(mErr.message);

    const messages: { marketer: string; text: string }[] = [];

    for (const mk of marketers ?? []) {
      const { data: orders, error: oErr } = await supabaseAdmin
        .from("orders")
        .select("status, commission, raw_data")
        .eq("marketer_id", mk.id)
        .gte("order_date", periodStart)
        .lte("order_date", periodEnd);
      if (oErr) throw new Error(oErr.message);

      let inDelivery = 0, delivered = 0, returned = 0, commission = 0;
      const productQty = new Map<string, number>();
      for (const o of orders ?? []) {
        const status = o.status as string;
        if (status === "in_delivery") inDelivery++;
        if (DELIVERED_STATUSES.includes(status)) delivered++;
        if (RETURNED_STATUSES.includes(status)) returned++;
        if (DELIVERED_STATUSES.includes(status)) commission += Number(o.commission || 0);
        if (!COMMISSION_EXCLUDED_STATUSES.includes(status)) {
          for (const item of parseProductField((o.raw_data as any)?.Products)) {
            productQty.set(
              item.base_product_name,
              (productQty.get(item.base_product_name) ?? 0) + item.quantity,
            );
          }
        }
      }
      const topProducts = Array.from(productQty.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      const { data: spendTx, error: sErr } = await supabaseAdmin
        .from("ad_spend_transactions")
        .select("amount, spend_type")
        .eq("marketer_id", mk.id)
        .gte("transaction_date", periodStart)
        .lte("transaction_date", periodEnd);
      if (sErr) throw new Error(sErr.message);
      let funding = 0, metaFunding = 0;
      for (const t of spendTx ?? []) {
        const amt = Number(t.amount || 0);
        if (t.spend_type === "meta_ads" || t.spend_type === "tiktok_ads") funding += amt;
        if (t.spend_type === "meta_ads") metaFunding += amt;
      }

      const { data: testEntries, error: tErr } = await supabaseAdmin
        .from("test_spend_entries")
        .select("amount")
        .eq("marketer_id", mk.id)
        .gte("test_date", periodStart)
        .lte("test_date", periodEnd);
      if (tErr) throw new Error(tErr.message);
      const testSpend = (testEntries ?? []).reduce((s, t) => s + Number(t.amount || 0), 0);
      const performanceAdSpend = Math.max(funding - testSpend, 0);

      const { data: metaSynced, error: msErr } = await supabaseAdmin
        .from("ad_spend_daily")
        .select("spend_amount")
        .eq("marketer_id", mk.id)
        .eq("source", "meta_api")
        .gte("spend_date", periodStart)
        .lte("spend_date", periodEnd);
      if (msErr) throw new Error(msErr.message);
      const metaSyncedTotal = (metaSynced ?? []).reduce((s, r) => s + Number(r.spend_amount || 0), 0);

      let reconcileFlag: string | null = null;
      if (metaSyncedTotal > 0) {
        const diffPct = Math.abs(metaFunding - metaSyncedTotal) / metaSyncedTotal;
        if (diffPct > RECONCILE_TOLERANCE) {
          reconcileFlag =
            `⚠️ مطابقة Meta: المحفظة ${fmtMoney(metaFunding)} مقابل الفعلي من Meta ${fmtMoney(metaSyncedTotal)} ` +
            `(فرق ${Math.round(diffPct * 100)}%)`;
        }
      }

      const { data: lastTest } = await supabaseAdmin
        .from("test_spend_entries")
        .select("product_name, result, test_date")
        .eq("marketer_id", mk.id)
        .order("test_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      let lastProductLine: string;
      if (lastTest?.product_name) {
        const label = TEST_RESULT_LABELS[lastTest.result ?? ""] ?? lastTest.result ?? "—";
        lastProductLine = `🧪 تيست "${lastTest.product_name}" — ${label}`;
      } else {
        const { data: lastOrder } = await supabaseAdmin
          .from("orders")
          .select("raw_data")
          .eq("marketer_id", mk.id)
          .order("order_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        const items = parseProductField((lastOrder?.raw_data as any)?.Products);
        lastProductLine = items[0]?.base_product_name ?? "—";
      }

      const projectedCommission = (commission / daysElapsed) * totalDaysInMonth;
      const projectedSpend = (performanceAdSpend / daysElapsed) * totalDaysInMonth;
      const projectedProfit = projectedCommission - projectedSpend;

      const lines: string[] = [];
      lines.push(`📊 *تقرير يومي — ${mk.name}* (كود: ${mk.marketer_code})`);
      lines.push(`📅 من ${periodStart} حتى ${periodEnd}`);
      lines.push("");
      lines.push(`💰 الصرف من بداية الشهر: ${fmtMoney(performanceAdSpend)}`);
      lines.push(`✅ العمولة المحققة: ${fmtMoney(commission)}`);
      if (performanceAdSpend > commission) {
        lines.push(`⚠️ تنبيه: الصرف أكبر من العمولة من بداية الشهر`);
      }
      if (reconcileFlag) lines.push(reconcileFlag);
      lines.push("");
      lines.push(`🏆 أهم ${topProducts.length || 0} منتجات:`);
      if (topProducts.length === 0) {
        lines.push("—");
      } else {
        topProducts.forEach(([name, qty], i) => lines.push(`${i + 1}. ${name} — ${qty} قطعة`));
      }
      lines.push("");
      lines.push(`🆕 آخر منتج اشتغل عليه: ${lastProductLine}`);
      lines.push("");
      lines.push(`📦 الطلبات هذا الشهر:`);
      lines.push(`• في الشحن: ${inDelivery}`);
      lines.push(`• اتسلمت: ${delivered}`);
      lines.push(`• مرتجع: ${returned}`);
      lines.push("");
      const sign = projectedProfit >= 0 ? "مكسب" : "خسارة";
      lines.push(`📉 توقع نهاية الشهر: ${sign} متوقع ≈ ${fmtMoney(Math.abs(projectedProfit))}`);
      lines.push(`(بناءً على نفس المعدل الحالي، مُسقَط على باقي أيام الشهر)`);

      messages.push({ marketer: mk.name, text: lines.join("\n") });
    }

    if (!dryRun) {
      for (const msg of messages) {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: msg.text, parse_mode: "Markdown" }),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Telegram send failed for ${msg.marketer}: ${errText}`);
        }
      }
    }

    return json({ dry_run: dryRun, as_of_date: asOf, marketers_count: messages.length, messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ error: message }, 400);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

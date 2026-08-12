import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/KpiCard";
import { fmtCurrency, fmtDate, fmtNumber, fmtPercent } from "@/lib/format";
import { fetchAll } from "@/lib/fetch-all";
import { DELIVERED_STATUSES } from "@/lib/constants";
import { invokeFn } from "@/lib/edge-functions";
import type { Database } from "@/integrations/supabase/types";
import {
  ArrowRight,
  Wallet,
  Trophy,
  Megaphone,
  RefreshCw,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/marketers/$id_/ad-performance")({
  component: AdPerformancePage,
});

const RESULT_TYPE_LABELS: Record<string, string> = {
  "onsite_conversion.messaging_conversation_started_7d": "محادثات واتساب/مسنجر",
  "onsite_conversion.messaging_first_reply": "أول رد في المحادثة",
  lead: "بيانات تواصل (Lead)",
  "onsite_conversion.lead_grouped": "بيانات تواصل (Lead)",
  "offsite_conversion.fb_pixel_lead": "بيانات تواصل (Pixel)",
  purchase: "عمليات شراء",
  "offsite_conversion.fb_pixel_purchase": "عمليات شراء (Pixel)",
  link_click: "نقرات على الرابط",
};

const STATUS_LABELS: Record<string, { label: string; tone: "success" | "warning" | "secondary" }> =
  {
    ACTIVE: { label: "نشطة", tone: "success" },
    PAUSED: { label: "متوقفة", tone: "warning" },
    DELETED: { label: "محذوفة", tone: "secondary" },
    ARCHIVED: { label: "مؤرشفة", tone: "secondary" },
  };

const RANGE_OPTIONS = [
  { value: "7", label: "آخر ٧ أيام" },
  { value: "30", label: "آخر ٣٠ يوم" },
  { value: "90", label: "آخر ٩٠ يوم" },
];

function AdPerformancePage() {
  const { id } = Route.useParams();
  const { role } = useAuth();
  const qc = useQueryClient();
  const canSync = role === "admin" || role === "account_manager";
  const [rangeDays, setRangeDays] = useState("30");

  const { data: m } = useQuery({
    queryKey: ["marketer", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketers")
        .select("id, name, marketer_code")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["marketer-ad-accounts", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("ad_accounts")
        .select("*")
        .eq("marketer_id", id)
        .eq("platform", "meta")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { from, to } = useMemo(() => {
    const days = Number(rangeDays);
    const toD = new Date();
    const fromD = new Date(toD.getTime() - (days - 1) * 86400 * 1000);
    return { from: fromD.toISOString().slice(0, 10), to: toD.toISOString().slice(0, 10) };
  }, [rangeDays]);

  const { data: campaigns = [] } = useQuery({
    queryKey: ["marketer-campaigns", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("ad_campaigns")
        .select("*")
        .eq("marketer_id", id)
        .order("name");
      return data ?? [];
    },
  });

  type InsightRow = Database["public"]["Tables"]["ad_campaign_insights_daily"]["Row"];
  const { data: insights = [] } = useQuery({
    queryKey: ["marketer-campaign-insights", id, from, to],
    queryFn: () =>
      fetchAll<InsightRow>((a, b) =>
        supabase
          .from("ad_campaign_insights_daily")
          .select("*")
          .eq("marketer_id", id)
          .gte("insight_date", from)
          .lte("insight_date", to)
          .range(a, b),
      ),
  });

  type CampaignOrderRow = { id: string; campaign_id: string | null; status: string };
  const { data: campaignOrders = [] } = useQuery({
    queryKey: ["marketer-campaign-orders", id, from, to],
    queryFn: () =>
      fetchAll<CampaignOrderRow>((a, b) =>
        supabase
          .from("orders")
          .select("id, campaign_id, status")
          .eq("marketer_id", id)
          .not("campaign_id", "is", null)
          .in("status", DELIVERED_STATUSES)
          .gte("order_date", from)
          .lte("order_date", to)
          .range(a, b),
      ),
  });

  const { data: allOrdersCount } = useQuery({
    queryKey: ["marketer-orders-count", id, from, to],
    queryFn: async () => {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("marketer_id", id)
        .in("status", DELIVERED_STATUSES)
        .gte("order_date", from)
        .lte("order_date", to);
      return count ?? 0;
    },
  });

  const sync = useMutation({
    mutationFn: async (adAccountId: string) =>
      invokeFn<{ campaigns: number; insightRows: number }>("meta-insights-sync", {
        ad_account_id: adAccountId,
        days: Number(rangeDays),
      }),
    onSuccess: (data) => {
      toast.success(`تمت المزامنة — ${data.campaigns} حملة، ${data.insightRows} صف أداء`);
      qc.invalidateQueries({ queryKey: ["marketer-campaigns", id] });
      qc.invalidateQueries({ queryKey: ["marketer-campaign-insights", id] });
      qc.invalidateQueries({ queryKey: ["marketer-ad-accounts", id] });
    },
    onError: (error: unknown) => {
      const e = error as { message?: string } | null;
      toast.error("تعذرت المزامنة", { description: e?.message ?? String(error) });
    },
  });

  const insightsByCampaign = useMemo(() => {
    const map = new Map<
      string,
      {
        spend: number;
        impressions: number;
        clicks: number;
        resultCount: number;
        resultType: string | null;
      }
    >();
    for (const row of insights) {
      const cur = map.get(row.campaign_id) ?? {
        spend: 0,
        impressions: 0,
        clicks: 0,
        resultCount: 0,
        resultType: null as string | null,
      };
      cur.spend += Number(row.spend_amount ?? 0);
      cur.impressions += Number(row.impressions ?? 0);
      cur.clicks += Number(row.clicks ?? 0);
      if (row.primary_result_count != null) {
        cur.resultCount += Number(row.primary_result_count);
        cur.resultType = row.primary_result_type ?? cur.resultType;
      }
      map.set(row.campaign_id, cur);
    }
    return map;
  }, [insights]);

  const ordersByCampaign = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of campaignOrders) {
      if (!o.campaign_id) continue;
      map.set(o.campaign_id, (map.get(o.campaign_id) ?? 0) + 1);
    }
    return map;
  }, [campaignOrders]);

  const totals = useMemo(() => {
    let spend = 0;
    for (const v of insightsByCampaign.values()) spend += v.spend;
    const taggedOrders = campaignOrders.length;
    return { spend, taggedOrders, allOrders: allOrdersCount ?? 0 };
  }, [insightsByCampaign, campaignOrders, allOrdersCount]);

  const lastSync = accounts
    .map((a) => a.last_sync_at)
    .filter(Boolean)
    .sort()
    .reverse()[0];

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2">
          <Link to="/marketers/$id" params={{ id }}>
            <ArrowRight className="h-4 w-4 ml-1" /> رجوع للمسوق
          </Link>
        </Button>
        <h2 className="text-2xl font-display font-bold">أداء الإعلانات — {m?.name ?? ""}</h2>
        <div className="text-sm text-muted-foreground mt-1">{m?.marketer_code}</div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <Link to="/marketers/$id/expenses" params={{ id }}>
            <Wallet className="h-4 w-4 ml-1" /> المصروفات
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/marketers/$id/bonus" params={{ id }}>
            <Trophy className="h-4 w-4 ml-1" /> البونص والمستحقات
          </Link>
        </Button>
        <Button asChild>
          <Link to="/marketers/$id/ad-performance" params={{ id }}>
            <Megaphone className="h-4 w-4 ml-1" /> أداء الإعلانات
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label>الفترة</Label>
            <Select value={rangeDays} onValueChange={setRangeDays}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">آخر مزامنة</div>
            <div className="text-sm">{lastSync ? fmtDate(lastSync as string) : "—"}</div>
          </div>
          {canSync && (
            <div className="mr-auto flex flex-wrap items-center gap-2">
              {accounts.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  لا يوجد حساب Meta مربوط بهذا المسوّق
                </span>
              ) : (
                accounts.map((a) => (
                  <Button
                    key={a.id}
                    size="sm"
                    variant="outline"
                    onClick={() => sync.mutate(a.id)}
                    disabled={sync.isPending || a.connection_status !== "connected"}
                    title={
                      a.connection_status !== "connected" ? "الحساب يحتاج إعادة ربط" : undefined
                    }
                  >
                    {sync.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 ml-1 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 ml-1" />
                    )}
                    مزامنة الآن — {a.account_name ?? a.external_account_id}
                  </Button>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard
          label="إجمالي الصرف الفعلي (من ميتا)"
          value={fmtCurrency(totals.spend)}
          icon={Wallet}
        />
        <KpiCard label="عدد الحملات" value={fmtNumber(campaigns.length)} icon={Megaphone} />
        <KpiCard
          label="طلبات مربوطة بحملة محددة"
          value={`${fmtNumber(totals.taggedOrders)} / ${fmtNumber(totals.allOrders)}`}
          icon={Trophy}
          hint="من إجمالي طلبات المسوّق المسلّمة في نفس الفترة"
        />
        <KpiCard
          label="متوسط تكلفة الطلب (تقريبي)"
          value={totals.allOrders > 0 ? fmtCurrency(totals.spend / totals.allOrders) : "—"}
          icon={Wallet}
          tone="info"
          hint="إجمالي الصرف ÷ إجمالي الطلبات المسلّمة (كل الحملات)"
        />
      </div>

      {totals.taggedOrders < totals.allOrders && totals.allOrders > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-warning-foreground" />
          <div>
            {fmtNumber(totals.allOrders - totals.taggedOrders)} من الطلبات في هذه الفترة غير مربوطة
            بحملة محددة — التكلفة لكل طلب في الجدول تحتها معروضة على مستوى المسوّق ككل لحد ما يتم
            تحديد الحملة وقت الاستيراد.
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">الحملات</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الحملة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الصرف</TableHead>
                <TableHead>الوصول</TableHead>
                <TableHead>النقرات</TableHead>
                <TableHead>النتائج</TableHead>
                <TableHead>تكلفة النتيجة</TableHead>
                <TableHead>طلبات مربوطة</TableHead>
                <TableHead>متوسط تكلفة الطلب</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    لا توجد حملات مزامَنة بعد — اضغط "مزامنة الآن" لو الحساب متصل
                  </TableCell>
                </TableRow>
              ) : (
                campaigns.map((c) => {
                  const ins = insightsByCampaign.get(c.id);
                  const orders = ordersByCampaign.get(c.id) ?? 0;
                  const status = STATUS_LABELS[c.status ?? ""] ?? {
                    label: c.status ?? "—",
                    tone: "secondary" as const,
                  };
                  const costPerResult =
                    ins && ins.resultCount > 0 ? ins.spend / ins.resultCount : null;
                  const costPerOrder = orders > 0 ? (ins?.spend ?? 0) / orders : null;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            status.tone === "success"
                              ? "bg-success/15 text-success border-success/30"
                              : status.tone === "warning"
                                ? "bg-warning/15 text-warning-foreground border-warning/30"
                                : ""
                          }
                        >
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmtCurrency(ins?.spend ?? 0)}</TableCell>
                      <TableCell>{fmtNumber(ins?.impressions ?? 0)}</TableCell>
                      <TableCell>{fmtNumber(ins?.clicks ?? 0)}</TableCell>
                      <TableCell>
                        {ins && ins.resultCount > 0
                          ? `${fmtNumber(ins.resultCount)} — ${RESULT_TYPE_LABELS[ins.resultType ?? ""] ?? ins.resultType}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {costPerResult != null ? fmtCurrency(costPerResult) : "—"}
                      </TableCell>
                      <TableCell>{fmtNumber(orders)}</TableCell>
                      <TableCell className={costPerOrder != null ? "text-success font-medium" : ""}>
                        {costPerOrder != null ? fmtCurrency(costPerOrder) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

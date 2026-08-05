import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { KpiCard } from "@/components/KpiCard";
import { DashboardBonusSection } from "@/components/bonus/DashboardBonusSection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ShoppingBag, Clock, Truck, CheckCircle2, XCircle, AlertTriangle,
  TrendingUp, TrendingDown, Wallet, DollarSign, Percent, CalendarDays, Trophy, AlertOctagon, Sparkles,
} from "lucide-react";
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/format";
import { ORDER_STATUS, ORDER_STATUS_KEYS, type OrderStatus } from "@/lib/constants";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

// Shapes returned by the get_dashboard_* RPCs (supabase/migrations) — the
// aggregation (SUM/COUNT per status/day/marketer) happens in Postgres now;
// everything below this line is unchanged display/ratio logic.
type DashboardCounts = {
  pending: number; cancelled: number; in_delivery: number;
  delivered: number; done: number; refunded: number; refund_request: number;
};
type DashboardSummary = {
  total: number;
  total_pieces: number;
  delivered_pieces: number;
  gross_profit: number;
  delivered_commissions: number;
  in_delivery_commissions: number;
  ad_spend: number;
  counts: DashboardCounts;
};
type DailyRow = {
  day: string;
  total: number;
  delivered: number;
  refunded: number;
  commissions: number;
  spend: number;
};
type MarketerBreakdownRow = {
  marketer_id: string;
  orders: number;
  delivered: number;
  refunded: number;
  gross: number;
  spend: number;
  commissions: number;
};

const EMPTY_SUMMARY: DashboardSummary = {
  total: 0, total_pieces: 0, delivered_pieces: 0, gross_profit: 0,
  delivered_commissions: 0, in_delivery_commissions: 0, ad_spend: 0,
  counts: { pending: 0, cancelled: 0, in_delivery: 0, delivered: 0, done: 0, refunded: 0, refund_request: 0 },
};

function daysBetween(from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function shiftRange(from: string, to: string): { from: string; to: string } {
  const days = daysBetween(from, to);
  const prevTo = new Date(new Date(from).getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}

/** "new" marks a period that went from zero to non-zero — not a real % change. */
function growth(curr: number, prev: number): number | "new" {
  if (prev === 0) return curr === 0 ? 0 : "new";
  return (curr - prev) / Math.abs(prev);
}

function growthSortValue(g: number | "new"): number {
  return g === "new" ? Infinity : g;
}

function DashboardPage() {
  const { role } = useAuth();
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(monthStart.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [marketerF, setMarketerF] = useState<string>("all");
  const [productF, setProductF] = useState<string>("all");
  const [shippingF, setShippingF] = useState<string>("all");
  const [statusF, setStatusF] = useState<string>("all");

  const prev = useMemo(() => shiftRange(from, to), [from, to]);
  const numDays = useMemo(() => daysBetween(from, to), [from, to]);

  // Lookups
  const { data: marketers = [] } = useQuery({
    queryKey: ["marketers-min"],
    queryFn: async () => {
      const { data } = await supabase.from("marketers").select("id, name, marketer_code");
      return data ?? [];
    },
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products-min"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id, name");
      return data ?? [];
    },
  });
  const { data: shippingCos = [] } = useQuery({
    queryKey: ["shipping-min"],
    queryFn: async () => {
      const { data } = await supabase.from("shipping_companies").select("id, name");
      return data ?? [];
    },
  });

  // "all" (the UI sentinel) becomes NULL for the RPCs below, i.e. no filter.
  const marketerParam = marketerF === "all" ? null : marketerF;
  const productParam = productF === "all" ? null : productF;
  const shippingParam = shippingF === "all" ? null : shippingF;
  const statusParam = statusF === "all" ? null : statusF;
  const rpcArgs = (rangeFrom: string, rangeTo: string) => ({
    _from: rangeFrom,
    _to: rangeTo,
    _marketer_id: marketerParam,
    _product_id: productParam,
    _shipping_company_id: shippingParam,
    _status: statusParam,
  });

  // Current + previous period summaries (single aggregated row each — the
  // SUM/COUNT work that used to happen in the browser over every order and
  // ad-spend row now happens in Postgres; see get_dashboard_summary).
  const { data: summary } = useQuery({
    queryKey: ["dash-summary", from, to, marketerParam, productParam, shippingParam, statusParam],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_dashboard_summary", rpcArgs(from, to));
      if (error) throw error;
      return data as DashboardSummary;
    },
  });
  const { data: summaryPrev } = useQuery({
    queryKey: ["dash-summary-prev", prev.from, prev.to, marketerParam, productParam, shippingParam, statusParam],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_dashboard_summary", rpcArgs(prev.from, prev.to));
      if (error) throw error;
      return data as DashboardSummary;
    },
  });
  const s = summary ?? EMPTY_SUMMARY;
  const sp = summaryPrev ?? EMPTY_SUMMARY;

  // One row per day in range (for the line chart + best/worst-day cards).
  const { data: dailyRows = [] } = useQuery({
    queryKey: ["dash-daily", from, to, marketerParam, productParam, shippingParam, statusParam],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_dashboard_daily_series", rpcArgs(from, to));
      if (error) throw error;
      return (data ?? []) as DailyRow[];
    },
  });

  // One row per marketer for current + previous period (for the per-marketer
  // table and the growth badges).
  const { data: marketerBreakdown = [] } = useQuery({
    queryKey: ["dash-marketers", from, to, marketerParam, productParam, shippingParam, statusParam],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_dashboard_marketer_breakdown", rpcArgs(from, to));
      if (error) throw error;
      return (data ?? []) as MarketerBreakdownRow[];
    },
  });
  const { data: marketerBreakdownPrev = [] } = useQuery({
    queryKey: ["dash-marketers-prev", prev.from, prev.to, marketerParam, productParam, shippingParam, statusParam],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_dashboard_marketer_breakdown", rpcArgs(prev.from, prev.to));
      if (error) throw error;
      return (data ?? []) as MarketerBreakdownRow[];
    },
  });

  // Basic aggregates (same formulas as before, now reading the aggregated row)
  const counts = s.counts;
  const total = s.total;
  const grossProfit = Number(s.gross_profit || 0);
  const deliveredCommissions = Number(s.delivered_commissions || 0);
  const adSpend = Number(s.ad_spend || 0);
  const netProfit = deliveredCommissions - adSpend;
  const delivered = (counts.delivered ?? 0) + (counts.done ?? 0);
  const refunded = (counts.refunded ?? 0) + (counts.refund_request ?? 0);
  const shippedCount =
    (counts.in_delivery ?? 0) + (counts.delivered ?? 0) + (counts.done ?? 0) +
    (counts.refund_request ?? 0) + (counts.refunded ?? 0);
  const cancelledCount = counts.cancelled ?? 0;
  const pendingCount = counts.pending ?? 0;
  const deliveryRateOfTotal = total > 0 ? delivered / total : 0;
  const deliveryRateOfShipped = shippedCount > 0 ? delivered / shippedCount : 0;
  const deliveryRate = deliveryRateOfTotal;
  // Refund rate is calculated against shipped orders (refunds can only come from shipped flow)
  const refundRate = shippedCount > 0 ? refunded / shippedCount : 0;
  const cancellationRate = total > 0 ? cancelledCount / total : 0;
  const confirmationRate = total > 0 ? shippedCount / total : 0;
  const avgAdCostPerShipped = shippedCount > 0 ? adSpend / shippedCount : 0;
  const realCpa = delivered > 0 ? adSpend / delivered : 0;
  const profitPerDelivered = delivered > 0 ? deliveredCommissions / delivered : 0;
  const totalPieces = Number(s.total_pieces || 0);
  const avgPiecesPerOrder = total > 0 ? totalPieces / total : 0;
  const deliveredPieces = Number(s.delivered_pieces || 0);
  const inDeliveryCommissions = Number(s.in_delivery_commissions || 0);
  // Expected profit = commissions from in_delivery + delivered + done (per spec)
  const expectedProfit = deliveredCommissions + inDeliveryCommissions;
  const prevTotal = sp.total;
  const performanceTrend = growth(total, prevTotal);

  // Previous period aggregates for comparison
  const prevDeliveredCount = (sp.counts.delivered ?? 0) + (sp.counts.done ?? 0);
  const prevDeliveredCommissions = Number(sp.delivered_commissions || 0);
  const prevAdSpend = Number(sp.ad_spend || 0);
  const prevNet = prevDeliveredCommissions - prevAdSpend;
  const prevDeliveryRate = prevTotal > 0 ? prevDeliveredCount / prevTotal : 0;

  // Daily series — one row per day already comes back from the RPC.
  const dailySeries = useMemo(() => dailyRows.map((r) => {
    const commissions = Number(r.commissions || 0);
    const spend = Number(r.spend || 0);
    return {
      date: r.day,
      total: Number(r.total || 0),
      delivered: Number(r.delivered || 0),
      refunded: Number(r.refunded || 0),
      commissions,
      spend,
      net: commissions - spend,
    };
  }), [dailyRows]);

  // Daily averages
  const avgDailyOrders = total / numDays;
  const avgDailyDelivered = delivered / numDays;
  const avgDailyNet = netProfit / numDays;
  const avgDailyAdSpend = adSpend / numDays;

  // Performance overview
  const overview = useMemo(() => {
    if (dailySeries.length === 0) return null;
    const best = dailySeries.reduce((a, b) => (b.total > a.total ? b : a));
    const worst = dailySeries.reduce((a, b) => (b.total < a.total ? b : a));
    const bestRate = dailySeries
      .filter((d) => d.total > 0)
      .reduce<{ date: string; rate: number } | null>((acc, d) => {
        const r = d.delivered / d.total;
        return !acc || r > acc.rate ? { date: d.date, rate: r } : acc;
      }, null);
    const bestProfit = dailySeries.reduce((a, b) => (b.net > a.net ? b : a));
    return { best, worst, bestRate, bestProfit };
  }, [dailySeries]);

  // Marketer table with current vs previous — one row per marketer already
  // comes aggregated from get_dashboard_marketer_breakdown; only the current
  // period's marketers are listed (matches the previous client-side reduce,
  // which only ever iterated the "current" map).
  const marketerRows = useMemo(() => {
    const prevById = new Map(marketerBreakdownPrev.map((r) => [r.marketer_id, r]));
    return marketerBreakdown.map((r) => {
      const p = prevById.get(r.marketer_id);
      const orders = Number(r.orders || 0);
      const delivered = Number(r.delivered || 0);
      const gross = Number(r.gross || 0);
      const spend = Number(r.spend || 0);
      const commissions = Number(r.commissions || 0);
      const net = commissions - spend;
      const prevOrders = Number(p?.orders || 0);
      const prevCommissions = Number(p?.commissions || 0);
      const prevSpend = Number(p?.spend || 0);
      const prevNetM = prevCommissions - prevSpend;
      return {
        id: r.marketer_id,
        name: marketers.find((m) => m.id === r.marketer_id)?.name ?? "—",
        orders,
        delivered,
        refundRate: orders > 0 ? Number(r.refunded || 0) / orders : 0,
        gross,
        spend,
        net,
        avgOrders: orders / numDays,
        avgDelivered: delivered / numDays,
        avgNet: net / numDays,
        growth: growth(orders, prevOrders),
        netGrowth: growth(net, prevNetM),
      };
    }).sort((a, b) => b.orders - a.orders);
  }, [marketerBreakdown, marketerBreakdownPrev, marketers, numDays]);

  const topGrowing = useMemo(() =>
    [...marketerRows].filter((m) => m.orders > 0)
      .sort((a, b) => growthSortValue(b.growth) - growthSortValue(a.growth))
      .slice(0, 5),
  [marketerRows]);

  const pieData = ORDER_STATUS_KEYS.map((k) => ({
    name: ORDER_STATUS[k].label,
    value: counts[k],
  })).filter((d) => d.value > 0);
  const pieColors = ["var(--info)", "var(--warning)", "var(--success)", "var(--chart-2)", "var(--destructive)", "var(--chart-5)"];

  const topMarketers = marketerRows.slice(0, 5).map((m) => ({ name: m.name, orders: m.orders }));

  // Tooltip formatter for daily chart
  const dailyTooltip = (value: unknown, name: unknown): string => {
    if (name === "صافي الربح") return fmtCurrency(Number(value ?? 0));
    return fmtNumber(Number(value ?? 0));
  };

  function GrowthBadge({ value }: { value: number | "new" }) {
    if (value === "new") {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--info)]">
          <Sparkles className="h-3.5 w-3.5" />
          جديد
        </span>
      );
    }
    const up = value >= 0;
    const Icon = up ? TrendingUp : TrendingDown;
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-medium ${up ? "text-[var(--success)]" : "text-[var(--destructive)]"}`}>
        <Icon className="h-3.5 w-3.5" />
        {fmtPercent(Math.abs(value))}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-display font-bold">لوحة التحكم</h2>
          <p className="text-sm text-muted-foreground">
            {role === "marketer" ? "نظرة على أدائك الشخصي" : "تحليلات الأداء اليومي والمقارنة بالفترة السابقة"}
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <Label className="text-xs">من</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">إلى</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">المسوّق</Label>
            <Select value={marketerF} onValueChange={setMarketerF}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {marketers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">المنتج</Label>
            <Select value={productF} onValueChange={setProductF}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">شركة الشحن</Label>
            <Select value={shippingF} onValueChange={setShippingF}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {shippingCos.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">حالة الطلب</Label>
            <Select value={statusF} onValueChange={setStatusF}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {ORDER_STATUS_KEYS.map((k) => <SelectItem key={k} value={k}>{ORDER_STATUS[k as OrderStatus].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* SECTION 1 — Executive KPIs */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-display font-bold">المؤشرات التنفيذية</h3>
          <div className="flex-1 h-px bg-border" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <ExecKpi label="إجمالي الطلبات" value={fmtNumber(total)} icon={ShoppingBag} tone="default" />
          <ExecKpi label="طلبات جديدة (لم تُلغَ)" value={fmtNumber(pendingCount)} icon={Clock} tone="info"
            sub={total > 0 ? `${fmtPercent(pendingCount / total)} من الإجمالي` : undefined} />
          <ExecKpi label="ملغاة قبل الشحن" value={fmtNumber(cancelledCount)} icon={XCircle} tone="destructive"
            sub={`نسبة الإلغاء: ${fmtPercent(cancellationRate)}`} />
          <ExecKpi label="خرج للشحن" value={fmtNumber(shippedCount)} icon={Truck} tone="info"
            sub={`نسبة التأكيد: ${fmtPercent(confirmationRate)}`} />
        </div>
      </section>

      {/* SECTION 2 — Operational KPIs */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-display font-bold text-muted-foreground">المؤشرات التشغيلية</h3>
          <div className="flex-1 h-px bg-border" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MidKpi label="تم التسليم" value={fmtNumber(delivered)} icon={CheckCircle2} tone="success"
            subs={[
              `نسبة التسليم من الإجمالي: ${fmtPercent(deliveryRateOfTotal)}`,
              `نسبة التسليم من المشحون: ${fmtPercent(deliveryRateOfShipped)}`,
            ]} />
          <MidKpi label="عدد القطع المسلمة" value={fmtNumber(deliveredPieces)} icon={ShoppingBag} tone="success" />
          <MidKpi label="المرتجع" value={fmtNumber(refunded)} icon={AlertTriangle} tone="destructive"
            subs={[`نسبة المرتجع: ${fmtPercent(refundRate)}`]} />
          <MidKpi label="في الشحن" value={fmtNumber(counts.in_delivery)} icon={Truck} tone="warning" />
        </div>
      </section>

      {/* SECTION 3 — Performance KPIs */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-display font-bold text-muted-foreground">مؤشرات الأداء</h3>
          <div className="flex-1 h-px bg-border" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MidKpi label="CPA الحقيقي" value={fmtCurrency(realCpa)} icon={Wallet} tone="warning"
            subs={["تكلفة الإعلان لكل طلب مسلم"]} />
          <MidKpi label="متوسط الربح لكل طلب مسلم" value={fmtCurrency(profitPerDelivered)} icon={DollarSign} tone="success" />
          <MidKpi label="متوسط القطع في الطلب" value={fmtNumber(Math.round(avgPiecesPerOrder * 100) / 100)} icon={ShoppingBag} tone="info"
            subs={[`إجمالي القطع: ${fmtNumber(totalPieces)}`]} />
          <Card className="transition-all hover:-translate-y-0.5">
            <CardContent className="p-4">
              <div className="text-xs font-medium text-muted-foreground tracking-wide">اتجاه الأداء</div>
              <div className="mt-2 flex items-center gap-2">
                {performanceTrend === "new" ? (
                  <Sparkles className="h-6 w-6 text-[var(--info)]" />
                ) : performanceTrend >= 0 ? (
                  <TrendingUp className="h-6 w-6 text-[var(--success)]" />
                ) : (
                  <TrendingDown className="h-6 w-6 text-[var(--destructive)]" />
                )}
                <span className={`text-2xl font-display font-bold ${
                  performanceTrend === "new" ? "text-[var(--info)]" :
                  performanceTrend >= 0 ? "text-[var(--success)]" : "text-[var(--destructive)]"
                }`}>
                  {performanceTrend === "new"
                    ? "جديد"
                    : `${performanceTrend >= 0 ? "↑" : "↓"} ${fmtPercent(Math.abs(performanceTrend))}`}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">مقارنة بالفترة السابقة</div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* SECTION 4 — Profit & Advertising KPIs */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-display font-bold text-muted-foreground">مؤشرات الأرباح والإعلانات</h3>
          <div className="flex-1 h-px bg-border" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <MidKpi label="إجمالي الأرباح" value={fmtCurrency(grossProfit)} icon={DollarSign} tone="success" />
          <MidKpi label="الإنفاق الإعلاني" value={fmtCurrency(adSpend)} icon={Wallet} tone="warning" />
          <MidKpi label="متوسط تكلفة الإعلان لكل طلب مشحون" value={fmtCurrency(avgAdCostPerShipped)} icon={Wallet} tone="warning" />
          <MidKpi label="الربح المحقق" value={fmtCurrency(deliveredCommissions)} icon={DollarSign} tone="success" />
          <MidKpi label="الربح المتوقع" value={fmtCurrency(expectedProfit)} icon={TrendingUp}
            tone={expectedProfit >= 0 ? "success" : "destructive"} />
        </div>
      </section>



      {/* Daily averages */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-display font-bold">المتوسطات اليومية</h3>
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <CalendarDays className="h-4 w-4" /> {numDays} يوم
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard label="متوسط الطلبات يوميًا" value={fmtNumber(Math.round(avgDailyOrders * 10) / 10)} icon={ShoppingBag} />
          <KpiCard label="متوسط التسليم يوميًا" value={fmtNumber(Math.round(avgDailyDelivered * 10) / 10)} icon={CheckCircle2} tone="success" />
          <KpiCard label="متوسط صافي الربح يوميًا" value={fmtCurrency(avgDailyNet)} icon={TrendingUp}
            tone={avgDailyNet >= 0 ? "success" : "destructive"} />
          <KpiCard label="متوسط الإنفاق الإعلاني يوميًا" value={fmtCurrency(avgDailyAdSpend)} icon={Wallet} tone="warning" />
          <KpiCard label="متوسط نسبة التسليم" value={fmtPercent(deliveryRate)} icon={Percent} tone="success" />
        </div>
      </div>

      {/* Comparison vs previous period */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">المقارنة بالفترة السابقة ({prev.from} → {prev.to})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl border p-3">
              <div className="text-xs text-muted-foreground">إجمالي الطلبات</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-lg font-display font-bold">{fmtNumber(total)}</span>
                <GrowthBadge value={growth(total, prevTotal)} />
              </div>
              <div className="text-xs text-muted-foreground mt-1">السابق: {fmtNumber(prevTotal)}</div>
            </div>
            <div className="rounded-xl border p-3">
              <div className="text-xs text-muted-foreground">تم التسليم</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-lg font-display font-bold">{fmtNumber(delivered)}</span>
                <GrowthBadge value={growth(delivered, prevDeliveredCount)} />
              </div>
              <div className="text-xs text-muted-foreground mt-1">السابق: {fmtNumber(prevDeliveredCount)}</div>
            </div>
            <div className="rounded-xl border p-3">
              <div className="text-xs text-muted-foreground">صافي الربح</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-lg font-display font-bold">{fmtCurrency(netProfit)}</span>
                <GrowthBadge value={growth(netProfit, prevNet)} />
              </div>
              <div className="text-xs text-muted-foreground mt-1">السابق: {fmtCurrency(prevNet)}</div>
            </div>
            <div className="rounded-xl border p-3">
              <div className="text-xs text-muted-foreground">نسبة التسليم</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-lg font-display font-bold">{fmtPercent(deliveryRate)}</span>
                <GrowthBadge value={growth(deliveryRate, prevDeliveryRate)} />
              </div>
              <div className="text-xs text-muted-foreground mt-1">السابق: {fmtPercent(prevDeliveryRate)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Daily Orders Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">أداء الطلبات اليومي</CardTitle>
        </CardHeader>
        <CardContent>
          {dailySeries.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 text-sm">لا توجد بيانات</div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={dailySeries} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={dailyTooltip}
                  labelStyle={{ fontWeight: 600 }}
                  contentStyle={{ borderRadius: 12, border: "1px solid var(--border)" }}
                />
                <Legend />
                <Line type="monotone" dataKey="total" name="إجمالي الطلبات" stroke="var(--primary)" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="delivered" name="تم التسليم" stroke="var(--success)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="refunded" name="مرتجع" stroke="var(--destructive)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="net" name="صافي الربح" stroke="var(--chart-2)" strokeWidth={2} dot={false} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Performance overview */}
      {overview && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Trophy className="h-4 w-4 text-[var(--success)]" /> أفضل يوم بالطلبات</div>
              <div className="mt-2 text-lg font-display font-bold">{overview.best.date}</div>
              <div className="text-sm text-muted-foreground">{fmtNumber(overview.best.total)} طلب</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><AlertOctagon className="h-4 w-4 text-[var(--destructive)]" /> أضعف يوم بالطلبات</div>
              <div className="mt-2 text-lg font-display font-bold">{overview.worst.date}</div>
              <div className="text-sm text-muted-foreground">{fmtNumber(overview.worst.total)} طلب</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Percent className="h-4 w-4 text-[var(--success)]" /> أعلى نسبة تسليم</div>
              <div className="mt-2 text-lg font-display font-bold">{overview.bestRate?.date ?? "—"}</div>
              <div className="text-sm text-muted-foreground">{overview.bestRate ? fmtPercent(overview.bestRate.rate) : "—"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="h-4 w-4 text-[var(--success)]" /> أعلى يوم ربح</div>
              <div className="mt-2 text-lg font-display font-bold">{overview.bestProfit.date}</div>
              <div className="text-sm text-muted-foreground">{fmtCurrency(overview.bestProfit.net)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">توزيع الطلبات حسب الحالة</CardTitle></CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="text-center text-muted-foreground py-12 text-sm">لا توجد بيانات</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    outerRadius={90} label>
                    {pieData.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">أعلى ٥ مسوّقين بعدد الطلبات</CardTitle></CardHeader>
          <CardContent>
            {topMarketers.length === 0 ? (
              <div className="text-center text-muted-foreground py-12 text-sm">لا توجد بيانات</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topMarketers}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmtNumber(Number(v))} />
                  <Bar dataKey="orders" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top growing / declining */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base inline-flex items-center gap-2"><TrendingUp className="h-4 w-4 text-[var(--success)]" /> أعلى مسوّقين نموًا</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {topGrowing.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">لا توجد بيانات</div>
            ) : topGrowing.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-lg border p-2.5">
                <div className="text-sm font-medium">{m.name}</div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{fmtNumber(m.orders)} طلب</span>
                  <GrowthBadge value={m.growth} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <DashboardBonusSection />

      </div>

      {/* Marketer daily performance table */}
      <Card>
        <CardHeader><CardTitle className="text-base">الأداء اليومي للمسوّقين</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {marketerRows.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6">لا توجد بيانات</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المسوّق</TableHead>
                  <TableHead>الطلبات</TableHead>
                  <TableHead>تم التسليم</TableHead>
                  <TableHead>نسبة الإرجاع</TableHead>
                  <TableHead>إجمالي العمولات</TableHead>
                  <TableHead>الإنفاق الإعلاني</TableHead>
                  <TableHead>صافي الربح</TableHead>
                  <TableHead>متوسط طلبات/يوم</TableHead>
                  <TableHead>متوسط تسليم/يوم</TableHead>
                  <TableHead>متوسط صافي/يوم</TableHead>
                  <TableHead>النمو</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {marketerRows.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{fmtNumber(m.orders)}</TableCell>
                    <TableCell>{fmtNumber(m.delivered)}</TableCell>
                    <TableCell>{fmtPercent(m.refundRate)}</TableCell>
                    <TableCell>{fmtCurrency(m.gross)}</TableCell>
                    <TableCell>{fmtCurrency(m.spend)}</TableCell>
                    <TableCell className={m.net >= 0 ? "text-[var(--success)] font-medium" : "text-[var(--destructive)] font-medium"}>
                      {fmtCurrency(m.net)}
                    </TableCell>
                    <TableCell>{fmtNumber(Math.round(m.avgOrders * 10) / 10)}</TableCell>
                    <TableCell>{fmtNumber(Math.round(m.avgDelivered * 10) / 10)}</TableCell>
                    <TableCell>{fmtCurrency(m.avgNet)}</TableCell>
                    <TableCell><GrowthBadge value={m.growth} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">معدل الإرجاع</div>
            <div className="text-xl font-display font-bold mt-1">{fmtPercent(refundRate)}</div>
          </div>
          <div className="text-sm text-muted-foreground">إجمالي المرتجعات: {fmtNumber(refunded)}</div>
        </CardContent>
      </Card>
    </div>
  );
}

const toneBg: Record<string, string> = {
  default: "bg-primary/10 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning-foreground",
  destructive: "bg-destructive/15 text-destructive",
  info: "bg-info/15 text-info",
};

function ExecKpi({
  label, value, icon: Icon, tone = "default", sub,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof toneBg;
  sub?: string;
}) {
  return (
    <Card className="transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(16,24,40,0.06),0_24px_48px_-20px_rgba(16,24,40,0.18)]">
      <CardContent className="p-7 flex items-start gap-5">
        <div className={`p-4 rounded-2xl ${toneBg[tone]}`}>
          <Icon className="h-7 w-7" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-muted-foreground tracking-wide">{label}</div>
          <div className="text-4xl font-display font-bold mt-1.5 truncate text-foreground">{value}</div>
          {sub && <div className="text-xs text-muted-foreground mt-2">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function MidKpi({
  label, value, icon: Icon, tone = "default", subs,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof toneBg;
  subs?: string[];
}) {
  return (
    <Card className="transition-all hover:-translate-y-0.5">
      <CardContent className="p-5 flex items-start gap-4">
        <div className={`p-2.5 rounded-xl ${toneBg[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-muted-foreground tracking-wide">{label}</div>
          <div className="text-2xl font-display font-bold mt-1 truncate text-foreground">{value}</div>
          {subs?.map((s, i) => (
            <div key={i} className="text-[11px] text-muted-foreground mt-1 leading-tight">{s}</div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

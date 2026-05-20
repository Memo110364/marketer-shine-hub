import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { fetchAll } from "@/lib/fetch-all";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ShoppingBag, Clock, Truck, CheckCircle2, XCircle, AlertTriangle,
  TrendingUp, Wallet, DollarSign, Percent,
} from "lucide-react";
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/format";
import { ORDER_STATUS, ORDER_STATUS_KEYS } from "@/lib/constants";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { role } = useAuth();
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(monthStart.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));

  const { data: orders = [] } = useQuery({
    queryKey: ["orders-dash", from, to],
    queryFn: () =>
      fetchAll<{ id: string; status: string; commission: number | null; marketer_id: string | null; order_date: string | null; product_id: string | null }>((a, b) =>
        supabase
          .from("orders")
          .select("id, status, commission, marketer_id, order_date, product_id")
          .gte("order_date", from)
          .lte("order_date", to)
          .range(a, b),
      ),
  });

  const { data: spend = [] } = useQuery({
    queryKey: ["spend-dash", from, to],
    queryFn: () =>
      fetchAll<{ amount: number; marketer_id: string | null; transaction_date: string }>((a, b) =>
        supabase
          .from("ad_spend_transactions")
          .select("amount, marketer_id, transaction_date")
          .gte("transaction_date", from)
          .lte("transaction_date", to)
          .range(a, b),
      ),
  });

  const { data: marketers = [] } = useQuery({
    queryKey: ["marketers-min"],
    queryFn: async () => {
      const { data } = await supabase.from("marketers").select("id, name, marketer_code");
      return data ?? [];
    },
  });

  const counts = ORDER_STATUS_KEYS.reduce((acc, k) => {
    acc[k] = orders.filter((o) => o.status === k).length;
    return acc;
  }, {} as Record<string, number>);

  const total = orders.length;
  const EXCLUDED_FROM_GROSS = new Set(["refunded", "refund_request"]);
  const grossProfit = orders
    .filter((o) => !EXCLUDED_FROM_GROSS.has(o.status as string))
    .reduce((s, o) => s + Number(o.commission || 0), 0);
  const deliveredCommissions = orders
    .filter((o) => o.status === "delivered" || o.status === "done")
    .reduce((s, o) => s + Number(o.commission || 0), 0);
  const adSpend = spend.reduce((s, t) => s + Number(t.amount || 0), 0);
  const netProfit = deliveredCommissions - adSpend;
  const delivered = counts.delivered + counts.done;
  const refunded = counts.refunded + counts.refund_request;
  const deliveryRate = total > 0 ? delivered / total : 0;
  const refundRate = total > 0 ? refunded / total : 0;
  const inDeliveryCommissions = orders
    .filter((o) => o.status === "in_delivery")
    .reduce((s, o) => s + Number(o.commission || 0), 0);
  const expectedProfit = netProfit + inDeliveryCommissions * deliveryRate;

  const pieData = ORDER_STATUS_KEYS.map((k) => ({
    name: ORDER_STATUS[k].label,
    value: counts[k],
  })).filter((d) => d.value > 0);

  const pieColors = ["var(--info)", "var(--warning)", "var(--success)", "var(--chart-2)", "var(--destructive)", "var(--chart-5)"];

  // Top marketers by net profit
  const byMarketer = new Map<string, { gross: number; spend: number; orders: number }>();
  orders.forEach((o) => {
    if (!o.marketer_id) return;
    const cur = byMarketer.get(o.marketer_id) ?? { gross: 0, spend: 0, orders: 0 };
    cur.gross += Number(o.commission || 0);
    cur.orders += 1;
    byMarketer.set(o.marketer_id, cur);
  });
  spend.forEach((s) => {
    if (!s.marketer_id) return;
    const cur = byMarketer.get(s.marketer_id) ?? { gross: 0, spend: 0, orders: 0 };
    cur.spend += Number(s.amount || 0);
    byMarketer.set(s.marketer_id, cur);
  });
  const topMarketers = Array.from(byMarketer.entries())
    .map(([id, v]) => ({
      name: marketers.find((m) => m.id === id)?.name ?? "—",
      orders: v.orders,
    }))
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-display font-bold">لوحة التحكم</h2>
          <p className="text-sm text-muted-foreground">
            {role === "marketer" ? "نظرة على أدائك الشخصي" : "نظرة عامة على الأداء"}
          </p>
        </div>
        <Card className="p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">من</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
            </div>
            <div>
              <Label className="text-xs">إلى</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
            </div>
          </div>
        </Card>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <KpiCard label="إجمالي الطلبات" value={fmtNumber(total)} icon={ShoppingBag} />
        <KpiCard label="طلبات جديدة" value={fmtNumber(counts.pending)} icon={Clock} tone="info" />
        <KpiCard label="في الشحن" value={fmtNumber(counts.in_delivery)} icon={Truck} tone="warning" />
        <KpiCard label="تم التسليم" value={fmtNumber(counts.delivered)} icon={CheckCircle2} tone="success" />
        <KpiCard label="تم التحصيل" value={fmtNumber(counts.done)} icon={CheckCircle2} tone="success" />
        <KpiCard label="رجع المخزن" value={fmtNumber(counts.refunded)} icon={XCircle} tone="destructive" />
        <KpiCard label="مرتجع مع الشحن" value={fmtNumber(counts.refund_request)} icon={AlertTriangle} tone="destructive" />
        <KpiCard label="معدل التسليم" value={fmtPercent(deliveryRate)} icon={Percent} tone="success" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="إجمالي العمولات" value={fmtCurrency(grossProfit)} icon={DollarSign} tone="success" />
        <KpiCard label="الإنفاق الإعلاني" value={fmtCurrency(adSpend)} icon={Wallet} tone="warning" />
        <KpiCard label="صافي الربح" value={fmtCurrency(netProfit)} icon={TrendingUp}
          tone={netProfit >= 0 ? "success" : "destructive"} />
        <KpiCard label="الربح المتوقع" value={fmtCurrency(expectedProfit)} icon={TrendingUp}
          tone={expectedProfit >= 0 ? "success" : "destructive"} />
      </div>

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
          <CardHeader><CardTitle className="text-base">أعلى ٥ مسوّقين بصافي الربح</CardTitle></CardHeader>
          <CardContent>
            {topMarketers.length === 0 ? (
              <div className="text-center text-muted-foreground py-12 text-sm">لا توجد بيانات</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topMarketers}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip formatter={(v) => fmtCurrency(Number(v))} />
                  <Bar dataKey="net" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

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

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { fmtNumber, fmtPercent } from "@/lib/format";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";


export const Route = createFileRoute("/_authenticated/shipping")({
  component: ShippingPerf,
});

function ShippingPerf() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedCompany, setSelectedCompany] = useState<string>("");

  const { data: companies = [] } = useQuery({
    queryKey: ["shipping"],
    queryFn: async () => (await supabase.from("shipping_companies").select("*")).data ?? [],
  });
  const { data: orders = [] } = useQuery({
    queryKey: ["shipping-orders", from, to],
    queryFn: async () => {
      let q = supabase
        .from("orders")
        .select("shipping_company_id, status, governorate, return_reason");
      if (from) q = q.gte("order_date", from);
      if (to) q = q.lte("order_date", to);
      return (await q).data ?? [];
    },
  });

  const rows = useMemo(() => companies.map((c) => {
    const list = orders.filter((o) => o.shipping_company_id === c.id);
    const total = list.length;
    const delivered = list.filter((o) => o.status === "delivered" || o.status === "done").length;
    const refunded = list.filter((o) => o.status === "refunded" || o.status === "refund_request").length;
    return { ...c, total, delivered, refunded, rate: total > 0 ? delivered / total : 0 };
  }).sort((a, b) => b.total - a.total), [companies, orders]);

  const activeCompanyId = selectedCompany || rows[0]?.id || "";
  const activeCompany = companies.find((c) => c.id === activeCompanyId);

  const activeStats = useMemo(() => {
    const list = orders.filter((o) => o.shipping_company_id === activeCompanyId);
    const total = list.length;
    const delivered = list.filter((o) => o.status === "delivered" || o.status === "done").length;
    const refunded = list.filter((o) => o.status === "refunded" || o.status === "refund_request").length;
    const inDelivery = list.filter((o) => o.status === "in_delivery").length;
    const pending = list.filter((o) => o.status === "pending").length;
    const closed = delivered + refunded;
    return {
      total, delivered, refunded, inDelivery, pending,
      deliveryRate: total > 0 ? delivered / total : 0,
      closedRate: closed > 0 ? delivered / closed : 0,
      refundRate: total > 0 ? refunded / total : 0,
    };
  }, [orders, activeCompanyId]);

  const govData = useMemo(() => {
    if (!activeCompanyId) return [];
    const list = orders.filter((o) => o.shipping_company_id === activeCompanyId);
    const byGov = new Map<string, { total: number; delivered: number; refunded: number; inDelivery: number; pending: number }>();
    for (const o of list) {
      const g = (o.governorate ?? "غير محدد").trim() || "غير محدد";
      const e = byGov.get(g) ?? { total: 0, delivered: 0, refunded: 0, inDelivery: 0, pending: 0 };
      e.total += 1;
      if (o.status === "delivered" || o.status === "done") e.delivered += 1;
      else if (o.status === "refunded" || o.status === "refund_request") e.refunded += 1;
      else if (o.status === "in_delivery") e.inDelivery += 1;
      else if (o.status === "pending") e.pending += 1;
      byGov.set(g, e);
    }
    return Array.from(byGov.entries())
      .map(([governorate, v]) => ({
        governorate,
        ...v,
        rate: v.total > 0 ? Math.round((v.delivered / v.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [orders, activeCompanyId]);


  const reasonsData = useMemo(() => {
    if (!activeCompanyId) return [];
    const list = orders.filter(
      (o) =>
        o.shipping_company_id === activeCompanyId &&
        (o.status === "refunded" || o.status === "refund_request") &&
        o.return_reason &&
        String(o.return_reason).trim(),
    );
    const byReason = new Map<string, number>();
    for (const o of list) {
      const r = String(o.return_reason).trim();
      byReason.set(r, (byReason.get(r) ?? 0) + 1);
    }
    return Array.from(byReason.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [orders, activeCompanyId]);

  const rateColor = (rate: number) => {
    if (rate >= 80) return "hsl(var(--success, 142 76% 36%))";
    if (rate >= 60) return "hsl(var(--primary))";
    if (rate >= 40) return "hsl(var(--warning, 38 92% 50%))";
    return "hsl(var(--destructive))";
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-display font-bold">أداء شركات الشحن</h2>
        <p className="text-sm text-muted-foreground">معدلات التسليم لكل شركة شحن وتحليلها بحسب المحافظات وأسباب الإرجاع</p>
      </div>

      <Card className="p-4 flex flex-wrap gap-3 items-end">
        <div><Label className="text-xs">من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></div>
        <div><Label className="text-xs">إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></div>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">ملخص الشركات</CardTitle></CardHeader>
        <Table>
          <TableHeader><TableRow>
            <TableHead>الشركة</TableHead><TableHead>الطلبات</TableHead>
            <TableHead>تم التسليم</TableHead><TableHead>مرتجع</TableHead>
            <TableHead>معدل التسليم</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">لا توجد شركات</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow
                key={r.id}
                className={`cursor-pointer ${r.id === activeCompanyId ? "bg-muted/50" : ""}`}
                onClick={() => setSelectedCompany(r.id)}
              >
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{fmtNumber(r.total)}</TableCell>
                <TableCell>{fmtNumber(r.delivered)}</TableCell>
                <TableCell>{fmtNumber(r.refunded)}</TableCell>
                <TableCell>{fmtPercent(r.rate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">تحليل تفصيلي</CardTitle>
            {activeCompany && (
              <div className="text-xs text-muted-foreground mt-1">{activeCompany.name}</div>
            )}
          </div>
          <Select value={activeCompanyId} onValueChange={setSelectedCompany}>
            <SelectTrigger className="h-9 w-60"><SelectValue placeholder="اختر شركة" /></SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">إجمالي الطلبات</div>
              <div className="text-xl font-bold mt-1">{fmtNumber(activeStats.total)}</div>
            </div>
            <div className="rounded-lg border p-3 bg-success/5">
              <div className="text-xs text-muted-foreground">تم التسليم</div>
              <div className="text-xl font-bold mt-1 text-success">{fmtNumber(activeStats.delivered)}</div>
              <div className="text-[10px] text-muted-foreground mt-1">{fmtPercent(activeStats.deliveryRate)} من الإجمالي</div>
            </div>
            <div className="rounded-lg border p-3 bg-destructive/5">
              <div className="text-xs text-muted-foreground">مرتجع</div>
              <div className="text-xl font-bold mt-1 text-destructive">{fmtNumber(activeStats.refunded)}</div>
              <div className="text-[10px] text-muted-foreground mt-1">{fmtPercent(activeStats.refundRate)} من الإجمالي</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">في الشحن</div>
              <div className="text-xl font-bold mt-1">{fmtNumber(activeStats.inDelivery)}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">معدل النجاح (للمغلقة)</div>
              <div className="text-xl font-bold mt-1">{fmtPercent(activeStats.closedRate)}</div>
              <div className="text-[10px] text-muted-foreground mt-1">تسليم ÷ (تسليم + مرتجع)</div>
            </div>
          </div>

          <div>
            <div className="text-sm font-medium mb-2">التفاصيل حسب المحافظة</div>
            {govData.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center border rounded-lg">لا توجد بيانات</div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المحافظة</TableHead>
                      <TableHead className="text-center">الإجمالي</TableHead>
                      <TableHead className="text-center">تم التسليم</TableHead>
                      <TableHead className="text-center">مرتجع</TableHead>
                      <TableHead className="text-center">في الشحن</TableHead>
                      <TableHead className="text-center">جديد</TableHead>
                      <TableHead className="w-56">معدل التسليم</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {govData.map((g) => (
                      <TableRow key={g.governorate}>
                        <TableCell className="font-medium">{g.governorate}</TableCell>
                        <TableCell className="text-center">{fmtNumber(g.total)}</TableCell>
                        <TableCell className="text-center text-success font-medium">{fmtNumber(g.delivered)}</TableCell>
                        <TableCell className="text-center text-destructive">{fmtNumber(g.refunded)}</TableCell>
                        <TableCell className="text-center text-muted-foreground">{fmtNumber(g.inDelivery)}</TableCell>
                        <TableCell className="text-center text-muted-foreground">{fmtNumber(g.pending)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={g.rate} className="h-2 flex-1" />
                            <Badge
                              variant="outline"
                              style={{ color: rateColor(g.rate), borderColor: rateColor(g.rate) }}
                              className="min-w-[3rem] justify-center"
                            >
                              {g.rate}%
                            </Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="text-sm font-medium mb-2">معدل التسليم — رسم بياني</div>
              {govData.length === 0 ? (
                <div className="text-sm text-muted-foreground py-12 text-center">لا توجد بيانات</div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(280, Math.min(govData.length, 15) * 28)}>
                  <BarChart data={govData.slice(0, 15)} layout="vertical" margin={{ left: 60, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" domain={[0, 100]} unit="%" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis dataKey="governorate" type="category" width={90} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                      formatter={(v: any, _n: any, p: any) => [`${v}% (${p.payload.delivered}/${p.payload.total})`, "معدل التسليم"]}
                    />
                    <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                      {govData.slice(0, 15).map((d, i) => <Cell key={i} fill={rateColor(d.rate)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div>
              <div className="text-sm font-medium mb-2">أهم أسباب الإرجاع</div>
              {reasonsData.length === 0 ? (
                <div className="text-sm text-muted-foreground py-12 text-center">
                  لا توجد بيانات أسباب إرجاع — يمكنك إضافة عمود "سبب الإرجاع" عند تحديث حالات الطلبات.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(280, reasonsData.length * 32)}>
                  <BarChart data={reasonsData} layout="vertical" margin={{ left: 80, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis dataKey="reason" type="category" width={140} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                      formatter={(v: any) => [`${v} طلب`, "عدد المرتجعات"]}
                    />
                    <Bar dataKey="count" fill="hsl(var(--destructive))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

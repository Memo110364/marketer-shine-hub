import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtCurrency, fmtDate, fmtNumber, fmtPercent } from "@/lib/format";
import { ORDER_STATUS_KEYS, type OrderStatus } from "@/lib/constants";
import {
  ArrowRight, ShoppingBag, DollarSign, Wallet, TrendingUp, Plus, Loader2, Trophy,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/marketers/$id")({
  component: MarketerDetails,
});

// commissions excluded for: refunded, refund_request
const COMMISSION_EXCLUDED: OrderStatus[] = ["refunded", "refund_request"];
const NET_PROFIT_STATUSES: OrderStatus[] = ["delivered", "done"];

function MarketerDetails() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  // default range: last 30 days
  const today = new Date().toISOString().slice(0, 10);
  const thirtyAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(thirtyAgo);
  const [toDate, setToDate] = useState(today);

  const [addOpen, setAddOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [fawry, setFawry] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: m } = useQuery({
    queryKey: ["marketer", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketers").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: allOrders = [] } = useQuery({
    queryKey: ["marketer-orders-all", id],
    queryFn: async () => {
      const { data } = await supabase.from("orders").select("*").eq("marketer_id", id)
        .order("order_date", { ascending: false });
      return data ?? [];
    },
  });

  const { data: allSpend = [] } = useQuery({
    queryKey: ["marketer-spend-all", id],
    queryFn: async () => {
      const { data } = await supabase.from("ad_spend_transactions").select("*")
        .eq("marketer_id", id).order("transaction_date", { ascending: false });
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products-min"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id,name,sku");
      return data ?? [];
    },
  });
  const productMap = useMemo(
    () => new Map(products.map((p: any) => [p.id, p])),
    [products],
  );

  // filter by range
  const inRange = (d: string | null | undefined) => {
    if (!d) return false;
    return d >= fromDate && d <= toDate;
  };
  const orders = useMemo(
    () => allOrders.filter((o) => inRange(o.order_date)),
    [allOrders, fromDate, toDate],
  );
  const spend = useMemo(
    () => allSpend.filter((t) => inRange(t.transaction_date)),
    [allSpend, fromDate, toDate],
  );

  // KPI counts in range
  const counts = ORDER_STATUS_KEYS.reduce((a, k) => {
    a[k] = orders.filter((o) => o.status === k).length;
    return a;
  }, {} as Record<OrderStatus, number>);

  const total = orders.length;
  const gross = orders
    .filter((o) => !COMMISSION_EXCLUDED.includes(o.status as OrderStatus))
    .reduce((s, o) => s + Number(o.commission || 0), 0);
  const netCommissions = orders
    .filter((o) => NET_PROFIT_STATUSES.includes(o.status as OrderStatus))
    .reduce((s, o) => s + Number(o.commission || 0), 0);
  const totalSpend = spend.reduce((s, t) => s + Number(t.amount || 0), 0);
  const net = netCommissions - totalSpend;
  const delivered = counts.delivered + counts.done;
  const deliveryRate = total > 0 ? delivered / total : 0;

  // lifetime (all time) totals
  const lifetimeGross = allOrders
    .filter((o) => !COMMISSION_EXCLUDED.includes(o.status as OrderStatus))
    .reduce((s, o) => s + Number(o.commission || 0), 0);
  const lifetimeNet = allOrders
    .filter((o) => NET_PROFIT_STATUSES.includes(o.status as OrderStatus))
    .reduce((s, o) => s + Number(o.commission || 0), 0);
  const lifetimeSpend = allSpend.reduce((s, t) => s + Number(t.amount || 0), 0);
  const lifetimeProfit = lifetimeNet - lifetimeSpend;

  // products breakdown (within range)
  const productStats = useMemo(() => {
    const map = new Map<string, { name: string; sku: string; count: number; delivered: number; commissions: number; revenue: number }>();
    for (const o of orders) {
      const pid = o.product_id ?? "unknown";
      const p: any = pid !== "unknown" ? productMap.get(pid) : null;
      const key = pid;
      const entry = map.get(key) ?? {
        name: p?.name ?? "—",
        sku: p?.sku ?? "—",
        count: 0,
        delivered: 0,
        commissions: 0,
        revenue: 0,
      };
      entry.count += 1;
      if (NET_PROFIT_STATUSES.includes(o.status as OrderStatus)) {
        entry.delivered += 1;
        entry.revenue += Number(o.price || 0);
      }
      if (!COMMISSION_EXCLUDED.includes(o.status as OrderStatus)) {
        entry.commissions += Number(o.commission || 0);
      }
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [orders, productMap]);

  async function addSpend() {
    if (!amount || Number(amount) <= 0) { toast.error("أدخل مبلغًا صحيحًا"); return; }
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("ad_spend_transactions").insert({
      marketer_id: id,
      amount: Number(amount),
      fawry_code: fawry || null,
      transaction_date: date,
      notes: notes || null,
      created_by: userData.user?.id,
    });
    setBusy(false);
    if (error) { toast.error("فشل الحفظ", { description: error.message }); return; }
    toast.success("تم إضافة المعاملة");
    setAddOpen(false);
    setAmount(""); setFawry(""); setNotes("");
    qc.invalidateQueries({ queryKey: ["marketer-spend-all", id] });
  }

  function setPreset(days: number) {
    setFromDate(new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10));
    setToDate(today);
  }

  if (!m) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to="/marketers"><ArrowRight className="h-4 w-4 ml-1" /> رجوع</Link>
          </Button>
          <h2 className="text-2xl font-display font-bold">{m.name}</h2>
          <div className="text-sm text-muted-foreground">كود: {m.marketer_code}</div>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 ml-1" /> إضافة معاملة محفظة</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>إضافة معاملة إنفاق إعلاني</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>المبلغ</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div><Label>كود فوري</Label><Input value={fawry} onChange={(e) => setFawry(e.target.value)} dir="ltr" /></div>
              <div><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button onClick={addSpend} disabled={busy}>
                {busy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><div className="text-muted-foreground">الهاتف</div><div dir="ltr">{m.phone ?? "—"}</div></div>
          <div><div className="text-muted-foreground">واتساب</div><div dir="ltr">{m.whatsapp ?? "—"}</div></div>
          <div><div className="text-muted-foreground">البريد</div><div dir="ltr">{m.email ?? "—"}</div></div>
          <div><div className="text-muted-foreground">الحالة</div><div>{m.status}</div></div>
        </CardContent>
      </Card>

      {/* Lifetime card */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" /> الإجمالي منذ بداية العمل
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">إجمالي الطلبات</div>
            <div className="text-lg font-bold">{fmtNumber(allOrders.length)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">إجمالي العمولات</div>
            <div className="text-lg font-bold text-success">{fmtCurrency(lifetimeGross)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">إجمالي الإنفاق الإعلاني</div>
            <div className="text-lg font-bold text-warning">{fmtCurrency(lifetimeSpend)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">صافي الربح</div>
            <div className={`text-lg font-bold ${lifetimeProfit >= 0 ? "text-success" : "text-destructive"}`}>
              {fmtCurrency(lifetimeProfit)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Date range filter */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>من</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>إلى</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPreset(7)}>7 أيام</Button>
            <Button variant="outline" size="sm" onClick={() => setPreset(30)}>30 يوم</Button>
            <Button variant="outline" size="sm" onClick={() => setPreset(90)}>90 يوم</Button>
            <Button variant="outline" size="sm" onClick={() => { setFromDate("2000-01-01"); setToDate(today); }}>الكل</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="إجمالي الطلبات" value={fmtNumber(total)} icon={ShoppingBag} />
        <KpiCard label="إجمالي العمولات" value={fmtCurrency(gross)} icon={DollarSign} tone="success" />
        <KpiCard label="الإنفاق الإعلاني" value={fmtCurrency(totalSpend)} icon={Wallet} tone="warning" />
        <KpiCard label="صافي الربح" value={fmtCurrency(net)} icon={TrendingUp}
          tone={net >= 0 ? "success" : "destructive"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
        {ORDER_STATUS_KEYS.map((k) => (
          <Card key={k}><CardContent className="p-3">
            <StatusBadge status={k} />
            <div className="text-lg font-bold mt-2">{fmtNumber(counts[k])}</div>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">معدل التسليم: {fmtPercent(deliveryRate)}</CardTitle></CardHeader>
      </Card>

      {/* Products worked on */}
      <Card>
        <CardHeader><CardTitle className="text-base">المنتجات اللي اشتغل عليها</CardTitle></CardHeader>
        <Table>
          <TableHeader><TableRow>
            <TableHead>المنتج</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>عدد الطلبات</TableHead>
            <TableHead>تم التسليم</TableHead>
            <TableHead>الإيراد</TableHead>
            <TableHead>العمولات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {productStats.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
            ) : productStats.map((p, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell dir="ltr">{p.sku}</TableCell>
                <TableCell>{fmtNumber(p.count)}</TableCell>
                <TableCell>{fmtNumber(p.delivered)}</TableCell>
                <TableCell>{fmtCurrency(p.revenue)}</TableCell>
                <TableCell className="text-success">{fmtCurrency(p.commissions)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">آخر الطلبات في الفترة</CardTitle></CardHeader>
        <Table>
          <TableHeader><TableRow>
            <TableHead>التاريخ</TableHead><TableHead>رقم الطلب</TableHead>
            <TableHead>العميل</TableHead><TableHead>السعر</TableHead>
            <TableHead>العمولة</TableHead><TableHead>الحالة</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">لا توجد طلبات</TableCell></TableRow>
            ) : orders.slice(0, 50).map((o) => (
              <TableRow key={o.id}>
                <TableCell>{fmtDate(o.order_date)}</TableCell>
                <TableCell dir="ltr">{o.external_order_id ?? "—"}</TableCell>
                <TableCell>{o.customer_name ?? "—"}</TableCell>
                <TableCell>{fmtCurrency(Number(o.price))}</TableCell>
                <TableCell>{fmtCurrency(Number(o.commission))}</TableCell>
                <TableCell><StatusBadge status={o.status as OrderStatus} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">معاملات الإنفاق الإعلاني في الفترة</CardTitle></CardHeader>
        <Table>
          <TableHeader><TableRow>
            <TableHead>التاريخ</TableHead><TableHead>المبلغ</TableHead>
            <TableHead>كود فوري</TableHead><TableHead>ملاحظات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {spend.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">لا توجد معاملات</TableCell></TableRow>
            ) : spend.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{fmtDate(t.transaction_date)}</TableCell>
                <TableCell className="font-medium">{fmtCurrency(Number(t.amount))}</TableCell>
                <TableCell dir="ltr">{t.fawry_code ?? "—"}</TableCell>
                <TableCell>{t.notes ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

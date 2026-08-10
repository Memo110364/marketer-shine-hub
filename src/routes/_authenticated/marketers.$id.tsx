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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtCurrency, fmtDate, fmtNumber, fmtPercent } from "@/lib/format";
import { fetchAll } from "@/lib/fetch-all";
import { ORDER_STATUS_KEYS, type OrderStatus } from "@/lib/constants";
import {
  ArrowRight, Plus, Loader2, Trophy, Info, ShoppingBag, DollarSign, Wallet, TrendingUp, Package,
} from "lucide-react";
import { toast } from "sonner";

import { parseProductField } from "@/lib/parse-product";

// Use shared parser (same as products performance page) to ensure consistent
// product name splitting. Returns { name, qty } aggregated by base product name.
function parseProducts(raw: unknown): Array<{ name: string; qty: number }> {
  return parseProductField(raw).map((it) => ({
    name: it.base_product_name,
    qty: it.quantity,
  }));
}
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_authenticated/marketers/$id")({
  component: MarketerDetails,
});

const COMMISSION_EXCLUDED: OrderStatus[] = ["refunded", "refund_request"];
const NET_PROFIT_STATUSES: OrderStatus[] = ["delivered", "done"];

const SPEND_TYPE_LABELS = {
  meta_ads: "Meta Ads",
  tiktok_ads: "Tiktok Ads",
  easy_order: "Easy Order",
  salary: "Salary",
  other: "Other",
} as const;
type SpendType = keyof typeof SPEND_TYPE_LABELS;

function MarketerDetails() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);
  const thirtyAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(thirtyAgo);
  const [toDate, setToDate] = useState(today);

  const [infoOpen, setInfoOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  
  const [amount, setAmount] = useState("");
  const [fawry, setFawry] = useState("");
  const [spendType, setSpendType] = useState<SpendType>("meta_ads");
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
    queryFn: () =>
      fetchAll<any>((a, b) =>
        supabase.from("orders").select("*").eq("marketer_id", id)
          .order("order_date", { ascending: false }).range(a, b),
      ),
  });

  const { data: allSpend = [] } = useQuery({
    queryKey: ["marketer-spend-all", id],
    queryFn: () =>
      fetchAll<any>((a, b) =>
        supabase.from("ad_spend_transactions").select("*")
          .eq("marketer_id", id).order("transaction_date", { ascending: false }).range(a, b),
      ),
  });

  const lifetimePieces = useMemo(() => {
    let total = 0;
    for (const o of allOrders) {
      if (COMMISSION_EXCLUDED.includes(o.status as OrderStatus)) continue;
      for (const it of parseProducts((o.raw_data as any)?.Products)) total += it.qty;
    }
    return total;
  }, [allOrders]);


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

  const counts = ORDER_STATUS_KEYS.reduce((a, k) => {
    a[k] = orders.filter((o) => o.status === k).length;
    return a;
  }, {} as Record<OrderStatus, number>);

  // Merged display groups
  const mergedStatusGroups: Array<{ key: string; label: string; color: string; count: number }> = [
    { key: "pending", label: "طلب جديد", color: "info", count: counts.pending },
    { key: "cancelled", label: "ملغي قبل الشحن", color: "destructive", count: counts.cancelled },
    { key: "in_delivery", label: "في الشحن", color: "warning", count: counts.in_delivery },
    { key: "delivered", label: "تم التسليم", color: "success", count: counts.delivered + counts.done },
    { key: "returned", label: "مرتجع بعد الشحن", color: "destructive", count: counts.refunded + counts.refund_request },
  ];

  const total = orders.length;
  const periodGrossCommissions = orders
    .filter((o) => !COMMISSION_EXCLUDED.includes(o.status as OrderStatus))
    .reduce((s, o) => s + Number(o.commission || 0), 0);
  const netCommissions = orders
    .filter((o) => NET_PROFIT_STATUSES.includes(o.status as OrderStatus))
    .reduce((s, o) => s + Number(o.commission || 0), 0);
  // الإنفاق الإعلاني فقط (يستثني المرتبات ومصاريف Test Ads اللي بتتحملها
  // الشركة) — يشمل Meta/TikTok/Easy Order/أخرى
  const totalSpend = spend
    .filter((t) => t.spend_type !== "salary" && t.spend_type !== "test_ads")
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const periodProfit = netCommissions - totalSpend;
  const delivered = counts.delivered + counts.done;
  const deliveryRate = total > 0 ? delivered / total : 0;
  // الطلبات التي خرجت للشحن (تستثني الطلبات الجديدة والملغاة قبل الشحن)
  const shippedOrders = total - counts.pending - counts.cancelled;
  const shippedRate = total > 0 ? shippedOrders / total : 0;
  const totalRateOfLifetime = allOrders.length > 0 ? total / allOrders.length : 0;
  const netRateOfGross = periodGrossCommissions > 0 ? netCommissions / periodGrossCommissions : 0;
  const spendRateOfNet = netCommissions > 0 ? totalSpend / netCommissions : 0;
  const profitMargin = netCommissions > 0 ? periodProfit / netCommissions : 0;

  // lifetime
  const lifetimeGross = allOrders
    .filter((o) => !COMMISSION_EXCLUDED.includes(o.status as OrderStatus))
    .reduce((s, o) => s + Number(o.commission || 0), 0);
  const lifetimeNet = allOrders
    .filter((o) => NET_PROFIT_STATUSES.includes(o.status as OrderStatus))
    .reduce((s, o) => s + Number(o.commission || 0), 0);
  const lifetimeSpend = allSpend.reduce((s, t) => s + Number(t.amount || 0), 0);
  const lifetimeProfit = lifetimeNet - lifetimeSpend;

  // Parse products from raw_data — aggregate by clean name, summing quantities.
  // Exclude refunded orders from piece counts.
  const { topProducts, totalPiecesInRange } = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; orders: number }>();
    let totalQty = 0;
    for (const o of orders) {
      if (COMMISSION_EXCLUDED.includes(o.status as OrderStatus)) continue;
      const items = parseProducts((o.raw_data as any)?.Products);
      const seenInOrder = new Set<string>();
      for (const it of items) {
        const key = it.name;
        const entry = map.get(key) ?? { name: it.name, qty: 0, orders: 0 };
        entry.qty += it.qty;
        if (!seenInOrder.has(key)) {
          entry.orders += 1;
          seenInOrder.add(key);
        }
        map.set(key, entry);
        totalQty += it.qty;
      }
    }
    const top = Array.from(map.values()).sort((a, b) => b.qty - a.qty).slice(0, 5);
    return { topProducts: top, totalPiecesInRange: totalQty };
  }, [orders]);

  async function addSpend() {
    if (!amount || Number(amount) <= 0) { toast.error("أدخل مبلغًا صحيحًا"); return; }
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("ad_spend_transactions").insert({
      marketer_id: id,
      amount: Number(amount),
      fawry_code: fawry || null,
      spend_type: spendType,
      transaction_date: date,
      notes: notes || null,
      created_by: userData.user?.id,
    });
    setBusy(false);
    if (error) {
      console.error("Add transaction error:", error);
      if ((error as any).code === "23505") {
        toast.error("كود فوري مستخدم من قبل");
      } else {
        toast.error("فشل الحفظ");
      }
      return;
    }
    toast.success("تم إضافة المعاملة");
    setAddOpen(false);
    setAmount(""); setFawry(""); setNotes(""); setSpendType("meta_ads");
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
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-display font-bold">{m.name}</h2>
            <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon" className="h-7 w-7 rounded-full" title="بيانات المسوق">
                  <Info className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>بيانات المسوق</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><div className="text-muted-foreground">الاسم</div><div>{m.name}</div></div>
                  <div><div className="text-muted-foreground">كود</div><div dir="ltr">{m.marketer_code}</div></div>
                  <div><div className="text-muted-foreground">الهاتف</div><div dir="ltr">{m.phone ?? "—"}</div></div>
                  <div><div className="text-muted-foreground">واتساب</div><div dir="ltr">{m.whatsapp ?? "—"}</div></div>
                  <div><div className="text-muted-foreground">البريد</div><div dir="ltr">{m.email ?? "—"}</div></div>
                  <div><div className="text-muted-foreground">الحالة</div><div>{m.status}</div></div>
                  <div><div className="text-muted-foreground">فيسبوك</div><div dir="ltr">{m.facebook_profile ?? "—"}</div></div>
                  <div><div className="text-muted-foreground">تيك توك</div><div dir="ltr">{m.tiktok_profile ?? "—"}</div></div>
                  {m.notes && (
                    <div className="col-span-2"><div className="text-muted-foreground">ملاحظات</div><div>{m.notes}</div></div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="text-sm text-muted-foreground mt-1">كود: {m.marketer_code}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 ml-1" /> إضافة معاملة محفظة</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>إضافة معاملة إنفاق إعلاني</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>كود فوري</Label><Input value={fawry} onChange={(e) => setFawry(e.target.value)} dir="ltr" /></div>
                <div><Label>المبلغ</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                <div>
                  <Label>نوع الصرف</Label>
                  <Select value={spendType} onValueChange={(v) => setSpendType(v as SpendType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(SPEND_TYPE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
      </div>

      {/* Lifetime — 4 big cards */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="h-5 w-5 text-primary" />
          <h3 className="font-display font-bold">الإجمالي منذ بداية العمل</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <Card className="border-primary/30">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 rounded-xl bg-primary/10 text-primary"><ShoppingBag className="h-5 w-5" /></div>
                <div className="text-sm text-muted-foreground">إجمالي الطلبات</div>
              </div>
              <div className="text-3xl font-display font-bold">{fmtNumber(allOrders.length)}</div>
            </CardContent>
          </Card>
          <Card className="border-primary/30">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 rounded-xl bg-primary/10 text-primary"><Package className="h-5 w-5" /></div>
                <div className="text-sm text-muted-foreground">إجمالي القطع المباعة</div>
              </div>
              <div className="text-3xl font-display font-bold">{fmtNumber(lifetimePieces)}</div>
            </CardContent>
          </Card>
          <Card className="border-success/30">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 rounded-xl bg-success/15 text-success"><DollarSign className="h-5 w-5" /></div>
                <div className="text-sm text-muted-foreground">إجمالي العمولات</div>
              </div>
              <div className="text-3xl font-display font-bold text-success">{fmtCurrency(lifetimeGross)}</div>
            </CardContent>
          </Card>
          <Card className="border-warning/30">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 rounded-xl bg-warning/15 text-warning-foreground"><Wallet className="h-5 w-5" /></div>
                <div className="text-sm text-muted-foreground">إجمالي الإنفاق</div>
              </div>
              <div className="text-3xl font-display font-bold text-warning-foreground">{fmtCurrency(lifetimeSpend)}</div>
            </CardContent>
          </Card>
          <Card className={lifetimeProfit >= 0 ? "border-success/30" : "border-destructive/30"}>
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-3 rounded-xl ${lifetimeProfit >= 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                  <TrendingUp className="h-5 w-5" />
                </div>
                <div className="text-sm text-muted-foreground">صافي الربح</div>
              </div>
              <div className={`text-3xl font-display font-bold ${lifetimeProfit >= 0 ? "text-success" : "text-destructive"}`}>
                {fmtCurrency(lifetimeProfit)}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

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

      {/* Period summary — same 5 KPIs but for selected date range */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h3 className="font-display font-bold">ملخص الفترة المحددة</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card className="border-primary/30">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 rounded-xl bg-primary/10 text-primary"><ShoppingBag className="h-5 w-5" /></div>
                <div className="text-sm text-muted-foreground">إجمالي الطلبات</div>
              </div>
              <div className="text-3xl font-display font-bold">{fmtNumber(total)}</div>
              <div className="text-xs text-muted-foreground mt-1">{fmtPercent(totalRateOfLifetime)} من الإجمالي</div>
            </CardContent>
          </Card>
          <Card className="border-info/30">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 rounded-xl bg-info/15 text-info"><ShoppingBag className="h-5 w-5" /></div>
                <div className="text-sm text-muted-foreground">طلبات خرجت للشحن</div>
              </div>
              <div className="text-3xl font-display font-bold">{fmtNumber(shippedOrders)}</div>
              <div className="text-xs text-muted-foreground mt-1">{fmtPercent(shippedRate)} من الطلبات</div>
            </CardContent>
          </Card>
          <Card className="border-primary/30">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 rounded-xl bg-primary/10 text-primary"><Package className="h-5 w-5" /></div>
                <div className="text-sm text-muted-foreground">إجمالي القطع المباعة</div>
              </div>
              <div className="text-3xl font-display font-bold">{fmtNumber(totalPiecesInRange)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                متوسط {total > 0 ? (totalPiecesInRange / total).toFixed(2) : "0"} قطعة/طلب
              </div>
            </CardContent>
          </Card>
          <Card className="border-success/30">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 rounded-xl bg-success/15 text-success"><DollarSign className="h-5 w-5" /></div>
                <div className="text-sm text-muted-foreground">الربح المحقق الفعلي</div>
              </div>
              <div className="text-3xl font-display font-bold text-success">{fmtCurrency(netCommissions)}</div>
              <div className="text-xs text-muted-foreground mt-1">{fmtPercent(netRateOfGross)} من العمولات</div>
            </CardContent>
          </Card>
          <Card className="border-warning/30">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 rounded-xl bg-warning/15 text-warning-foreground"><Wallet className="h-5 w-5" /></div>
                <div className="text-sm text-muted-foreground">إجمالي الإنفاق الإعلاني</div>
              </div>
              <div className="text-3xl font-display font-bold text-warning-foreground">{fmtCurrency(totalSpend)}</div>
              <div className="text-xs text-muted-foreground mt-1">{fmtPercent(spendRateOfNet)} من الربح</div>
            </CardContent>
          </Card>
          <Card className={periodProfit >= 0 ? "border-success/30" : "border-destructive/30"}>
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-3 rounded-xl ${periodProfit >= 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                  <TrendingUp className="h-5 w-5" />
                </div>
                <div className="text-sm text-muted-foreground">صافي الربح</div>
              </div>
              <div className={`text-3xl font-display font-bold ${periodProfit >= 0 ? "text-success" : "text-destructive"}`}>
                {fmtCurrency(periodProfit)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">هامش {fmtPercent(profitMargin)}</div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Status counts — merged groups */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">عدد الطلبات حسب الحالة في الفترة</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 text-center">
            {mergedStatusGroups.map((g) => {
              const pct = total > 0 ? g.count / total : 0;
              return (
                <div key={g.key} className="rounded-lg border p-3">
                  <span
                    className={
                      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium " +
                      (g.color === "success"
                        ? "bg-success/15 text-success"
                        : g.color === "destructive"
                        ? "bg-destructive/15 text-destructive"
                        : g.color === "warning"
                        ? "bg-warning/15 text-warning-foreground"
                        : "bg-info/15 text-info")
                    }
                  >
                    {g.label}
                  </span>
                  <div className="text-lg font-bold mt-2">{fmtNumber(g.count)}</div>
                  <div className="text-xs text-muted-foreground">{fmtPercent(pct)}</div>
                </div>
              );
            })}
          </div>
          <div className="text-sm text-muted-foreground mt-4">
            معدل التسليم: <span className="font-medium text-foreground">{fmtPercent(shippedOrders > 0 ? delivered / shippedOrders : 0)}</span>
            <span className="text-xs text-muted-foreground mr-1">من الطلبات التي خرجت للشحن</span>
          </div>
        </CardContent>
      </Card>

      {/* Top 5 products chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-3 flex-wrap">
            <span>أهم 5 منتجات في الفترة</span>
            <span className="text-sm font-normal text-muted-foreground">
              إجمالي القطع في الفترة:{" "}
              <span className="font-bold text-foreground">{fmtNumber(totalPiecesInRange)}</span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topProducts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">لا توجد بيانات</div>
          ) : (
            <>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProducts} layout="vertical" margin={{ left: 20, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" allowDecimals={false} className="text-xs" />
                    <YAxis type="category" dataKey="name" width={180} className="text-xs" />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                      formatter={(v: any) => [v, "عدد القطع"]}
                    />
                    <Bar dataKey="qty" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المنتج</TableHead>
                      <TableHead className="text-center">عدد القطع</TableHead>
                      <TableHead className="text-center">عدد الطلبات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topProducts.map((p) => (
                      <TableRow key={p.name}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-center font-bold">{fmtNumber(p.qty)}</TableCell>
                        <TableCell className="text-center">{fmtNumber(p.orders)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

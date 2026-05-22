import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency, fmtNumber, fmtPercent, fmtDate } from "@/lib/format";
import { fetchAll } from "@/lib/fetch-all";
import { ORDER_STATUS } from "@/lib/constants";
import { KpiCard } from "@/components/KpiCard";
import { Package, Truck, CheckCircle2, RotateCcw } from "lucide-react";
import { ArrowRight } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_authenticated/products/$name")({
  component: ProductDetail,
});

type Item = {
  order_id: string;
  base_product_name: string;
  product_option: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  order_status: string;
  marketer_code: string | null;
  shipping_company: string | null;
  commission_share: number;
  orders?: { order_date: string | null; customer_name: string | null; external_order_id: string | null } | null;
};

const SHIPPED = ["in_delivery", "delivered", "done", "refund_request", "refunded"];
const DELIVERED = ["delivered", "done"];
const REFUNDED = ["refunded", "refund_request"];

function ProductDetail() {
  const { name } = Route.useParams();
  const decodedName = decodeURIComponent(name);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["product-detail", decodedName, from, to],
    queryFn: () =>
      fetchAll<Item>((a, b) => {
        let q = supabase.from("order_items")
          .select("order_id, base_product_name, product_option, color, size, quantity, order_status, marketer_code, shipping_company, commission_share, orders!inner(order_date, customer_name, external_order_id)")
          .eq("base_product_name", decodedName);
        if (from) q = q.gte("orders.order_date", from);
        if (to) q = q.lte("orders.order_date", to);
        return q.range(a, b) as any;
      }),
  });

  const sumQ = (list: Item[], statuses: string[]) =>
    list.filter((x) => statuses.includes(x.order_status)).reduce((s, x) => s + Number(x.quantity || 0), 0);

  const overall = useMemo(() => {
    const totalPieces = items.reduce((s, x) => s + Number(x.quantity || 0), 0);
    const orders = new Set(items.map((x) => x.order_id)).size;
    const delivered = sumQ(items, DELIVERED);
    const shipped = sumQ(items, SHIPPED);
    const refunded = sumQ(items, REFUNDED);
    return { totalPieces, orders, delivered, shipped, refunded };
  }, [items]);

  const variants = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      const key = it.product_option ?? "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries()).map(([opt, list]) => {
      const total = list.reduce((s, x) => s + Number(x.quantity || 0), 0);
      const delivered = sumQ(list, DELIVERED);
      const shipped = sumQ(list, SHIPPED);
      const refunded = sumQ(list, REFUNDED);
      return {
        option: opt,
        color: list[0]?.color ?? "",
        size: list[0]?.size ?? "",
        total,
        delivered,
        ordersCount: new Set(list.map((x) => x.order_id)).size,
        deliveryRate: total > 0 ? delivered / total : 0,
        refundRate: shipped > 0 ? refunded / shipped : 0,
      };
    }).sort((a, b) => b.total - a.total);
  }, [items]);

  const topMarketers = useMemo(() => {
    const map = new Map<string, { pieces: number; delivered: number; orders: Set<string> }>();
    for (const it of items) {
      const k = it.marketer_code ?? "—";
      if (!map.has(k)) map.set(k, { pieces: 0, delivered: 0, orders: new Set() });
      const m = map.get(k)!;
      m.pieces += Number(it.quantity || 0);
      if (DELIVERED.includes(it.order_status)) m.delivered += Number(it.quantity || 0);
      m.orders.add(it.order_id);
    }
    return Array.from(map.entries()).map(([code, v]) => ({
      code, pieces: v.pieces, delivered: v.delivered, orders: v.orders.size,
      rate: v.pieces > 0 ? v.delivered / v.pieces : 0,
    })).sort((a, b) => b.pieces - a.pieces).slice(0, 10);
  }, [items]);

  const topShipping = useMemo(() => {
    const map = new Map<string, { pieces: number; delivered: number; shipped: number }>();
    for (const it of items) {
      const k = it.shipping_company ?? "—";
      if (!map.has(k)) map.set(k, { pieces: 0, delivered: 0, shipped: 0 });
      const m = map.get(k)!;
      m.pieces += Number(it.quantity || 0);
      if (DELIVERED.includes(it.order_status)) m.delivered += Number(it.quantity || 0);
      if (SHIPPED.includes(it.order_status)) m.shipped += Number(it.quantity || 0);
    }
    return Array.from(map.entries()).map(([n, v]) => ({
      name: n, ...v, rate: v.shipped > 0 ? v.delivered / v.shipped : 0,
    })).sort((a, b) => b.pieces - a.pieces).slice(0, 10);
  }, [items]);

  const trend = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) {
      const d = it.orders?.order_date;
      if (!d) continue;
      map.set(d, (map.get(d) ?? 0) + Number(it.quantity || 0));
    }
    return Array.from(map.entries()).map(([date, pieces]) => ({ date, pieces }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link to="/products" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
            <ArrowRight className="h-3 w-3" /> العودة للمنتجات
          </Link>
          <h2 className="text-2xl font-display font-bold mt-1">{decodedName}</h2>
        </div>
      </div>

      <Card className="p-4 flex flex-wrap gap-3">
        <div><Label className="text-xs">من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></div>
        <div><Label className="text-xs">إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="إجمالي القطع" value={fmtNumber(overall.totalPieces)} icon={Package} />
        <KpiCard label="الطلبات" value={fmtNumber(overall.orders)} icon={Package} tone="info" />
        <KpiCard label="قطع شحنت" value={fmtNumber(overall.shipped)} icon={Truck} tone="warning" />
        <KpiCard label="قطع تم تسليمها" value={fmtNumber(overall.delivered)} icon={CheckCircle2} tone="success" />
        <KpiCard label="قطع مرتجعة" value={fmtNumber(overall.refunded)} icon={RotateCcw} tone="destructive" />
        <KpiCard label="نسبة التسليم/الإجمالي" value={fmtPercent(overall.totalPieces > 0 ? overall.delivered / overall.totalPieces : 0)} tone="success" />
        <KpiCard label="نسبة التسليم/المشحون" value={fmtPercent(overall.shipped > 0 ? overall.delivered / overall.shipped : 0)} tone="success" />
        <KpiCard label="نسبة الإرجاع" value={fmtPercent(overall.shipped > 0 ? overall.refunded / overall.shipped : 0)} tone="destructive" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">المتغيرات (لون / مقاس)</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>الخيار</TableHead><TableHead>اللون</TableHead><TableHead>المقاس</TableHead>
              <TableHead>إجمالي القطع</TableHead><TableHead>قطع تم تسليمها</TableHead>
              <TableHead>عدد الطلبات</TableHead><TableHead>نسبة التسليم</TableHead><TableHead>نسبة الإرجاع</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {variants.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
              ) : variants.map((v) => (
                <TableRow key={v.option}>
                  <TableCell className="font-medium">{v.option}</TableCell>
                  <TableCell>{v.color || "—"}</TableCell>
                  <TableCell>{v.size || "—"}</TableCell>
                  <TableCell>{fmtNumber(v.total)}</TableCell>
                  <TableCell>{fmtNumber(v.delivered)}</TableCell>
                  <TableCell>{fmtNumber(v.ordersCount)}</TableCell>
                  <TableCell>{fmtPercent(v.deliveryRate)}</TableCell>
                  <TableCell>{fmtPercent(v.refundRate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">أفضل المسوّقين</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>الكود</TableHead><TableHead>قطع</TableHead><TableHead>تم تسليمها</TableHead><TableHead>طلبات</TableHead><TableHead>نسبة التسليم</TableHead></TableRow></TableHeader>
              <TableBody>
                {topMarketers.map((m) => (
                  <TableRow key={m.code}>
                    <TableCell dir="ltr">{m.code}</TableCell>
                    <TableCell>{fmtNumber(m.pieces)}</TableCell>
                    <TableCell>{fmtNumber(m.delivered)}</TableCell>
                    <TableCell>{fmtNumber(m.orders)}</TableCell>
                    <TableCell>{fmtPercent(m.rate)}</TableCell>
                  </TableRow>
                ))}
                {topMarketers.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">—</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">أفضل شركات الشحن</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>الشركة</TableHead><TableHead>قطع</TableHead><TableHead>شحنت</TableHead><TableHead>تم تسليمها</TableHead><TableHead>نسبة التسليم/المشحون</TableHead></TableRow></TableHeader>
              <TableBody>
                {topShipping.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>{fmtNumber(s.pieces)}</TableCell>
                    <TableCell>{fmtNumber(s.shipped)}</TableCell>
                    <TableCell>{fmtNumber(s.delivered)}</TableCell>
                    <TableCell>{fmtPercent(s.rate)}</TableCell>
                  </TableRow>
                ))}
                {topShipping.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">—</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">الاتجاه اليومي (قطع)</CardTitle></CardHeader>
        <CardContent className="h-72">
          {trend.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">لا توجد بيانات</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="pieces" stroke="hsl(var(--primary))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">طلبات المنتج</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>رقم الطلب</TableHead><TableHead>التاريخ</TableHead><TableHead>العميل</TableHead>
              <TableHead>الخيار</TableHead><TableHead>الكمية</TableHead><TableHead>المسوّق</TableHead>
              <TableHead>الشحن</TableHead><TableHead>الحالة</TableHead><TableHead>عمولة</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">جارٍ التحميل…</TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">لا توجد طلبات</TableCell></TableRow>
              ) : items.slice(0, 200).map((it, i) => (
                <TableRow key={i}>
                  <TableCell dir="ltr" className="text-xs">{it.orders?.external_order_id ?? "—"}</TableCell>
                  <TableCell className="text-xs">{fmtDate(it.orders?.order_date ?? null)}</TableCell>
                  <TableCell className="text-xs">{it.orders?.customer_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{it.product_option ?? "—"}</TableCell>
                  <TableCell>{fmtNumber(it.quantity)}</TableCell>
                  <TableCell dir="ltr" className="text-xs">{it.marketer_code ?? "—"}</TableCell>
                  <TableCell className="text-xs">{it.shipping_company ?? "—"}</TableCell>
                  <TableCell className="text-xs">{(ORDER_STATUS as any)[it.order_status]?.label ?? it.order_status}</TableCell>
                  <TableCell>{fmtCurrency(it.commission_share)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {items.length > 200 && (
            <div className="p-2 text-xs text-muted-foreground text-center border-t">عرض أول 200 من {items.length}</div>
          )}
        </div>
      </Card>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/format";
import { fetchAll } from "@/lib/fetch-all";
import { parseProductField } from "@/lib/parse-product";
import { KpiCard } from "@/components/KpiCard";
import { Loader2, RefreshCw, Package, CheckCircle2, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/products")({
  component: ProductsPerf,
});

type ItemRow = {
  order_id: string;
  base_product_name: string;
  quantity: number;
  order_status: string;
  commission_share: number;
  orders?: { order_date: string | null } | null;
};

function ProductsPerf() {
  const qc = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [backfilling, setBackfilling] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["product-items", from, to],
    queryFn: () =>
      fetchAll<ItemRow>((a, b) => {
        const select = "order_id, base_product_name, quantity, order_status, commission_share, orders!inner(order_date)";
        let q = supabase.from("order_items").select(select);
        if (from) q = q.gte("orders.order_date", from);
        if (to) q = q.lte("orders.order_date", to);
        return q.range(a, b) as any;
      }),
  });

  const rows = useMemo(() => {
    const byName = new Map<string, ItemRow[]>();
    for (const it of items) {
      const k = it.base_product_name;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k)!.push(it);
    }
    const out = Array.from(byName.entries()).map(([name, list]) => {
      const orderIds = new Set(list.map((x) => x.order_id));
      const totalOrders = orderIds.size;
      const totalPieces = list.reduce((s, x) => s + Number(x.quantity || 0), 0);
      const sumQtyByStatus = (statuses: string[]) =>
        list.filter((x) => statuses.includes(x.order_status)).reduce((s, x) => s + Number(x.quantity || 0), 0);
      const deliveredPieces = sumQtyByStatus(["delivered", "done"]);
      const shippedPieces = sumQtyByStatus(["in_delivery", "delivered", "done", "refund_request", "refunded"]);
      const refundedPieces = sumQtyByStatus(["refunded", "refund_request"]);
      const pendingPieces = sumQtyByStatus(["pending"]);
      const deliveredOrders = new Set(
        list.filter((x) => x.order_status === "delivered" || x.order_status === "done").map((x) => x.order_id),
      ).size;
      const grossProfit = list.reduce((s, x) => s + Number(x.commission_share || 0), 0);
      const realizedProfit = list
        .filter((x) => x.order_status === "delivered" || x.order_status === "done")
        .reduce((s, x) => s + Number(x.commission_share || 0), 0);
      return {
        name,
        totalOrders,
        totalPieces,
        deliveredOrders,
        deliveredPieces,
        shippedPieces,
        refundedPieces,
        pendingPieces,
        deliveryRateFromTotal: totalPieces > 0 ? deliveredPieces / totalPieces : 0,
        deliveryRateFromShipped: shippedPieces > 0 ? deliveredPieces / shippedPieces : 0,
        refundRate: shippedPieces > 0 ? refundedPieces / shippedPieces : 0,
        avgPerOrder: totalOrders > 0 ? totalPieces / totalOrders : 0,
        grossProfit,
        realizedProfit,
      };
    });
    return out.sort((a, b) => b.totalPieces - a.totalPieces);
  }, [items]);

  // Backfill order_items for existing orders by parsing raw_data
  async function backfill() {
    if (!confirm("سيتم إعادة بناء عناصر الطلبات من البيانات الأصلية. متابعة؟")) return;
    setBackfilling(true);
    try {
      // Latest saved column mapping → find product_name source column
      const { data: mappings } = await supabase
        .from("column_mappings").select("mapping").order("created_at", { ascending: false }).limit(20);
      const productCols = Array.from(
        new Set(((mappings ?? []).map((m: any) => m.mapping?.product_name).filter(Boolean) as string[])),
      );
      if (productCols.length === 0) {
        toast.error("لا يوجد قالب أعمدة محفوظ — لا يمكن العثور على عمود اسم المنتج");
        setBackfilling(false); return;
      }

      const orders = await fetchAll<any>((a, b) =>
        supabase.from("orders")
          .select("id, external_order_id, status, marketer_id, commission, raw_data, marketers(marketer_code), shipping_companies(name)")
          .range(a, b),
      );
      if (orders.length === 0) { toast.info("لا توجد طلبات"); setBackfilling(false); return; }

      let processed = 0;
      let parsed = 0;
      for (const o of orders) {
        // Find the product text from raw_data using any known mapping column
        let txt: unknown = null;
        for (const col of productCols) {
          const v = o.raw_data?.[col];
          if (v) { txt = v; break; }
        }
        const itemsParsed = parseProductField(txt);
        await supabase.from("order_items").delete().eq("order_id", o.id);
        if (itemsParsed.length > 0) {
          const totalQty = itemsParsed.reduce((s, x) => s + x.quantity, 0) || 1;
          const rowsToInsert = itemsParsed.map((it) => ({
            order_id: o.id,
            order_number: o.external_order_id,
            base_product_name: it.base_product_name,
            product_option: it.product_option,
            color: it.color,
            size: it.size,
            quantity: it.quantity,
            raw_product_text: it.raw_product_text,
            order_status: o.status,
            marketer_id: o.marketer_id,
            marketer_code: o.marketers?.marketer_code ?? null,
            shipping_company: o.shipping_companies?.name ?? null,
            commission_share: (Number(o.commission) || 0) * (it.quantity / totalQty),
          }));
          const { error } = await supabase.from("order_items").insert(rowsToInsert);
          if (error) console.error("backfill insert err:", error);
          else parsed += itemsParsed.length;
        }
        processed++;
      }
      toast.success(`تم: ${processed} طلب • ${parsed} عنصر`);
      qc.invalidateQueries({ queryKey: ["product-items"] });
    } catch (e) {
      console.error(e);
      toast.error("فشل إعادة البناء");
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-display font-bold">أداء المنتجات</h2>
          <p className="text-sm text-muted-foreground">إحصائيات حسب الاسم الأساسي للمنتج (مجمّعة عبر الألوان والمقاسات)</p>
        </div>
        <Button variant="outline" onClick={backfill} disabled={backfilling}>
          {backfilling ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <RefreshCw className="ml-2 h-4 w-4" />}
          إعادة بناء عناصر الطلبات
        </Button>
      </div>
      <Card className="p-4 flex flex-wrap gap-3">
        <div><Label className="text-xs">من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></div>
        <div><Label className="text-xs">إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></div>
      </Card>
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>المنتج</TableHead>
              <TableHead>الطلبات</TableHead>
              <TableHead>القطع</TableHead>
              <TableHead>متوسط القطع/طلب</TableHead>
              <TableHead>تم التسليم</TableHead>
              <TableHead>قطع شحنت</TableHead>
              <TableHead>قطع مرتجعة</TableHead>
              <TableHead>قطع معلقة</TableHead>
              <TableHead>تسليم/الإجمالي</TableHead>
              <TableHead>تسليم/المشحون</TableHead>
              <TableHead>نسبة الإرجاع</TableHead>
              <TableHead>الربح الإجمالي</TableHead>
              <TableHead>الربح المحقق</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">جارٍ التحميل…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">لا توجد بيانات — قم بالاستيراد أو اضغط "إعادة بناء عناصر الطلبات"</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-medium">
                    <Link to="/products/$name" params={{ name: encodeURIComponent(r.name) }} className="text-primary hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell>{fmtNumber(r.totalOrders)}</TableCell>
                  <TableCell>{fmtNumber(r.totalPieces)}</TableCell>
                  <TableCell>{r.avgPerOrder.toFixed(2)}</TableCell>
                  <TableCell>{fmtNumber(r.deliveredPieces)}</TableCell>
                  <TableCell>{fmtNumber(r.shippedPieces)}</TableCell>
                  <TableCell>{fmtNumber(r.refundedPieces)}</TableCell>
                  <TableCell>{fmtNumber(r.pendingPieces)}</TableCell>
                  <TableCell>{fmtPercent(r.deliveryRateFromTotal)}</TableCell>
                  <TableCell>{fmtPercent(r.deliveryRateFromShipped)}</TableCell>
                  <TableCell>{fmtPercent(r.refundRate)}</TableCell>
                  <TableCell>{fmtCurrency(r.grossProfit)}</TableCell>
                  <TableCell>{fmtCurrency(r.realizedProfit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/products")({
  component: ProductsPerf,
});

function ProductsPerf() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*")).data ?? [],
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["products-orders", from, to],
    queryFn: async () => {
      let q = supabase.from("orders").select("product_id, status, commission, price");
      if (from) q = q.gte("order_date", from);
      if (to) q = q.lte("order_date", to);
      return (await q).data ?? [];
    },
  });

  const rows = useMemo(() => products.map((p) => {
    const list = orders.filter((o) => o.product_id === p.id);
    const total = list.length;
    const delivered = list.filter((o) => o.status === "delivered" || o.status === "done").length;
    const refunded = list.filter((o) => o.status === "refunded" || o.status === "refund_request").length;
    const revenue = list.reduce((s, o) => s + Number(o.price || 0), 0);
    const commission = list.reduce((s, o) => s + Number(o.commission || 0), 0);
    return {
      ...p, total, delivered, refunded, revenue, commission,
      rate: total > 0 ? delivered / total : 0,
    };
  }).sort((a, b) => b.total - a.total), [products, orders]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-display font-bold">أداء المنتجات</h2>
        <p className="text-sm text-muted-foreground">إحصائيات المنتجات حسب الفترة</p>
      </div>
      <Card className="p-4 flex flex-wrap gap-3">
        <div><Label className="text-xs">من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></div>
        <div><Label className="text-xs">إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></div>
      </Card>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>المنتج</TableHead><TableHead>SKU</TableHead>
            <TableHead>إجمالي الطلبات</TableHead><TableHead>تم التسليم</TableHead>
            <TableHead>مرتجع</TableHead><TableHead>معدل التسليم</TableHead>
            <TableHead>الإيراد</TableHead><TableHead>العمولات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">لا توجد منتجات</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell dir="ltr">{r.sku ?? "—"}</TableCell>
                <TableCell>{fmtNumber(r.total)}</TableCell>
                <TableCell>{fmtNumber(r.delivered)}</TableCell>
                <TableCell>{fmtNumber(r.refunded)}</TableCell>
                <TableCell>{fmtPercent(r.rate)}</TableCell>
                <TableCell>{fmtCurrency(r.revenue)}</TableCell>
                <TableCell>{fmtCurrency(r.commission)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

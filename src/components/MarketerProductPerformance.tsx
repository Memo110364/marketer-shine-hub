import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/format";
import { fetchAll } from "@/lib/fetch-all";
import { COMMISSION_EXCLUDED_STATUSES } from "@/lib/constants";
import { Package, FlaskConical } from "lucide-react";

type ItemRow = {
  order_id: string;
  base_product_name: string;
  quantity: number;
  order_status: string;
  commission_share: number;
};

type ProductRow = {
  name: string;
  totalOrders: number;
  totalPieces: number;
  deliveredPieces: number;
  shippedPieces: number;
  refundedPieces: number;
  pendingPieces: number;
  deliveryRateFromTotal: number;
  deliveryRateFromShipped: number;
  grossProfit: number;
  realizedProfit: number;
};

function buildRows(items: ItemRow[]): ProductRow[] {
  const byName = new Map<string, ItemRow[]>();
  for (const it of items) {
    const k = it.base_product_name;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(it);
  }
  const out = Array.from(byName.entries()).map(([name, list]) => {
    const orderIds = new Set(list.map((x) => x.order_id));
    const totalPieces = list.reduce((s, x) => s + Number(x.quantity || 0), 0);
    const sumQtyByStatus = (statuses: string[]) =>
      list.filter((x) => statuses.includes(x.order_status)).reduce((s, x) => s + Number(x.quantity || 0), 0);
    const deliveredPieces = sumQtyByStatus(["delivered", "done"]);
    const shippedPieces = sumQtyByStatus(["in_delivery", "delivered", "done", "refund_request", "refunded"]);
    const refundedPieces = sumQtyByStatus(["refunded", "refund_request"]);
    const pendingPieces = sumQtyByStatus(["pending"]);
    const grossProfit = list
      .filter((x) => !COMMISSION_EXCLUDED_STATUSES.includes(x.order_status as any))
      .reduce((s, x) => s + Number(x.commission_share || 0), 0);
    const realizedProfit = list
      .filter((x) => x.order_status === "delivered" || x.order_status === "done")
      .reduce((s, x) => s + Number(x.commission_share || 0), 0);
    return {
      name,
      totalOrders: orderIds.size,
      totalPieces,
      deliveredPieces,
      shippedPieces,
      refundedPieces,
      pendingPieces,
      deliveryRateFromTotal: totalPieces > 0 ? deliveredPieces / totalPieces : 0,
      deliveryRateFromShipped: shippedPieces > 0 ? deliveredPieces / shippedPieces : 0,
      grossProfit,
      realizedProfit,
    };
  });
  return out.sort((a, b) => b.totalPieces - a.totalPieces);
}

export function MarketerProductPerformance({ marketerId }: { marketerId: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["my-product-items", marketerId, from, to],
    queryFn: () =>
      fetchAll<ItemRow>((a, b) => {
        const select = "order_id, base_product_name, quantity, order_status, commission_share, orders!inner(order_date)";
        let q = supabase.from("order_items").select(select).eq("marketer_id", marketerId);
        if (from) q = q.gte("orders.order_date", from);
        if (to) q = q.lte("orders.order_date", to);
        return q.range(a, b) as any;
      }),
  });

  const { data: testedNames = new Set<string>() } = useQuery({
    queryKey: ["my-tested-product-names", marketerId, from, to],
    queryFn: async () => {
      let q = supabase
        .from("test_spend_entries")
        .select("product_name, products(name)")
        .eq("marketer_id", marketerId);
      if (from) q = q.gte("test_date", from);
      if (to) q = q.lte("test_date", to);
      const { data, error } = await q;
      if (error) throw error;
      const names = new Set<string>();
      for (const e of (data ?? []) as any[]) {
        const n = e.products?.name ?? e.product_name;
        if (n) names.add(n);
      }
      return names;
    },
  });

  const { testRows, regularRows } = useMemo(() => {
    const rows = buildRows(items);
    return {
      testRows: rows.filter((r) => testedNames.has(r.name)),
      regularRows: rows.filter((r) => !testedNames.has(r.name)),
    };
  }, [items, testedNames]);

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap gap-3 items-end">
        <div>
          <Label className="text-xs">من</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
        </div>
        <div>
          <Label className="text-xs">إلى</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
        </div>
      </Card>

      <ProductTable
        title="المنتجات اللي شغال عليها"
        icon={Package}
        rows={regularRows}
        isLoading={isLoading}
        emptyText="لا توجد بيانات منتجات في الفترة المحددة"
      />

      <ProductTable
        title="منتجات التيست"
        icon={FlaskConical}
        rows={testRows}
        isLoading={isLoading}
        emptyText="لا توجد منتجات تيست في الفترة المحددة"
      />
    </div>
  );
}

function ProductTable({
  title, icon: Icon, rows, isLoading, emptyText,
}: {
  title: string;
  icon: typeof Package;
  rows: ProductRow[];
  isLoading: boolean;
  emptyText: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المنتج</TableHead>
                <TableHead>القطع المباعة</TableHead>
                <TableHead>المسلّمة</TableHead>
                <TableHead>نسبة التسليم</TableHead>
                <TableHead>مرتجعة</TableHead>
                <TableHead>قيد الشحن</TableHead>
                <TableHead>الربح الإجمالي</TableHead>
                <TableHead>الربح المحقق</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">جارٍ التحميل…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">{emptyText}</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{fmtNumber(r.totalPieces)}</TableCell>
                  <TableCell>{fmtNumber(r.deliveredPieces)}</TableCell>
                  <TableCell>{fmtPercent(r.deliveryRateFromTotal)}</TableCell>
                  <TableCell>{fmtNumber(r.refundedPieces)}</TableCell>
                  <TableCell>{fmtNumber(r.shippedPieces - r.deliveredPieces - r.refundedPieces)}</TableCell>
                  <TableCell>{fmtCurrency(r.grossProfit)}</TableCell>
                  <TableCell>{fmtCurrency(r.realizedProfit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

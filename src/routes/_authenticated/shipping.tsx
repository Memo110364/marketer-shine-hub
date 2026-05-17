import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtNumber, fmtPercent } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/shipping")({
  component: ShippingPerf,
});

function ShippingPerf() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: companies = [] } = useQuery({
    queryKey: ["shipping"],
    queryFn: async () => (await supabase.from("shipping_companies").select("*")).data ?? [],
  });
  const { data: orders = [] } = useQuery({
    queryKey: ["shipping-orders", from, to],
    queryFn: async () => {
      let q = supabase.from("orders").select("shipping_company_id, status");
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-display font-bold">أداء شركات الشحن</h2>
        <p className="text-sm text-muted-foreground">معدلات التسليم لكل شركة شحن</p>
      </div>
      <Card className="p-4 flex flex-wrap gap-3">
        <div><Label className="text-xs">من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></div>
        <div><Label className="text-xs">إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></div>
      </Card>
      <Card>
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
              <TableRow key={r.id}>
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
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { ORDER_STATUS, ORDER_STATUS_KEYS, type OrderStatus } from "@/lib/constants";
import { Download, Upload, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/orders")({
  component: OrdersPage,
});

function OrdersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [marketerId, setMarketerId] = useState<string>("all");
  const [productId, setProductId] = useState<string>("all");
  const [shippingId, setShippingId] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: marketers = [] } = useQuery({
    queryKey: ["marketers-list"],
    queryFn: async () => (await supabase.from("marketers").select("id, name, marketer_code")).data ?? [],
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products-list"],
    queryFn: async () => (await supabase.from("products").select("id, name, sku")).data ?? [],
  });
  const { data: shippings = [] } = useQuery({
    queryKey: ["shipping-list"],
    queryFn: async () => (await supabase.from("shipping_companies").select("id, name")).data ?? [],
  });

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders", { status, marketerId, productId, shippingId, from, to }],
    queryFn: async () => {
      let q = supabase.from("orders").select("*").order("order_date", { ascending: false }).limit(500);
      if (status !== "all") q = q.eq("status", status);
      if (marketerId !== "all") q = q.eq("marketer_id", marketerId);
      if (productId !== "all") q = q.eq("product_id", productId);
      if (shippingId !== "all") q = q.eq("shipping_company_id", shippingId);
      if (from) q = q.gte("order_date", from);
      if (to) q = q.lte("order_date", to);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const marketerMap = useMemo(() => new Map(marketers.map((m) => [m.id, m])), [marketers]);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const filtered = useMemo(() => {
    if (!search) return orders;
    const s = search.toLowerCase();
    return orders.filter((o) =>
      [o.external_order_id, o.customer_name, o.customer_phone, o.governorate]
        .some((v) => v?.toLowerCase().includes(s))
    );
  }, [orders, search]);

  function exportCSV() {
    const rows = [
      ["رقم الطلب", "التاريخ", "المسوّق", "المنتج", "العميل", "الهاتف", "المحافظة", "الكمية", "السعر", "العمولة", "الحالة"],
      ...filtered.map((o) => [
        o.external_order_id ?? "", o.order_date ?? "",
        marketerMap.get(o.marketer_id ?? "")?.name ?? "",
        productMap.get(o.product_id ?? "")?.name ?? "",
        o.customer_name ?? "", o.customer_phone ?? "", o.governorate ?? "",
        o.quantity, o.price, o.commission, ORDER_STATUS[o.status as OrderStatus]?.label,
      ]),
    ];
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `orders-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-display font-bold">الطلبات</h2>
          <p className="text-sm text-muted-foreground">عرض وفلترة جميع الطلبات</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV}><Download className="h-4 w-4 ml-1" /> تصدير CSV</Button>
          <Button asChild><Link to="/orders/import"><Upload className="h-4 w-4 ml-1" /> استيراد</Link></Button>
        </div>
      </div>

      <Card className="p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div><Label className="text-xs">الحالة</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">جميع الحالات</SelectItem>
              {ORDER_STATUS_KEYS.map((k) => (
                <SelectItem key={k} value={k}>{ORDER_STATUS[k].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">المسوّق</Label>
          <Select value={marketerId} onValueChange={setMarketerId}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              {marketers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">المنتج</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">شركة الشحن</Label>
          <Select value={shippingId} onValueChange={setShippingId}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              {shippings.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">من تاريخ</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
        </div>
        <div><Label className="text-xs">إلى تاريخ</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
        </div>
        <div className="col-span-2 md:col-span-4 lg:col-span-6 relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="بحث برقم الطلب أو اسم العميل أو الهاتف..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="pr-9" />
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>رقم الطلب</TableHead>
            <TableHead>التاريخ</TableHead>
            <TableHead>المسوّق</TableHead>
            <TableHead>المنتج</TableHead>
            <TableHead>العميل</TableHead>
            <TableHead>المحافظة</TableHead>
            <TableHead>السعر</TableHead>
            <TableHead>العمولة</TableHead>
            <TableHead>الحالة</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8">جاري التحميل...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">لا توجد طلبات</TableCell></TableRow>
            ) : filtered.map((o) => (
              <TableRow key={o.id}>
                <TableCell dir="ltr" className="font-mono text-xs">{o.external_order_id ?? "—"}</TableCell>
                <TableCell>{fmtDate(o.order_date)}</TableCell>
                <TableCell>{marketerMap.get(o.marketer_id ?? "")?.name ?? "—"}</TableCell>
                <TableCell>{productMap.get(o.product_id ?? "")?.name ?? "—"}</TableCell>
                <TableCell>{o.customer_name ?? "—"}</TableCell>
                <TableCell>{o.governorate ?? "—"}</TableCell>
                <TableCell>{fmtCurrency(Number(o.price))}</TableCell>
                <TableCell>{fmtCurrency(Number(o.commission))}</TableCell>
                <TableCell><StatusBadge status={o.status as OrderStatus} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="p-3 text-xs text-muted-foreground border-t">عدد النتائج: {filtered.length}</div>
      </Card>
    </div>
  );
}

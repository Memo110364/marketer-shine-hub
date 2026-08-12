import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { ORDER_STATUS, type OrderStatus } from "@/lib/constants";
import { fetchAll } from "@/lib/fetch-all";
import { Download, Upload, Search, ArrowRight, Loader2, PackageSearch } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/orders/")({
  component: OrdersPage,
});

const DAYS_SHOWN = 30;
const FULL_EXPORT_MAX_DAYS = 60;

// Page-specific grouping — not the same thing as the literal 'pending'
// order_status. "معلق" here means "still needs follow-up with the shipping
// company": brand new, in delivery, or a return request that hasn't been
// resolved yet. Matches the bucket used by get_daily_order_summary().
const PENDING_BUCKET_STATUSES: OrderStatus[] = ["pending", "in_delivery", "refund_request"];
const DELIVERED_BUCKET_STATUSES: OrderStatus[] = ["delivered", "done"];
const RETURNED_BUCKET_STATUSES: OrderStatus[] = ["refunded"];
// Cancelled before shipping — not followed up with the shipping company,
// but the confirmations team still tracks these (call quality, drop-offs).
const CANCELLED_BUCKET_STATUSES: OrderStatus[] = ["cancelled"];

type DailyRow = {
  order_date: string;
  total: number;
  delivered: number;
  returned: number;
  pending: number;
  cancelled: number;
  shipped: number;
};
type Bucket = "all" | "delivered" | "returned" | "pending" | "cancelled";

const BUCKET_STATUSES: Record<Bucket, OrderStatus[] | null> = {
  all: null,
  delivered: DELIVERED_BUCKET_STATUSES,
  returned: RETURNED_BUCKET_STATUSES,
  pending: PENDING_BUCKET_STATUSES,
  cancelled: CANCELLED_BUCKET_STATUSES,
};

const BUCKET_LABEL: Record<Bucket, string> = {
  all: "كل الحالات",
  delivered: "تم التسليم",
  returned: "مرتجع",
  pending: "معلق",
  cancelled: "ملغي",
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function OrdersPage() {
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - (DAYS_SHOWN - 1));
    return isoDate(d);
  }, [today]);
  const defaultTo = useMemo(() => isoDate(today), [today]);

  const [pendingOnly, setPendingOnly] = useState(false);
  // The period shown in the day grid AND scoping the two range-bound
  // download buttons below — one control for both, so "the selected
  // period" always means the same thing everywhere on the page.
  const [rangeFrom, setRangeFrom] = useState(defaultFrom);
  const [rangeTo, setRangeTo] = useState(defaultTo);
  const [drillDown, setDrillDown] = useState<{ date: string; bucket: Bucket } | null>(null);
  const [downloading, setDownloading] = useState<null | "allPending" | "rangePending" | "rangeAll">(null);

  const rangeValid = !!rangeFrom && !!rangeTo && rangeFrom <= rangeTo;
  const rangeDayCount = rangeValid
    ? Math.round((new Date(rangeTo).getTime() - new Date(rangeFrom).getTime()) / 86400000) + 1
    : 0;
  const rangeTooLongForFullExport = rangeDayCount > FULL_EXPORT_MAX_DAYS;

  // Detail-view-only filters (marketer/product/shipping/search) — only
  // relevant once you've drilled into a specific day.
  const [search, setSearch] = useState("");
  const [marketerId, setMarketerId] = useState("all");
  const [productId, setProductId] = useState("all");
  const [shippingId, setShippingId] = useState("all");

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
  const marketerMap = useMemo(() => new Map(marketers.map((m) => [m.id, m])), [marketers]);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // One aggregate query for the whole period instead of pulling every order
  // row to the browser and counting client-side — stays fast no matter how
  // many thousand orders are in range, and no matter how wide the range is
  // (it's still just one grouped row per day).
  const { data: dailySummary = [], isLoading: loadingSummary } = useQuery({
    queryKey: ["orders-daily-summary", rangeFrom, rangeTo],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_daily_order_summary", {
        _from: rangeFrom, _to: rangeTo,
      });
      if (error) throw error;
      return (data ?? []) as DailyRow[];
    },
    enabled: rangeValid,
  });

  const visibleDays = useMemo(
    () => (pendingOnly ? dailySummary.filter((d) => d.pending > 0) : dailySummary),
    [dailySummary, pendingOnly],
  );

  const { data: detailOrders = [], isLoading: loadingDetail } = useQuery({
    queryKey: ["orders-detail", drillDown, marketerId, productId, shippingId],
    queryFn: async () => {
      if (!drillDown) return [];
      let q = supabase.from("orders").select("*").eq("order_date", drillDown.date);
      const statuses = BUCKET_STATUSES[drillDown.bucket];
      if (statuses) q = q.in("status", statuses);
      if (marketerId !== "all") q = q.eq("marketer_id", marketerId);
      if (productId !== "all") q = q.eq("product_id", productId);
      if (shippingId !== "all") q = q.eq("shipping_company_id", shippingId);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(5000);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!drillDown,
  });

  const filteredDetail = useMemo(() => {
    if (!search) return detailOrders;
    const s = search.toLowerCase();
    return detailOrders.filter((o) =>
      [o.external_order_id, o.customer_name, o.customer_phone, o.governorate]
        .some((v) => v?.toLowerCase().includes(s)),
    );
  }, [detailOrders, search]);

  function openDay(date: string, bucket: Bucket) {
    setSearch(""); setMarketerId("all"); setProductId("all"); setShippingId("all");
    setDrillDown({ date, bucket });
  }

  function exportDetailCSV() {
    const rows = [
      ["رقم الطلب", "التاريخ", "المسوّق", "المنتج", "العميل", "الهاتف", "المحافظة", "الكمية", "السعر", "العمولة", "الحالة"],
      ...filteredDetail.map((o) => [
        o.external_order_id ?? "", o.order_date ?? "",
        marketerMap.get(o.marketer_id ?? "")?.name ?? "",
        productMap.get(o.product_id ?? "")?.name ?? "",
        o.customer_name ?? "", o.customer_phone ?? "", o.governorate ?? "",
        o.quantity, o.price, o.commission, ORDER_STATUS[o.status as OrderStatus]?.label,
      ]),
    ];
    const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders-${drillDown?.date ?? Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadOrders(opts: {
    kind: "allPending" | "rangePending" | "rangeAll";
    statuses?: OrderStatus[];
    from?: string;
    to?: string;
    filenamePrefix: string;
    emptyMessage: string;
  }) {
    setDownloading(opts.kind);
    try {
      const rows = await fetchAll<any>((from, to) => {
        let q = supabase
          .from("orders")
          .select("external_order_id, customer_name, customer_phone, governorate, quantity, price, commission, status, order_date, marketers(marketer_code, name), products(sku, name), shipping_companies(name)")
          .order("order_date", { ascending: true });
        if (opts.statuses) q = q.in("status", opts.statuses);
        if (opts.from) q = q.gte("order_date", opts.from);
        if (opts.to) q = q.lte("order_date", opts.to);
        return q.range(from, to);
      });
      if (rows.length === 0) { toast.info(opts.emptyMessage); return; }
      const sheet = rows.map((r: any) => ({
        "رقم الطلب": r.external_order_id ?? "",
        "كود المسوّق": r.marketers?.marketer_code ?? "",
        "اسم المسوّق": r.marketers?.name ?? "",
        "اسم المنتج": r.products?.name ?? "",
        "شركة الشحن": r.shipping_companies?.name ?? "",
        "اسم العميل": r.customer_name ?? "",
        "رقم العميل": r.customer_phone ?? "",
        "المحافظة": r.governorate ?? "",
        "الكمية": r.quantity ?? 0,
        "السعر": r.price ?? 0,
        "الحالة": ORDER_STATUS[r.status as OrderStatus]?.label ?? r.status,
        "تاريخ الطلب": r.order_date ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(sheet);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Orders");
      XLSX.writeFile(wb, `${opts.filenamePrefix}-${isoDate(new Date())}.xlsx`);
      toast.success(`تم تنزيل ${rows.length} طلب`);
    } catch (e) {
      console.error(e);
      toast.error("فشل تنزيل الملف");
    } finally {
      setDownloading(null);
    }
  }

  // Every order still open with a shipping company, across all time — not
  // scoped to the selected period — so this is the one place to grab the
  // full follow-up list in one go.
  const downloadAllPending = () => downloadOrders({
    kind: "allPending",
    statuses: PENDING_BUCKET_STATUSES,
    filenamePrefix: "pending-orders-all",
    emptyMessage: "لا توجد طلبات معلقة حاليًا",
  });

  const downloadPendingInRange = () => downloadOrders({
    kind: "rangePending",
    statuses: PENDING_BUCKET_STATUSES,
    from: rangeFrom, to: rangeTo,
    filenamePrefix: `pending-orders-${rangeFrom}-to-${rangeTo}`,
    emptyMessage: "لا توجد طلبات معلقة في الفترة المحددة",
  });

  const downloadAllInRange = () => downloadOrders({
    kind: "rangeAll",
    from: rangeFrom, to: rangeTo,
    filenamePrefix: `orders-${rangeFrom}-to-${rangeTo}`,
    emptyMessage: "لا توجد طلبات في الفترة المحددة",
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-display font-bold">الطلبات</h2>
          <p className="text-sm text-muted-foreground">
            {drillDown
              ? `${fmtDate(drillDown.date)} — ${BUCKET_LABEL[drillDown.bucket]}`
              : rangeValid
                ? `${fmtDate(rangeFrom)} — ${fmtDate(rangeTo)} — مقسّمة يوم بيوم`
                : "اختر فترة صحيحة (من تاريخ قبل إلى تاريخ)"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild><Link to="/orders/import"><Upload className="h-4 w-4 ml-1" /> استيراد</Link></Button>
        </div>
      </div>

      {!drillDown && (
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">من تاريخ</Label>
              <Input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">إلى تاريخ</Label>
              <Input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className="h-9" />
            </div>
            {!rangeValid && (
              <span className="text-xs text-destructive pb-1.5">التاريخ "من" لازم يكون قبل أو يساوي "إلى"</span>
            )}
            <div className="flex items-center gap-2 pb-1.5">
              <Switch id="pending-only" checked={pendingOnly} onCheckedChange={setPendingOnly} />
              <Label htmlFor="pending-only" className="text-sm cursor-pointer">إظهار الأيام اللي فيها طلبات معلقة فقط</Label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t">
            <Button onClick={downloadAllPending} disabled={downloading !== null} className="h-9 mt-3">
              {downloading === "allPending" ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Download className="h-4 w-4 ml-1" />}
              تحميل كل الطلبات المعلقة
            </Button>
            <Button
              variant="outline"
              onClick={downloadPendingInRange}
              disabled={downloading !== null || !rangeValid}
              className="h-9 mt-3"
            >
              {downloading === "rangePending" ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Download className="h-4 w-4 ml-1" />}
              تحميل الطلبات المعلقة في الفترة المحددة
            </Button>
            <Button
              variant="outline"
              onClick={downloadAllInRange}
              disabled={downloading !== null || !rangeValid || rangeTooLongForFullExport}
              className="h-9 mt-3"
              title={rangeTooLongForFullExport ? `متاح فقط لفترة ${FULL_EXPORT_MAX_DAYS} يوم أو أقل` : undefined}
            >
              {downloading === "rangeAll" ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Download className="h-4 w-4 ml-1" />}
              تحميل جميع الطلبات في الفترة المحددة
            </Button>
            {rangeTooLongForFullExport && (
              <span className="text-xs text-muted-foreground mt-3">
                (تحميل كل الطلبات متاح لفترة {FULL_EXPORT_MAX_DAYS} يوم أو أقل — الفترة الحالية {rangeDayCount} يوم)
              </span>
            )}
          </div>
        </Card>
      )}

      {!drillDown && (
        !rangeValid ? null : loadingSummary ? (
          <Card className="p-8 text-center text-muted-foreground">جاري التحميل...</Card>
        ) : visibleDays.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            {pendingOnly ? "مفيش أيام فيها طلبات معلقة في الفترة المحددة" : "لا توجد طلبات في الفترة المحددة"}
          </Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {visibleDays.map((d) => (
              <Card
                key={d.order_date}
                className={
                  d.pending > 0
                    ? "p-3 border-warning/50 bg-warning/5 space-y-2"
                    : "p-3 space-y-2"
                }
              >
                <button
                  type="button"
                  onClick={() => openDay(d.order_date, "all")}
                  className="w-full text-right"
                >
                  <div className="text-xs text-muted-foreground">{fmtDate(d.order_date)}</div>
                  <div className="flex items-baseline gap-2">
                    <div className="text-2xl font-display font-bold">{d.total}</div>
                    <div className="text-[11px] text-muted-foreground">
                      خرج للشحن: <b className="text-foreground">{d.shipped}</b>
                    </div>
                  </div>
                </button>
                <div className="grid grid-cols-4 gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => openDay(d.order_date, "delivered")}
                    className="rounded-md bg-success/10 text-success border border-success/25 py-1 hover:bg-success/20 transition-colors"
                  >
                    تسليم<br /><b>{d.delivered}</b>
                  </button>
                  <button
                    type="button"
                    onClick={() => openDay(d.order_date, "returned")}
                    className="rounded-md bg-destructive/10 text-destructive border border-destructive/25 py-1 hover:bg-destructive/20 transition-colors"
                  >
                    مرتجع<br /><b>{d.returned}</b>
                  </button>
                  <button
                    type="button"
                    onClick={() => openDay(d.order_date, "pending")}
                    className="rounded-md bg-warning/15 text-warning-foreground border border-warning/40 py-1 font-bold hover:bg-warning/25 transition-colors"
                  >
                    معلق<br /><b>{d.pending}</b>
                  </button>
                  <button
                    type="button"
                    onClick={() => openDay(d.order_date, "cancelled")}
                    className="rounded-md bg-muted text-muted-foreground border border-border py-1 hover:bg-muted/70 transition-colors"
                  >
                    ملغي<br /><b>{d.cancelled}</b>
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {drillDown && (
        <>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDrillDown(null)}>
              <ArrowRight className="h-4 w-4 ml-1" /> رجوع لعرض الأيام
            </Button>
            <Button variant="outline" size="sm" onClick={exportDetailCSV}>
              <Download className="h-4 w-4 ml-1" /> تصدير CSV
            </Button>
          </div>

          <Card className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
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
            <div className="relative">
              <Label className="text-xs">بحث</Label>
              <Search className="absolute right-3 top-[34px] h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="رقم الطلب / اسم العميل / الهاتف..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pr-9"
              />
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
                {loadingDetail ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8">جاري التحميل...</TableCell></TableRow>
                ) : filteredDetail.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      <PackageSearch className="h-6 w-6 mx-auto mb-1 opacity-50" />
                      لا توجد طلبات
                    </TableCell>
                  </TableRow>
                ) : filteredDetail.map((o) => (
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
            <div className="p-3 text-xs text-muted-foreground border-t">عدد النتائج: {filteredDetail.length}</div>
          </Card>
        </>
      )}
    </div>
  );
}

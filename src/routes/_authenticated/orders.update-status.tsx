import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ORDER_STATUS, ORDER_STATUS_KEYS, normalizeStatus, type OrderStatus } from "@/lib/constants";
import { parseExcelDate } from "@/lib/format";
import { Upload, Loader2, CheckCircle2, AlertTriangle, RefreshCw, Download } from "lucide-react";
import { fetchAll } from "@/lib/fetch-all";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/orders/update-status")({
  component: UpdateStatusPage,
});

const NONE = "__none__";

type FieldKey = "external_order_id" | "status" | "delivered_date" | "return_reason";

const FIELDS: { key: FieldKey; label: string; required?: boolean }[] = [
  { key: "external_order_id", label: "رقم الطلب", required: true },
  { key: "status", label: "الحالة الجديدة", required: true },
  { key: "delivered_date", label: "تاريخ التسليم (اختياري)" },
  { key: "return_reason", label: "سبب الإرجاع (اختياري)" },
];

function UpdateStatusPage() {
  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ updated: number; notFound: string[]; errors: string[] } | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function downloadPending() {
    setDownloading(true);
    try {
      const rows = await fetchAll<any>((from, to) =>
        supabase
          .from("orders")
          .select("external_order_id, customer_name, customer_phone, governorate, quantity, price, commission, status, order_date, delivered_date, marketers(marketer_code, name), products(sku, name), shipping_companies(name)")
          .not("status", "in", "(done,refunded)")
          .order("order_date", { ascending: false })
          .range(from, to),
      );
      if (rows.length === 0) { toast.info("لا توجد طلبات بدون حالة نهائية"); setDownloading(false); return; }
      const statusLabel = (s: string) => (ORDER_STATUS as any)[s]?.label ?? s;
      const sheet = rows.map((r: any) => ({
        "رقم الطلب": r.external_order_id ?? "",
        "كود المسوّق": r.marketers?.marketer_code ?? "",
        "اسم المسوّق": r.marketers?.name ?? "",
        "كود المنتج": r.products?.sku ?? "",
        "اسم المنتج": r.products?.name ?? "",
        "شركة الشحن": r.shipping_companies?.name ?? "",
        "اسم العميل": r.customer_name ?? "",
        "رقم العميل": r.customer_phone ?? "",
        "المحافظة": r.governorate ?? "",
        "الكمية": r.quantity ?? 0,
        "السعر": r.price ?? 0,
        "العمولة": r.commission ?? 0,
        "الحالة": statusLabel(r.status),
        "تاريخ الطلب": r.order_date ?? "",
        "تاريخ التسليم": r.delivered_date ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(sheet);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Pending");
      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `pending-orders-${today}.xlsx`);
      toast.success(`تم تنزيل ${rows.length} طلب`);
    } catch (e) {
      console.error(e);
      toast.error("فشل تنزيل الملف");
    } finally {
      setDownloading(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setReport(null);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
    if (json.length === 0) { toast.error("الملف فارغ"); return; }
    const hdrs = Object.keys(json[0]);
    setHeaders(hdrs);
    setRows(json);

    const guess: Partial<Record<FieldKey, string>> = {};
    const oid = hdrs.find((h) => /order|طلب|رقم/i.test(h));
    const st = hdrs.find((h) => /status|حال/i.test(h));
    const dd = hdrs.find((h) => /deliver|تسليم|delivery/i.test(h));
    const rr = hdrs.find((h) => /reason|سبب|ارجاع|إرجاع|مرتجع/i.test(h));
    if (oid) guess.external_order_id = oid;
    if (st) guess.status = st;
    if (dd) guess.delivered_date = dd;
    if (rr) guess.return_reason = rr;
    setMapping(guess);
    toast.success(`تم تحميل ${json.length} صف`);
  }

  async function runUpdate() {
    if (rows.length === 0) { toast.error("لا توجد بيانات"); return; }
    if (!mapping.external_order_id || !mapping.status) {
      toast.error("يجب ربط حقلي رقم الطلب والحالة"); return;
    }
    setBusy(true);
    setReport(null);

    const errors: string[] = [];
    const notFound: string[] = [];
    let updated = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const oid = String(r[mapping.external_order_id!] ?? "").trim();
      if (!oid) { errors.push(`صف ${i + 2}: رقم الطلب فارغ`); continue; }
      const newStatus = normalizeStatus(r[mapping.status!]);
      const payload: any = { status: newStatus };
      if (mapping.delivered_date) {
        const dd = parseExcelDate(r[mapping.delivered_date]);
        if (dd) payload.delivered_date = dd;
      }
      if (mapping.return_reason) {
        const rr = String(r[mapping.return_reason] ?? "").trim();
        if (rr) payload.return_reason = rr;
      }
      if (newStatus === "delivered" && !payload.delivered_date) {
        payload.delivered_date = new Date().toISOString().slice(0, 10);
      }

      const { data, error } = await supabase
        .from("orders")
        .update(payload)
        .eq("external_order_id", oid)
        .select("id");

      if (error) { console.error("Update error:", error); errors.push(`صف ${i + 2} (${oid}): فشل التحديث`); continue; }
      if (!data || data.length === 0) { notFound.push(oid); continue; }
      updated += data.length;
    }

    setBusy(false);
    setReport({ updated, notFound, errors });
    if (errors.length === 0 && notFound.length === 0) {
      toast.success(`تم تحديث ${updated} طلب`);
    } else {
      toast.warning(`تم: ${updated} — غير موجود: ${notFound.length} — أخطاء: ${errors.length}`);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-display font-bold">تحديث حالات الطلبات</h2>
        <p className="text-sm text-muted-foreground">
          ارفع ملف Excel/CSV يحتوي على رقم الطلب والحالة الجديدة لتحديث الطلبات الموجودة دفعة واحدة
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <Label>اختر الملف</Label>
          <Input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} />
          {filename && <div className="text-xs text-muted-foreground">{filename} — {rows.length} صف</div>}
          <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
            الحالات المدعومة: {ORDER_STATUS_KEYS.map((k) => ORDER_STATUS[k].label).join(" / ")}
          </div>
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">ربط الأعمدة</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <Label className="w-44 shrink-0">
                      {f.label} {f.required && <span className="text-destructive">*</span>}
                    </Label>
                    <Select
                      value={mapping[f.key] ?? NONE}
                      onValueChange={(v) =>
                        setMapping((m) => ({ ...m, [f.key]: v === NONE ? undefined : v }))
                      }
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>(لا شيء)</SelectItem>
                        {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">معاينة (أول ٥ صفوف)</CardTitle></CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  {headers.map((h) => <TableHead key={h}>{h}</TableHead>)}
                </TableRow></TableHeader>
                <TableBody>
                  {rows.slice(0, 5).map((r, i) => (
                    <TableRow key={i}>
                      {headers.map((h) => <TableCell key={h} className="text-xs">{String(r[h] ?? "")}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          <div className="flex justify-end">
            <Button size="lg" onClick={runUpdate} disabled={busy}>
              {busy ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <RefreshCw className="ml-2 h-5 w-5" />}
              تنفيذ التحديث
            </Button>
          </div>
        </>
      )}

      {report && (
        <Card className={report.errors.length === 0 && report.notFound.length === 0 ? "border-success" : "border-warning"}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 font-medium">
              {report.errors.length === 0 && report.notFound.length === 0
                ? <><CheckCircle2 className="h-5 w-5 text-success" /> تم التحديث بنجاح</>
                : <><AlertTriangle className="h-5 w-5 text-warning-foreground" /> اكتمل بملاحظات</>}
            </div>
            <div className="text-sm">
              تم تحديث: <b>{report.updated}</b> — غير موجود: <b>{report.notFound.length}</b> — أخطاء: <b>{report.errors.length}</b>
            </div>
            {report.notFound.length > 0 && (
              <details><summary className="cursor-pointer text-sm">أرقام طلبات غير موجودة</summary>
                <ul className="text-xs mt-2 space-y-1 max-h-60 overflow-auto font-mono">
                  {report.notFound.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              </details>
            )}
            {report.errors.length > 0 && (
              <details><summary className="cursor-pointer text-sm">عرض الأخطاء</summary>
                <ul className="text-xs mt-2 space-y-1 max-h-60 overflow-auto">
                  {report.errors.map((e, i) => <li key={i} className="text-destructive">{e}</li>)}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

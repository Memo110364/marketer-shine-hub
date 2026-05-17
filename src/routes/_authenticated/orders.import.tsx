import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { SYSTEM_FIELDS, normalizeStatus, type SystemField } from "@/lib/constants";
import { parseExcelDate } from "@/lib/format";
import { Upload, Loader2, Save, CheckCircle2, AlertTriangle, Eye } from "lucide-react";
import { toast } from "sonner";

type ImportError = {
  rowNumber: number | null; // Excel row (1-based with header), null for batch-level errors
  stage: "validation" | "insert" | "batch";
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
  rowData?: Record<string, any> | null;
  payload?: Record<string, any> | null;
};

export const Route = createFileRoute("/_authenticated/orders/import")({
  component: ImportPage,
});

const NONE = "__none__";

function ImportPage() {
  const qc = useQueryClient();
  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<SystemField, string>>>({});
  const [mappingName, setMappingName] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ success: number; errors: ImportError[] } | null>(null);
  const [selectedError, setSelectedError] = useState<ImportError | null>(null);

  const { data: savedMappings = [] } = useQuery({
    queryKey: ["mappings"],
    queryFn: async () => (await supabase.from("column_mappings").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
    if (json.length === 0) { toast.error("الملف فارغ"); return; }
    setHeaders(Object.keys(json[0]));
    setRows(json);
    // Auto-guess mapping by header name match
    const guess: Partial<Record<SystemField, string>> = {};
    for (const f of SYSTEM_FIELDS) {
      const h = Object.keys(json[0]).find((k) =>
        k.toLowerCase().includes(f.key.replace("_", "")) ||
        k.includes(f.label) ||
        k.toLowerCase().includes(f.key)
      );
      if (h) guess[f.key] = h;
    }
    setMapping(guess);
    toast.success(`تم تحميل ${json.length} صف`);
  }

  function loadMapping(id: string) {
    const m = savedMappings.find((x) => x.id === id);
    if (m) setMapping(m.mapping as any);
  }

  async function saveMapping() {
    if (!mappingName) { toast.error("أدخل اسم القالب"); return; }
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("column_mappings").insert({
      name: mappingName, mapping, created_by: u.user?.id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("تم حفظ القالب");
    qc.invalidateQueries({ queryKey: ["mappings"] });
  }

  async function runImport() {
    if (rows.length === 0) { toast.error("لا توجد بيانات"); return; }
    if (!mapping.marketer_code) { toast.error("يجب ربط حقل كود المسوّق"); return; }
    setBusy(true);
    setReport(null);
    try {
      await doImport();
    } catch (e: any) {
      console.error("Import failed:", e);
      toast.error("فشل الاستيراد: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) { toast.error("يجب تسجيل الدخول"); return; }

    // Create batch
    const { data: batch, error: batchErr } = await supabase.from("import_batches").insert({
      filename, row_count: rows.length, mapping_used: mapping, created_by: userData.user.id,
    }).select().single();
    if (batchErr || !batch) {
      console.error("Batch insert error:", batchErr);
      toast.error("فشل إنشاء دفعة الاستيراد: " + (batchErr?.message ?? "خطأ غير معروف"));
      return;
    }

    // Cache lookups
    const { data: marketersAll } = await supabase.from("marketers").select("id, marketer_code");
    const marketerByCode = new Map((marketersAll ?? []).map((m) => [m.marketer_code, m.id]));
    const { data: productsAll } = await supabase.from("products").select("id, sku, name");
    const productBySku = new Map((productsAll ?? []).map((p) => [p.sku ?? "", p.id]));
    const productByName = new Map((productsAll ?? []).map((p) => [p.name, p.id]));
    const { data: shippingsAll } = await supabase.from("shipping_companies").select("id, name");
    const shippingByName = new Map((shippingsAll ?? []).map((s) => [s.name, s.id]));

    const errors: string[] = [];
    let success = 0;
    const toInsert: any[] = [];

    function pick(row: Record<string, any>, field: SystemField) {
      const col = mapping[field];
      return col ? row[col] : null;
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const marketerCode = String(pick(r, "marketer_code") ?? "").trim();
        if (!marketerCode) throw new Error("كود المسوّق فارغ");
        let marketerId = marketerByCode.get(marketerCode);
        if (!marketerId) {
          // Auto-create marketer
          const { data: nm } = await supabase.from("marketers").insert({
            marketer_code: marketerCode, name: marketerCode,
          }).select().single();
          if (nm) { marketerId = nm.id; marketerByCode.set(marketerCode, nm.id); }
        }

        // Product
        let productId: string | null = null;
        const sku = String(pick(r, "product_sku") ?? "").trim();
        const pname = String(pick(r, "product_name") ?? "").trim();
        if (sku) productId = productBySku.get(sku) ?? null;
        if (!productId && pname) productId = productByName.get(pname) ?? null;
        if (!productId && (sku || pname)) {
          const { data: np } = await supabase.from("products").insert({
            sku: sku || null, name: pname || sku,
          }).select().single();
          if (np) { productId = np.id; if (sku) productBySku.set(sku, np.id); if (pname) productByName.set(pname, np.id); }
        }

        // Shipping
        let shippingId: string | null = null;
        const sname = String(pick(r, "shipping_company") ?? "").trim();
        if (sname) {
          shippingId = shippingByName.get(sname) ?? null;
          if (!shippingId) {
            const { data: ns } = await supabase.from("shipping_companies").insert({ name: sname }).select().single();
            if (ns) { shippingId = ns.id; shippingByName.set(sname, ns.id); }
          }
        }

        toInsert.push({
          external_order_id: String(pick(r, "external_order_id") ?? "") || null,
          marketer_id: marketerId,
          product_id: productId,
          shipping_company_id: shippingId,
          customer_name: String(pick(r, "customer_name") ?? "") || null,
          customer_phone: String(pick(r, "customer_phone") ?? "") || null,
          governorate: String(pick(r, "governorate") ?? "") || null,
          quantity: Number(pick(r, "quantity") || 1),
          price: Number(pick(r, "price") || 0),
          commission: Number(pick(r, "commission") || 0),
          status: normalizeStatus(pick(r, "status")),
          order_date: parseExcelDate(pick(r, "order_date")),
          delivered_date: parseExcelDate(pick(r, "delivered_date")),
          import_batch_id: batch.id,
          raw_data: r,
        });
        success++;
      } catch (err: any) {
        errors.push(`صف ${i + 2}: ${err.message}`);
      }
    }

    // Bulk insert in chunks
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200);
      const { error: insErr } = await supabase.from("orders").insert(chunk);
      if (insErr) {
        console.error("Chunk insert error:", insErr);
        errors.push(`دفعة ${i / 200 + 1}: ${insErr.message}`);
      } else {
        inserted += chunk.length;
      }
    }

    await supabase.from("import_batches").update({
      success_count: inserted, error_count: errors.length, errors: errors.length ? errors : null,
    }).eq("id", batch.id);

    setReport({ success: inserted, errors });
    qc.invalidateQueries({ queryKey: ["orders"] });
    if (errors.length === 0) toast.success(`تم استيراد ${inserted} طلب بنجاح`);
    else if (inserted > 0) toast.warning(`نجح ${inserted}، فشل ${errors.length}`);
    else toast.error(`فشل الاستيراد بالكامل. تحقق من الأخطاء أدناه.`);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-display font-bold">استيراد الطلبات</h2>
        <p className="text-sm text-muted-foreground">ارفع ملف Excel/CSV ثم اربط الأعمدة بحقول النظام</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <Label>اختر الملف</Label>
          <Input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} />
          {filename && <div className="text-xs text-muted-foreground">{filename} — {rows.length} صف</div>}
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-base">ربط الأعمدة</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  مطلوب: <b>كود المسوّق</b>. باقي الحقول اختيارية — اربط ما يناسب ملفك.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select onValueChange={loadMapping}>
                  <SelectTrigger className="w-48 h-9"><SelectValue placeholder="تحميل قالب محفوظ" /></SelectTrigger>
                  <SelectContent>
                    {savedMappings.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="اسم القالب لحفظه" value={mappingName}
                  onChange={(e) => setMappingName(e.target.value)} className="w-44 h-9" />
                <Button variant="outline" size="sm" onClick={saveMapping}><Save className="h-4 w-4 ml-1" /> حفظ</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {SYSTEM_FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <Label className="w-40 shrink-0">
                      {f.label}
                      {f.key === "marketer_code" && <span className="text-destructive mr-1">*</span>}
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
            <Button size="lg" onClick={runImport} disabled={busy}>
              {busy ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <Upload className="ml-2 h-5 w-5" />}
              تنفيذ الاستيراد
            </Button>
          </div>
        </>
      )}

      {report && (
        <Card className={report.errors.length === 0 ? "border-success" : "border-warning"}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 font-medium">
              {report.errors.length === 0
                ? <><CheckCircle2 className="h-5 w-5 text-success" /> تم بنجاح</>
                : <><AlertTriangle className="h-5 w-5 text-warning-foreground" /> اكتمل بأخطاء</>}
            </div>
            <div>نجح: {report.success} — فشل: {report.errors.length}</div>
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

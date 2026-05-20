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
import { Upload, Loader2, Save, CheckCircle2, AlertTriangle, Eye, Trash2 } from "lucide-react";
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

type PreparedRow = { payload: any; rowIndex: number; rowData: Record<string, any> };

type ImportPreview = {
  totalRows: number;
  validationErrors: ImportError[];
  toInsert: PreparedRow[];
  inFileDuplicates: number;
  dbDuplicates: number;
  oldDbDuplicateExtIds: string[];
  oldDbDuplicateExtraCount: number;
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
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<{ success: number; skipped: number; deletedOldDup: number; errors: ImportError[] } | null>(null);
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
    if (error) { console.error("Save mapping error:", error); toast.error("فشل حفظ القالب"); return; }
    toast.success("تم حفظ القالب");
    qc.invalidateQueries({ queryKey: ["mappings"] });
  }

  async function runPreview() {
    if (rows.length === 0) { toast.error("لا توجد بيانات"); return; }
    if (!mapping.marketer_code) { toast.error("يجب ربط حقل كود المسوّق"); return; }
    setBusy(true);
    setReport(null);
    setPreview(null);
    try {
      const p = await buildPreview();
      if (p) setPreview(p);
    } catch (e: any) {
      console.error("Preview failed:", e);
      toast.error("فشل تحضير المعاينة");
    } finally {
      setBusy(false);
    }
  }

  async function buildPreview(): Promise<ImportPreview | null> {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) { toast.error("يجب تسجيل الدخول"); return null; }

    // Cache lookups (read-only here)
    const { data: marketersAll } = await supabase.from("marketers").select("id, marketer_code");
    const marketerByCode = new Map((marketersAll ?? []).map((m) => [m.marketer_code, m.id]));
    const { data: productsAll } = await supabase.from("products").select("id, sku, name");
    const productBySku = new Map((productsAll ?? []).map((p) => [p.sku ?? "", p.id]));
    const productByName = new Map((productsAll ?? []).map((p) => [p.name, p.id]));
    const { data: shippingsAll } = await supabase.from("shipping_companies").select("id, name");
    const shippingByName = new Map((shippingsAll ?? []).map((s) => [s.name, s.id]));

    const validationErrors: ImportError[] = [];
    const prepared: PreparedRow[] = [];

    function pick(row: Record<string, any>, field: SystemField) {
      const col = mapping[field];
      return col ? row[col] : null;
    }

    // Build payloads WITHOUT writing to DB (marketers/products/shipping resolved
    // only if cached; missing entries are left null and created during confirm).
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const marketerCode = String(pick(r, "marketer_code") ?? "").trim();
        if (!marketerCode) throw new Error("كود المسوّق فارغ");
        const marketerId = marketerByCode.get(marketerCode) ?? null;

        const sku = String(pick(r, "product_sku") ?? "").trim();
        const pname = String(pick(r, "product_name") ?? "").trim();
        let productId: string | null = null;
        if (sku) productId = productBySku.get(sku) ?? null;
        if (!productId && pname) productId = productByName.get(pname) ?? null;

        const sname = String(pick(r, "shipping_company") ?? "").trim();
        const shippingId: string | null = sname ? (shippingByName.get(sname) ?? null) : null;

        const payload = {
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
          // store raw resolution hints so confirm step can resolve/create missing refs
          __resolve: { marketerCode, sku, pname, sname },
          raw_data: r,
        };
        prepared.push({ payload, rowIndex: i, rowData: r });
      } catch (err: any) {
        validationErrors.push({
          rowNumber: i + 2,
          stage: "validation",
          message: err?.message ?? String(err),
          rowData: r,
        });
      }
    }

    // In-file dedup
    const seenInFile = new Set<string>();
    const dedupedToInsert: PreparedRow[] = [];
    let inFileDuplicates = 0;
    for (const item of prepared) {
      const ext = (item.payload.external_order_id as string | null)?.trim();
      const sig = ext
        ? `ext:${ext}`
        : `sig:${item.payload.customer_phone ?? ""}|${item.payload.__resolve.sku}|${item.payload.order_date ?? ""}|${item.payload.__resolve.marketerCode}`;
      if (seenInFile.has(sig)) { inFileDuplicates++; continue; }
      seenInFile.add(sig);
      dedupedToInsert.push(item);
    }

    // DB dedup + old DB duplicate detection
    const externalIds = dedupedToInsert
      .map((c) => (c.payload.external_order_id as string | null)?.trim())
      .filter((x): x is string => !!x);
    const dbCounts = new Map<string, number>();
    for (let i = 0; i < externalIds.length; i += 500) {
      const slice = externalIds.slice(i, i + 500);
      const { data: existing } = await supabase
        .from("orders")
        .select("external_order_id")
        .in("external_order_id", slice);
      (existing ?? []).forEach((r: { external_order_id: string | null }) => {
        if (!r.external_order_id) return;
        dbCounts.set(r.external_order_id, (dbCounts.get(r.external_order_id) ?? 0) + 1);
      });
    }

    let dbDuplicates = 0;
    const finalToInsert = dedupedToInsert.filter((c) => {
      const ext = (c.payload.external_order_id as string | null)?.trim();
      if (ext && (dbCounts.get(ext) ?? 0) > 0) { dbDuplicates++; return false; }
      return true;
    });

    const oldDbDuplicateExtIds: string[] = [];
    let oldDbDuplicateExtraCount = 0;
    dbCounts.forEach((count, ext) => {
      if (count > 1) {
        oldDbDuplicateExtIds.push(ext);
        oldDbDuplicateExtraCount += count - 1;
      }
    });

    return {
      totalRows: rows.length,
      validationErrors,
      toInsert: finalToInsert,
      inFileDuplicates,
      dbDuplicates,
      oldDbDuplicateExtIds,
      oldDbDuplicateExtraCount,
    };
  }

  async function confirmImport() {
    if (!preview) return;
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { toast.error("يجب تسجيل الدخول"); return; }

      // 1) Cleanup old DB duplicates — keep oldest row per external_order_id
      let deletedOldDup = 0;
      for (let i = 0; i < preview.oldDbDuplicateExtIds.length; i += 200) {
        const slice = preview.oldDbDuplicateExtIds.slice(i, i + 200);
        const { data: dupRows } = await supabase
          .from("orders")
          .select("id, external_order_id, created_at")
          .in("external_order_id", slice)
          .order("created_at", { ascending: true });
        const keepers = new Set<string>();
        const idsToDelete: string[] = [];
        (dupRows ?? []).forEach((r) => {
          const ext = r.external_order_id!;
          if (!keepers.has(ext)) { keepers.add(ext); return; }
          idsToDelete.push(r.id);
        });
        if (idsToDelete.length) {
          const { error: delErr } = await supabase.from("orders").delete().in("id", idsToDelete);
          if (delErr) console.error("Old dup delete error:", delErr);
          else deletedOldDup += idsToDelete.length;
        }
      }

      // 2) Create batch
      const { data: batch, error: batchErr } = await supabase.from("import_batches").insert({
        filename, row_count: preview.totalRows, mapping_used: mapping, created_by: userData.user.id,
      }).select().single();
      if (batchErr || !batch) {
        console.error("Batch insert error:", batchErr);
        toast.error("فشل إنشاء دفعة الاستيراد");
        return;
      }

      // 3) Resolve missing marketer/product/shipping (create-on-demand)
      const errors: ImportError[] = [...preview.validationErrors];
      const { data: marketersAll } = await supabase.from("marketers").select("id, marketer_code");
      const marketerByCode = new Map((marketersAll ?? []).map((m) => [m.marketer_code, m.id]));
      const { data: productsAll } = await supabase.from("products").select("id, sku, name");
      const productBySku = new Map((productsAll ?? []).map((p) => [p.sku ?? "", p.id]));
      const productByName = new Map((productsAll ?? []).map((p) => [p.name, p.id]));
      const { data: shippingsAll } = await supabase.from("shipping_companies").select("id, name");
      const shippingByName = new Map((shippingsAll ?? []).map((s) => [s.name, s.id]));

      const resolved: PreparedRow[] = [];
      for (const item of preview.toInsert) {
        const meta = item.payload.__resolve as { marketerCode: string; sku: string; pname: string; sname: string };
        try {
          let marketerId: string | null | undefined = item.payload.marketer_id ?? marketerByCode.get(meta.marketerCode);
          if (!marketerId) {
            const { data: nm, error: mErr } = await supabase.from("marketers").insert({
              marketer_code: meta.marketerCode, name: meta.marketerCode,
            }).select().single();
            if (mErr) throw new Error(`تعذّر إنشاء المسوّق "${meta.marketerCode}"`);
            if (nm) { marketerId = nm.id; marketerByCode.set(meta.marketerCode, nm.id); }
          }

          let productId: string | null = item.payload.product_id ?? null;
          if (!productId && (meta.sku || meta.pname)) {
            if (meta.sku) productId = productBySku.get(meta.sku) ?? null;
            if (!productId && meta.pname) productId = productByName.get(meta.pname) ?? null;
            if (!productId) {
              const { data: np, error: pErr } = await supabase.from("products").insert({
                sku: meta.sku || null, name: meta.pname || meta.sku,
              }).select().single();
              if (pErr) throw new Error("تعذّر إنشاء المنتج");
              if (np) { productId = np.id; if (meta.sku) productBySku.set(meta.sku, np.id); if (meta.pname) productByName.set(meta.pname, np.id); }
            }
          }

          let shippingId: string | null = item.payload.shipping_company_id ?? null;
          if (!shippingId && meta.sname) {
            shippingId = shippingByName.get(meta.sname) ?? null;
            if (!shippingId) {
              const { data: ns, error: sErr } = await supabase.from("shipping_companies").insert({ name: meta.sname }).select().single();
              if (sErr) throw new Error("تعذّر إنشاء شركة الشحن");
              if (ns) { shippingId = ns.id; shippingByName.set(meta.sname, ns.id); }
            }
          }

          const { __resolve: _r, ...rest } = item.payload;
          resolved.push({
            payload: { ...rest, marketer_id: marketerId, product_id: productId, shipping_company_id: shippingId, import_batch_id: batch.id },
            rowIndex: item.rowIndex,
            rowData: item.rowData,
          });
        } catch (err: any) {
          errors.push({
            rowNumber: item.rowIndex + 2,
            stage: "validation",
            message: err?.message ?? String(err),
            rowData: item.rowData,
          });
        }
      }

      // 4) Bulk insert
      let inserted = 0;
      for (let i = 0; i < resolved.length; i += 200) {
        const chunk = resolved.slice(i, i + 200);
        const { error: insErr } = await supabase.from("orders").insert(chunk.map((c) => c.payload));
        if (!insErr) { inserted += chunk.length; continue; }
        console.error("Chunk insert error, retrying row-by-row:", insErr);
        for (const item of chunk) {
          const { error: rowErr } = await supabase.from("orders").insert(item.payload);
          if (rowErr) {
            errors.push({
              rowNumber: item.rowIndex + 2,
              stage: "insert",
              message: "تعذّر إدراج الصف في قاعدة البيانات. راجع بيانات الصف وحاول مجددًا.",
              rowData: item.rowData,
            });
          } else inserted++;
        }
      }

      await supabase.from("import_batches").update({
        success_count: inserted,
        error_count: errors.length,
        errors: errors.length ? (errors as any) : null,
      }).eq("id", batch.id);

      const skipped = preview.inFileDuplicates + preview.dbDuplicates;
      setReport({ success: inserted, skipped, deletedOldDup, errors });
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["orders"] });
      const extra: string[] = [];
      if (skipped) extra.push(`تجاهل ${skipped} مكرر`);
      if (deletedOldDup) extra.push(`حذف ${deletedOldDup} مكرر قديم`);
      const dupMsg = extra.length ? ` (${extra.join("، ")})` : "";
      if (errors.length === 0) toast.success(`تم استيراد ${inserted} طلب بنجاح${dupMsg}`);
      else if (inserted > 0) toast.warning(`نجح ${inserted}، فشل ${errors.length}${dupMsg}`);
      else toast.error(`فشل الاستيراد بالكامل${dupMsg}`);
    } catch (e: any) {
      console.error("Confirm import failed:", e);
      toast.error("فشل تنفيذ الاستيراد");
    } finally {
      setBusy(false);
    }
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
            <Button size="lg" onClick={runPreview} disabled={busy || !!preview}>
              {busy ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <Eye className="ml-2 h-5 w-5" />}
              معاينة قبل الاستيراد
            </Button>
          </div>

          {preview && (
            <Card className="border-primary/40">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-5 w-5 text-primary" /> معاينة الاستيراد
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  راجع الأرقام قبل التنفيذ. سيتم تجاهل المكررات تلقائيًا، وحذف أي طلبات قديمة مكررة بنفس الكود في قاعدة البيانات (مع الإبقاء على الأقدم).
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="p-3 rounded-xl bg-muted/40 border">
                    <div className="text-xs text-muted-foreground">إجمالي صفوف الملف</div>
                    <div className="text-xl font-display font-bold mt-1">{preview.totalRows}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-success/10 border border-success/30">
                    <div className="text-xs text-muted-foreground">سيتم إدراجه</div>
                    <div className="text-xl font-display font-bold mt-1 text-success">{preview.toInsert.length}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-warning/10 border border-warning/30">
                    <div className="text-xs text-muted-foreground">مكرر داخل الملف</div>
                    <div className="text-xl font-display font-bold mt-1">{preview.inFileDuplicates}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-warning/10 border border-warning/30">
                    <div className="text-xs text-muted-foreground">موجود مسبقًا في DB</div>
                    <div className="text-xl font-display font-bold mt-1">{preview.dbDuplicates}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30">
                    <div className="text-xs text-muted-foreground">أخطاء تحقق</div>
                    <div className="text-xl font-display font-bold mt-1 text-destructive">{preview.validationErrors.length}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-accent/40 border border-accent">
                    <div className="text-xs text-muted-foreground">مكررات قديمة في DB سيتم حذفها</div>
                    <div className="text-xl font-display font-bold mt-1">{preview.oldDbDuplicateExtraCount}</div>
                  </div>
                </div>

                {preview.oldDbDuplicateExtraCount > 0 && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-accent/30 border border-accent text-xs">
                    <Trash2 className="h-4 w-4 mt-0.5 text-accent-foreground shrink-0" />
                    <div>
                      وجدنا <b>{preview.oldDbDuplicateExtIds.length}</b> كود طلب مكرر سابقًا في قاعدة البيانات
                      (إجمالي <b>{preview.oldDbDuplicateExtraCount}</b> نسخة زائدة). سيتم الإبقاء على الأقدم لكل كود وحذف الباقي عند التأكيد.
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>إلغاء</Button>
                  <Button size="lg" onClick={confirmImport} disabled={busy || preview.toInsert.length === 0}>
                    {busy ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <Upload className="ml-2 h-5 w-5" />}
                    تأكيد وتنفيذ الاستيراد
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {report && (
        <Card className={report.errors.length === 0 ? "border-success" : "border-warning"}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 font-medium">
              {report.errors.length === 0
                ? <><CheckCircle2 className="h-5 w-5 text-success" /> تم بنجاح</>
                : <><AlertTriangle className="h-5 w-5 text-warning-foreground" /> اكتمل بأخطاء</>}
            </div>
            <div className="text-sm">نجح: <b className="text-success">{report.success}</b> — تجاهل مكرر: <b className="text-warning-foreground">{report.skipped}</b> — حذف مكرر قديم: <b className="text-accent-foreground">{report.deletedOldDup}</b> — فشل: <b className="text-destructive">{report.errors.length}</b></div>

            {report.errors.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">الصف</TableHead>
                      <TableHead className="w-24">المرحلة</TableHead>
                      <TableHead>رسالة الخطأ</TableHead>
                      <TableHead className="w-24 text-left">تفاصيل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.errors.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{e.rowNumber ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {e.stage === "validation" ? "تحقق" : e.stage === "insert" ? "إدراج DB" : "دفعة"}
                        </TableCell>
                        <TableCell className="text-xs text-destructive break-all">{e.message}</TableCell>
                        <TableCell className="text-left">
                          <Button variant="outline" size="sm" onClick={() => setSelectedError(e)}>
                            <Eye className="h-3.5 w-3.5 ml-1" /> عرض
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedError} onOpenChange={(o) => !o && setSelectedError(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              تفاصيل خطأ الاستيراد
              {selectedError?.rowNumber && (
                <span className="text-sm font-normal text-muted-foreground">— صف #{selectedError.rowNumber}</span>
              )}
            </DialogTitle>
            <DialogDescription>
              المرحلة:{" "}
              {selectedError?.stage === "validation"
                ? "فشل أثناء التحقق من البيانات قبل الإدراج"
                : selectedError?.stage === "insert"
                ? "فشل أثناء إدراج الصف في قاعدة البيانات (Supabase)"
                : "خطأ على مستوى الدفعة"}
            </DialogDescription>
          </DialogHeader>

          {selectedError && (
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground mb-1">رسالة الخطأ</div>
                <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-destructive text-xs font-mono whitespace-pre-wrap">
                  {selectedError.message}
                </div>
              </div>

              {selectedError.rowData && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">بيانات الصف من الملف</div>
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-1/3">العمود</TableHead>
                          <TableHead>القيمة</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(selectedError.rowData).map(([k, v]) => (
                          <TableRow key={k}>
                            <TableCell className="text-xs font-medium">{k}</TableCell>
                            <TableCell className="text-xs break-all">{v === "" || v == null ? <span className="text-muted-foreground">—</span> : String(v)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

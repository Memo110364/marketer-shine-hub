import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { SYSTEM_FIELDS, normalizeStatus, type SystemField, type OrderStatus } from "@/lib/constants";
import { parseExcelDate } from "@/lib/format";
import { parseProductField } from "@/lib/parse-product";
import { Upload, Loader2, Save, CheckCircle2, AlertTriangle, Eye } from "lucide-react";
import { toast } from "sonner";

async function syncOrderItems(opts: {
  orderId: string;
  rawProductField: unknown;
  externalOrderId: string | null;
  status: OrderStatus;
  marketerId: string | null;
  marketerCode: string | null;
  shippingCompany: string | null;
  totalCommission: number;
}) {
  const items = parseProductField(opts.rawProductField);
  // Always wipe & rewrite — keeps things consistent on re-import.
  await supabase.from("order_items").delete().eq("order_id", opts.orderId);
  if (items.length === 0) return;
  const totalQty = items.reduce((s, it) => s + it.quantity, 0) || 1;
  const rows = items.map((it) => ({
    order_id: opts.orderId,
    order_number: opts.externalOrderId,
    base_product_name: it.base_product_name,
    product_option: it.product_option,
    color: it.color,
    size: it.size,
    quantity: it.quantity,
    raw_product_text: it.raw_product_text,
    order_status: opts.status,
    marketer_id: opts.marketerId,
    marketer_code: opts.marketerCode,
    shipping_company: opts.shippingCompany,
    commission_share: (Number(opts.totalCommission) || 0) * (it.quantity / totalQty),
  }));
  await supabase.from("order_items").insert(rows);
}

type ImportError = {
  rowNumber: number | null;
  stage: "validation" | "insert" | "update" | "batch";
  message: string;
  rowData?: Record<string, any> | null;
};

type RowAction = "new" | "update" | "nochange" | "error";

type PreparedRow = {
  rowIndex: number;
  rowData: Record<string, any>;
  externalId: string | null;
  action: RowAction;
  // payload used for insert/update (without __resolve)
  payload: any;
  // resolution metadata for confirm step
  resolve: { marketerCode: string; sku: string; pname: string; sname: string };
  // for updates: existing row id + diffed fields summary
  existingId?: string;
  changedFields?: string[];
  statusChanged?: boolean;
  oldStatus?: OrderStatus;
  newStatus?: OrderStatus;
  errorMessage?: string;
};

type ImportPreview = {
  totalRows: number;
  inFileDuplicates: number;
  newRows: PreparedRow[];
  updateRows: PreparedRow[];
  noChangeRows: PreparedRow[];
  validationErrors: ImportError[];
};

type ImportReport = {
  inserted: number;
  updated: number;
  unchanged: number;
  statusChanges: number;
  inFileDuplicates: number;
  errors: ImportError[];
  rowResults: { rowNumber: number; action: RowAction; message?: string }[];
};

export const Route = createFileRoute("/_authenticated/orders/import")({
  component: ImportPage,
});

const NONE = "__none__";

// Fields we compare and update on existing orders
const UPDATABLE_FIELDS = [
  "marketer_id",
  "product_id",
  "shipping_company_id",
  "customer_name",
  "customer_phone",
  "governorate",
  "quantity",
  "price",
  "commission",
  "status",
  "order_date",
  "delivered_date",
] as const;

function valEq(a: any, b: any): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}

function ImportPage() {
  const qc = useQueryClient();
  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<SystemField, string>>>({});
  const [mappingName, setMappingName] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [selectedError, setSelectedError] = useState<ImportError | null>(null);

  const { data: savedMappings = [] } = useQuery({
    queryKey: ["mappings"],
    queryFn: async () => (await supabase.from("column_mappings").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setPreview(null);
    setReport(null);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
    if (json.length === 0) { toast.error("الملف فارغ"); return; }
    setHeaders(Object.keys(json[0]));
    setRows(json);
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
    if (error) { toast.error("فشل حفظ القالب"); return; }
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

        const externalId = (String(pick(r, "external_order_id") ?? "").trim()) || null;

        const payload = {
          external_order_id: externalId,
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
          raw_data: r,
        };

        prepared.push({
          rowIndex: i,
          rowData: r,
          externalId,
          action: "new",
          payload,
          resolve: { marketerCode, sku, pname, sname },
        });
      } catch (err: any) {
        validationErrors.push({
          rowNumber: i + 2,
          stage: "validation",
          message: err?.message ?? String(err),
          rowData: r,
        });
      }
    }

    // ── Safety rule: in-file dedup by external_order_id, keep LAST occurrence
    // (rows lower in the file are considered the latest update). Rows without
    // an external id fall back to a composite signature.
    const lastIndexByKey = new Map<string, number>();
    prepared.forEach((p, idx) => {
      const key = p.externalId
        ? `ext:${p.externalId}`
        : `sig:${p.payload.customer_phone ?? ""}|${p.resolve.sku}|${p.payload.order_date ?? ""}|${p.resolve.marketerCode}`;
      lastIndexByKey.set(key, idx);
    });
    const keptIndices = new Set(lastIndexByKey.values());
    const inFileDuplicates = prepared.length - keptIndices.size;
    const deduped = prepared.filter((_, idx) => keptIndices.has(idx));

    // ── DB lookup for existing rows by external_order_id
    const externalIds = deduped.map((c) => c.externalId).filter((x): x is string => !!x);
    const existingByExt = new Map<string, any>();
    for (let i = 0; i < externalIds.length; i += 500) {
      const slice = externalIds.slice(i, i + 500);
      const { data: existing } = await supabase
        .from("orders")
        .select("id, external_order_id, marketer_id, product_id, shipping_company_id, customer_name, customer_phone, governorate, quantity, price, commission, status, order_date, delivered_date")
        .in("external_order_id", slice);
      (existing ?? []).forEach((row: any) => {
        if (row.external_order_id) existingByExt.set(row.external_order_id, row);
      });
    }

    const newRows: PreparedRow[] = [];
    const updateRows: PreparedRow[] = [];
    const noChangeRows: PreparedRow[] = [];

    for (const p of deduped) {
      const existing = p.externalId ? existingByExt.get(p.externalId) : undefined;
      if (!existing) {
        p.action = "new";
        newRows.push(p);
        continue;
      }
      // Diff — only consider updatable fields. For unresolved refs (null in new
      // payload because marketer/product/shipping not yet created), keep
      // existing value rather than overwriting with null.
      const changed: string[] = [];
      for (const f of UPDATABLE_FIELDS) {
        const newVal = (p.payload as any)[f];
        const oldVal = existing[f];
        // Don't overwrite a real value with null for the FK refs that we may
        // resolve/create during confirm.
        if (newVal == null && (f === "marketer_id" || f === "product_id" || f === "shipping_company_id")) continue;
        if (!valEq(newVal, oldVal)) changed.push(f);
      }
      if (changed.length === 0) {
        p.action = "nochange";
        p.existingId = existing.id;
        noChangeRows.push(p);
      } else {
        p.action = "update";
        p.existingId = existing.id;
        p.changedFields = changed;
        p.statusChanged = changed.includes("status");
        p.oldStatus = existing.status as OrderStatus;
        p.newStatus = p.payload.status as OrderStatus;
        updateRows.push(p);
      }
    }

    return {
      totalRows: rows.length,
      inFileDuplicates,
      newRows,
      updateRows,
      noChangeRows,
      validationErrors,
    };
  }

  async function confirmImport() {
    if (!preview) return;
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { toast.error("يجب تسجيل الدخول"); return; }
      const userId = userData.user.id;

      // 1) Create batch
      const { data: batch, error: batchErr } = await supabase.from("import_batches").insert({
        filename, row_count: preview.totalRows, mapping_used: mapping, created_by: userId,
      }).select().single();
      if (batchErr || !batch) {
        toast.error("فشل إنشاء دفعة الاستيراد");
        return;
      }

      const errors: ImportError[] = [...preview.validationErrors];
      const rowResults: ImportReport["rowResults"] = preview.validationErrors.map((e) => ({
        rowNumber: e.rowNumber ?? 0,
        action: "error" as const,
        message: e.message,
      }));

      // 2) Caches for resolve-on-demand
      const { data: marketersAll } = await supabase.from("marketers").select("id, marketer_code");
      const marketerByCode = new Map((marketersAll ?? []).map((m) => [m.marketer_code, m.id]));
      const { data: productsAll } = await supabase.from("products").select("id, sku, name");
      const productBySku = new Map((productsAll ?? []).map((p) => [p.sku ?? "", p.id]));
      const productByName = new Map((productsAll ?? []).map((p) => [p.name, p.id]));
      const { data: shippingsAll } = await supabase.from("shipping_companies").select("id, name");
      const shippingByName = new Map((shippingsAll ?? []).map((s) => [s.name, s.id]));

      async function resolveRefs(item: PreparedRow) {
        const meta = item.resolve;
        let marketerId: string | null = item.payload.marketer_id ?? marketerByCode.get(meta.marketerCode) ?? null;
        if (!marketerId) {
          const { data: nm, error: mErr } = await supabase.from("marketers").insert({
            marketer_code: meta.marketerCode, name: meta.marketerCode,
          }).select().single();
          if (mErr) throw new Error(`تعذّر إنشاء المسوّق "${meta.marketerCode}"`);
          marketerId = nm!.id; marketerByCode.set(meta.marketerCode, nm!.id);
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
            productId = np!.id;
            if (meta.sku) productBySku.set(meta.sku, np!.id);
            if (meta.pname) productByName.set(meta.pname, np!.id);
          }
        }
        let shippingId: string | null = item.payload.shipping_company_id ?? null;
        if (!shippingId && meta.sname) {
          shippingId = shippingByName.get(meta.sname) ?? null;
          if (!shippingId) {
            const { data: ns, error: sErr } = await supabase.from("shipping_companies").insert({ name: meta.sname }).select().single();
            if (sErr) throw new Error("تعذّر إنشاء شركة الشحن");
            shippingId = ns!.id; shippingByName.set(meta.sname, ns!.id);
          }
        }
        return { marketerId, productId, shippingId };
      }

      // 3) INSERT new rows (resolve refs first, then insert one-by-one to
      // safely catch unique-constraint races).
      let inserted = 0;
      let statusChanges = 0;
      const newHistoryRows: any[] = [];

      for (const item of preview.newRows) {
        try {
          const refs = await resolveRefs(item);
          const payload = {
            ...item.payload,
            marketer_id: refs.marketerId,
            product_id: refs.productId,
            shipping_company_id: refs.shippingId,
            import_batch_id: batch.id,
          };
          const { data: insertedRow, error: insErr } = await supabase
            .from("orders").insert(payload).select("id, status").single();
          if (insErr) {
            errors.push({
              rowNumber: item.rowIndex + 2, stage: "insert",
              message: insErr.message, rowData: item.rowData,
            });
            rowResults.push({ rowNumber: item.rowIndex + 2, action: "error", message: insErr.message });
            continue;
          }
          inserted++;
          rowResults.push({ rowNumber: item.rowIndex + 2, action: "new" });
          // First-time insert: record initial status history (old = null)
          newHistoryRows.push({
            order_id: insertedRow!.id,
            old_status: null,
            new_status: insertedRow!.status,
            import_batch_id: batch.id,
            changed_by: userId,
          });
          // Sync parsed order_items
          try {
            await syncOrderItems({
              orderId: insertedRow!.id,
              rawProductField: mapping.product_name ? item.rowData[mapping.product_name] : null,
              externalOrderId: item.externalId,
              status: payload.status as OrderStatus,
              marketerId: refs.marketerId,
              marketerCode: item.resolve.marketerCode || null,
              shippingCompany: item.resolve.sname || null,
              totalCommission: Number(payload.commission || 0),
            });
          } catch (e) { console.error("order_items sync (insert) failed:", e); }
        } catch (err: any) {
          errors.push({
            rowNumber: item.rowIndex + 2, stage: "insert",
            message: err?.message ?? String(err), rowData: item.rowData,
          });
          rowResults.push({ rowNumber: item.rowIndex + 2, action: "error", message: err?.message ?? String(err) });
        }
      }

      // 4) UPDATE existing rows (only changed fields). Record status history.
      let updated = 0;
      for (const item of preview.updateRows) {
        try {
          const refs = await resolveRefs(item);
          const fullPayload = {
            ...item.payload,
            marketer_id: refs.marketerId,
            product_id: refs.productId,
            shipping_company_id: refs.shippingId,
          };
          // Build patch of only changed fields (recompute against actual resolved refs)
          const patch: Record<string, any> = {};
          for (const f of item.changedFields ?? []) {
            patch[f] = (fullPayload as any)[f];
          }
          // Always bump updated_at + raw_data + import_batch_id link
          patch.updated_at = new Date().toISOString();
          patch.raw_data = item.payload.raw_data;
          patch.import_batch_id = batch.id;

          const { error: updErr } = await supabase
            .from("orders").update(patch as any).eq("id", item.existingId!);
          if (updErr) {
            errors.push({
              rowNumber: item.rowIndex + 2, stage: "update",
              message: updErr.message, rowData: item.rowData,
            });
            rowResults.push({ rowNumber: item.rowIndex + 2, action: "error", message: updErr.message });
            continue;
          }
          updated++;
          rowResults.push({ rowNumber: item.rowIndex + 2, action: "update" });

          if (item.statusChanged && item.oldStatus !== item.newStatus) {
            statusChanges++;
            newHistoryRows.push({
              order_id: item.existingId,
              old_status: item.oldStatus,
              new_status: item.newStatus,
              import_batch_id: batch.id,
              changed_by: userId,
            });
          }
          // Sync parsed order_items (delete old + recreate)
          try {
            await syncOrderItems({
              orderId: item.existingId!,
              rawProductField: mapping.product_name ? item.rowData[mapping.product_name] : null,
              externalOrderId: item.externalId,
              status: fullPayload.status as OrderStatus,
              marketerId: refs.marketerId,
              marketerCode: item.resolve.marketerCode || null,
              shippingCompany: item.resolve.sname || null,
              totalCommission: Number(fullPayload.commission || 0),
            });
          } catch (e) { console.error("order_items sync (update) failed:", e); }
        } catch (err: any) {
          errors.push({
            rowNumber: item.rowIndex + 2, stage: "update",
            message: err?.message ?? String(err), rowData: item.rowData,
          });
          rowResults.push({ rowNumber: item.rowIndex + 2, action: "error", message: err?.message ?? String(err) });
        }
      }

      // 5) No-change rows in the report
      for (const item of preview.noChangeRows) {
        rowResults.push({ rowNumber: item.rowIndex + 2, action: "nochange" });
      }

      // 6) Bulk-insert history rows
      if (newHistoryRows.length) {
        for (let i = 0; i < newHistoryRows.length; i += 500) {
          const slice = newHistoryRows.slice(i, i + 500);
          const { error: hErr } = await supabase.from("order_status_history").insert(slice);
          if (hErr) console.error("History insert error:", hErr);
        }
      }

      await supabase.from("import_batches").update({
        success_count: inserted + updated,
        error_count: errors.length,
        errors: errors.length ? (errors as any) : null,
      }).eq("id", batch.id);

      setReport({
        inserted,
        updated,
        unchanged: preview.noChangeRows.length,
        statusChanges,
        inFileDuplicates: preview.inFileDuplicates,
        errors,
        rowResults: rowResults.sort((a, b) => a.rowNumber - b.rowNumber),
      });
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });

      const summary = `جديد ${inserted} • تحديث ${updated} • بدون تغيير ${preview.noChangeRows.length}`;
      if (errors.length === 0) toast.success(`تم: ${summary}`);
      else toast.warning(`${summary} — فشل ${errors.length}`);
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
        <p className="text-sm text-muted-foreground">
          ارفع ملف Excel/CSV — الطلبات الموجودة سيتم تحديثها تلقائيًا (لا تكرار).
        </p>
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
                  مطلوب: <b>كود المسوّق</b>. ربط <b>رقم الطلب</b> مهم لمنع التكرار وتفعيل التحديث التلقائي.
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
                  راجع الأرقام قبل التنفيذ. لن يحدث أي تكرار — الطلبات الموجودة بنفس <b>رقم الطلب</b> سيتم تحديثها فقط عند تغيّر الحقول.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  <Stat label="إجمالي صفوف الملف" value={preview.totalRows} />
                  <Stat label="جديدة" value={preview.newRows.length} tone="success" />
                  <Stat label="تحديثات" value={preview.updateRows.length} tone="info" />
                  <Stat label="بدون تغيير" value={preview.noChangeRows.length} tone="warning" />
                  <Stat label="مكرر داخل الملف" value={preview.inFileDuplicates} tone="warning" />
                  <Stat label="أخطاء تحقق" value={preview.validationErrors.length} tone="destructive" />
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>إلغاء</Button>
                  <Button size="lg" onClick={confirmImport}
                    disabled={busy || (preview.newRows.length + preview.updateRows.length === 0)}>
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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <Stat label="جديدة" value={report.inserted} tone="success" />
              <Stat label="تم تحديثها" value={report.updated} tone="info" />
              <Stat label="بدون تغيير" value={report.unchanged} tone="warning" />
              <Stat label="تغييرات حالة" value={report.statusChanges} tone="info" />
              <Stat label="مكرر في الملف" value={report.inFileDuplicates} tone="warning" />
              <Stat label="أخطاء" value={report.errors.length} tone="destructive" />
            </div>

            {report.rowResults.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">الصف</TableHead>
                      <TableHead className="w-32">الحالة</TableHead>
                      <TableHead>الرسالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rowResults.slice(0, 200).map((r, i) => (
                      <TableRow key={i} className={rowToneClass(r.action)}>
                        <TableCell className="text-xs">{r.rowNumber || "—"}</TableCell>
                        <TableCell className="text-xs"><ActionBadge action={r.action} /></TableCell>
                        <TableCell className="text-xs break-all">
                          {r.action === "error"
                            ? <span className="text-destructive">{r.message}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {report.rowResults.length > 200 && (
                  <div className="p-2 text-xs text-muted-foreground text-center border-t">
                    عرض أول 200 صف من {report.rowResults.length}
                  </div>
                )}
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
            </DialogTitle>
            <DialogDescription>{selectedError?.message}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "info" | "warning" | "destructive" }) {
  const toneClass =
    tone === "success" ? "bg-success/10 border-success/30 text-success"
    : tone === "info" ? "bg-primary/10 border-primary/30 text-primary"
    : tone === "warning" ? "bg-warning/10 border-warning/30"
    : tone === "destructive" ? "bg-destructive/10 border-destructive/30 text-destructive"
    : "bg-muted/40 border";
  return (
    <div className={`p-3 rounded-xl border ${toneClass}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-display font-bold mt-1">{value}</div>
    </div>
  );
}

function rowToneClass(action: RowAction) {
  if (action === "new") return "bg-success/5";
  if (action === "update") return "bg-primary/5";
  if (action === "nochange") return "bg-warning/5";
  return "bg-destructive/5";
}

function ActionBadge({ action }: { action: RowAction }) {
  const map: Record<RowAction, { label: string; className: string }> = {
    new: { label: "جديد", className: "bg-success/15 text-success border-success/30" },
    update: { label: "تحديث", className: "bg-primary/15 text-primary border-primary/30" },
    nochange: { label: "بدون تغيير", className: "bg-warning/15 text-warning-foreground border-warning/30" },
    error: { label: "خطأ", className: "bg-destructive/15 text-destructive border-destructive/30" },
  };
  const { label, className } = map[action];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] ${className}`}>{label}</span>;
}

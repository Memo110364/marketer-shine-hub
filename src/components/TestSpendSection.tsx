import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { fmtCurrency, fmtDate, fmtNumber, fmtPercent } from "@/lib/format";
import {
  AD_FUNDING_SPEND_TYPES, TEST_RESULT_LABELS, TEST_RESULT_TONE,
  LEGACY_TEST_PRODUCT_PLACEHOLDER, type TestResult,
} from "@/lib/constants";
import { MONTHS_AR } from "@/lib/bonus";
import { TestSpendDialog, type TestSpendEntry } from "@/components/TestSpendDialog";
import { FlaskConical, Plus, Pencil, Trash2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

/**
 * Test spend is a *classification* of advertising funding already issued to
 * the marketer — never an extra expense:
 *
 *   إجمالي التمويل الإعلاني − مصروف التيست = المصروف الإعلاني المحتسب
 *
 * This section shows that split and doubles as the operational record of
 * what each test actually produced. Scoped by month, matching the funding
 * cap enforced in the database.
 */
export function TestSpendSection({ marketerId }: { marketerId: string }) {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const canEdit = isAdmin || role === "account_manager";
  const qc = useQueryClient();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<TestSpendEntry | null>(null);

  const period = useMemo(() => {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }, [year, month]);

  const { data: funding = 0 } = useQuery({
    queryKey: ["ad-funding", marketerId, period.from, period.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_spend_transactions").select("amount")
        .eq("marketer_id", marketerId)
        .in("spend_type", AD_FUNDING_SPEND_TYPES)
        .gte("transaction_date", period.from).lte("transaction_date", period.to);
      if (error) throw error;
      return (data ?? []).reduce((s, r: any) => s + Number(r.amount || 0), 0);
    },
  });

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["test-spend", marketerId, period.from, period.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("test_spend_entries").select("*, products(name)")
        .eq("marketer_id", marketerId)
        .gte("test_date", period.from).lte("test_date", period.to)
        .order("test_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TestSpendEntry[];
    },
  });

  const testTotal = useMemo(
    () => entries.reduce((s, e) => s + Number(e.amount || 0), 0),
    [entries],
  );
  const performanceAdSpend = Math.max(funding - testTotal, 0);

  // One row per tested product, so Admin can see which products the budget
  // actually went into. Products with no id group by their typed name.
  const byProduct = useMemo(() => {
    const map = new Map<string, {
      key: string; name: string; spend: number; tests: number;
      orders: number | null; delivered: number | null; revenue: number | null;
      results: string[]; incomplete: boolean;
    }>();
    for (const e of entries) {
      const name = e.products?.name ?? e.product_name ?? "—";
      const key = e.product_id ?? `name:${name}`;
      const row = map.get(key) ?? {
        key, name, spend: 0, tests: 0,
        orders: null, delivered: null, revenue: null,
        results: [], incomplete: false,
      };
      row.spend += Number(e.amount || 0);
      row.tests += 1;
      // Only sum what was actually recorded — never fabricate zeros.
      if (e.orders_generated != null) row.orders = (row.orders ?? 0) + e.orders_generated;
      if (e.delivered_orders != null) row.delivered = (row.delivered ?? 0) + e.delivered_orders;
      if (e.revenue_generated != null) row.revenue = (row.revenue ?? 0) + Number(e.revenue_generated);
      if (e.result && !row.results.includes(e.result)) row.results.push(e.result);
      if (isLegacyIncomplete(e)) row.incomplete = true;
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => b.spend - a.spend);
  }, [entries]);

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("test_spend_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حذف مصروف التيست");
      qc.invalidateQueries({ queryKey: ["test-spend", marketerId] });
    },
    onError: (e: any) => toast.error(e.message ?? "فشل الحذف"),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["test-spend", marketerId] });
  const years = [now.getFullYear(), now.getFullYear() - 1];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
        <CardTitle className="text-base inline-flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-[var(--info)]" />
          سجل اختبارات المنتجات
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS_AR.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="h-9 w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          {canEdit && (
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 ml-1" /> إضافة تيست</Button>
              </DialogTrigger>
              <TestSpendDialog
                marketerId={marketerId}
                defaultDate={period.to > today ? today : period.to}
                remaining={performanceAdSpend}
                onDone={() => { setAddOpen(false); refresh(); }}
              />
            </Dialog>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Monthly summary — the equation, plus how many products were tested */}
        <div className="rounded-xl border bg-muted/40 p-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center">
            <SummaryCell label="إجمالي تمويل الإعلانات" value={fmtCurrency(funding)} hint="إجمالي الأكواد" />
            <SummaryCell label="إجمالي مصروف التيست" value={`− ${fmtCurrency(testTotal)}`}
              hint="جزء من التمويل" tone="text-[var(--info)]" />
            <SummaryCell label="الإنفاق الإعلاني المحتسب" value={fmtCurrency(performanceAdSpend)}
              hint="الداخل في حسبة البونص" tone="text-[var(--success)]" />
            <SummaryCell label="المنتجات التي تم اختبارها" value={fmtNumber(byProduct.length)}
              hint={`${fmtNumber(entries.length)} اختبار`} />
          </div>
          <div className="mt-3 pt-3 border-t text-center text-sm font-medium" dir="ltr">
            {fmtCurrency(funding)} − {fmtCurrency(testTotal)} = {fmtCurrency(performanceAdSpend)}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            مصروف التيست لا يزيد إجمالي التمويل الإعلاني — هو تصنيف لجزء منه.
          </p>
        </div>

        {/* Per-product breakdown */}
        {byProduct.length > 0 && (
          <div>
            <div className="text-sm font-medium mb-2">التوزيع حسب المنتج</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {byProduct.map((p) => (
                <div key={p.key} className="rounded-lg border p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium leading-tight">{p.name}</span>
                    {p.incomplete && <IncompleteBadge />}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    مصروف التيست: <b className="text-foreground">{fmtCurrency(p.spend)}</b>
                    {p.tests > 1 && <> · {fmtNumber(p.tests)} اختبارات</>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.orders != null ? <>أوردرات: <b className="text-foreground">{fmtNumber(p.orders)}</b></> : "أوردرات: —"}
                    {" · "}
                    {p.delivered != null ? <>مسلمة: <b className="text-foreground">{fmtNumber(p.delivered)}</b></> : "مسلمة: —"}
                  </div>
                  {p.revenue != null && (
                    <div className="text-xs text-muted-foreground">
                      الإيراد: <b className="text-foreground">{fmtCurrency(p.revenue)}</b>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {p.results.length === 0
                      ? <span className="text-xs text-muted-foreground">بدون نتيجة</span>
                      : p.results.map((r) => <ResultBadge key={r} result={r} />)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Test history */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المنتج</TableHead>
                <TableHead>مبلغ الاختبار</TableHead>
                <TableHead>فترة الاختبار</TableHead>
                <TableHead>النتيجة</TableHead>
                <TableHead>الأوردرات</TableHead>
                <TableHead>المسلمة</TableHead>
                <TableHead>معدل التسليم</TableHead>
                <TableHead>تكلفة الأوردر</TableHead>
                <TableHead>الإيراد</TableHead>
                <TableHead>ملاحظات</TableHead>
                {canEdit && <TableHead className="w-[90px]"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={canEdit ? 11 : 10} className="text-center py-6">جاري التحميل...</TableCell></TableRow>
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canEdit ? 11 : 10} className="text-center py-6 text-muted-foreground">
                    لا يوجد اختبارات في هذا الشهر
                  </TableCell>
                </TableRow>
              ) : entries.map((e) => {
                // Presentation metrics only when both inputs exist.
                const deliveryRate = e.orders_generated && e.orders_generated > 0 && e.delivered_orders != null
                  ? e.delivered_orders / e.orders_generated
                  : null;
                return (
                  <TableRow key={e.id}>
                    <TableCell className="max-w-[200px]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm">{e.products?.name ?? e.product_name ?? "—"}</span>
                        {isLegacyIncomplete(e) && <IncompleteBadge />}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">{fmtCurrency(Number(e.amount))}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {fmtDate(e.test_date)}
                      {e.test_end_date && e.test_end_date !== e.test_date && <> → {fmtDate(e.test_end_date)}</>}
                    </TableCell>
                    <TableCell>
                      {e.result ? <ResultBadge result={e.result} /> : <Dash />}
                    </TableCell>
                    <TableCell>{e.orders_generated != null ? fmtNumber(e.orders_generated) : <Dash />}</TableCell>
                    <TableCell>{e.delivered_orders != null ? fmtNumber(e.delivered_orders) : <Dash />}</TableCell>
                    <TableCell>{deliveryRate != null ? fmtPercent(deliveryRate) : <Dash />}</TableCell>
                    <TableCell>{e.cost_per_order != null ? fmtCurrency(Number(e.cost_per_order)) : <Dash />}</TableCell>
                    <TableCell>{e.revenue_generated != null ? fmtCurrency(Number(e.revenue_generated)) : <Dash />}</TableCell>
                    <TableCell className="max-w-[200px] text-xs">{e.notes ?? <Dash />}</TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => setEditing(e)} title="تعديل بيانات الاختبار">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {isAdmin && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                              onClick={() => delMut.mutate(e.id)} disabled={delMut.isPending} title="حذف">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <TestSpendDialog
            marketerId={marketerId}
            entry={editing}
            defaultDate={editing.test_date}
            remaining={performanceAdSpend}
            onDone={() => { setEditing(null); refresh(); }}
          />
        </Dialog>
      )}
    </Card>
  );
}

/** Rows carried over from the old test_ads spend type, with no product recorded. */
function isLegacyIncomplete(e: TestSpendEntry) {
  return !e.product_id && e.product_name === LEGACY_TEST_PRODUCT_PLACEHOLDER;
}

function IncompleteBadge() {
  return (
    <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
      <AlertCircle className="h-3 w-3" />
      بيانات تاريخية غير مكتملة
    </Badge>
  );
}

function ResultBadge({ result }: { result: string }) {
  const label = TEST_RESULT_LABELS[result as TestResult] ?? result;
  const tone = TEST_RESULT_TONE[result as TestResult] ?? "";
  return <Badge variant="outline" className={`text-[11px] ${tone}`}>{label}</Badge>;
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

function SummaryCell({
  label, value, hint, tone,
}: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-display font-bold mt-1 ${tone ?? ""}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

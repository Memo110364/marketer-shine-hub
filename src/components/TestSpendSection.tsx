import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { fmtCurrency, fmtDate, fmtNumber } from "@/lib/format";
import { AD_FUNDING_SPEND_TYPES, TEST_RESULT_LABELS, type TestResult } from "@/lib/constants";
import { MONTHS_AR } from "@/lib/bonus";
import { FlaskConical, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Test spend is a *classification* of advertising funding already issued to
 * the marketer — never an extra expense. This section makes that explicit:
 *
 *   إجمالي التمويل الإعلاني − مصروف التيست = المصروف الإعلاني المحتسب
 *
 * The bonus engine deducts only the last figure, so nothing is charged twice.
 * Scoped by month because the funding cap is enforced per marketer/month.
 */
export function TestSpendSection({ marketerId }: { marketerId: string }) {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const canEdit = isAdmin || role === "account_manager";
  const qc = useQueryClient();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [open, setOpen] = useState(false);

  const period = useMemo(() => {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }, [year, month]);

  const { data: funding = 0 } = useQuery({
    queryKey: ["ad-funding", marketerId, period.from, period.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_spend_transactions")
        .select("amount")
        .eq("marketer_id", marketerId)
        .in("spend_type", AD_FUNDING_SPEND_TYPES)
        .gte("transaction_date", period.from)
        .lte("transaction_date", period.to);
      if (error) throw error;
      return (data ?? []).reduce((s, r: any) => s + Number(r.amount || 0), 0);
    },
  });

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["test-spend", marketerId, period.from, period.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("test_spend_entries")
        .select("*, products(name)")
        .eq("marketer_id", marketerId)
        .gte("test_date", period.from)
        .lte("test_date", period.to)
        .order("test_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const testTotal = useMemo(
    () => entries.reduce((s, e) => s + Number(e.amount || 0), 0),
    [entries],
  );
  const performanceAdSpend = Math.max(funding - testTotal, 0);
  const remaining = Math.max(funding - testTotal, 0);

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

  const years = [now.getFullYear(), now.getFullYear() - 1];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
        <CardTitle className="text-base inline-flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-[var(--info)]" />
          مصروف التيست
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS_AR.map((m, i) => (
                <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="h-9 w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          {canEdit && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 ml-1" /> إضافة تيست</Button>
              </DialogTrigger>
              <AddTestSpendDialog
                marketerId={marketerId}
                defaultDate={period.to > new Date().toISOString().slice(0, 10)
                  ? new Date().toISOString().slice(0, 10)
                  : period.to}
                remaining={remaining}
                onDone={() => {
                  setOpen(false);
                  qc.invalidateQueries({ queryKey: ["test-spend", marketerId] });
                }}
              />
            </Dialog>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* The equation — test spend reduces funding, never adds to it. */}
        <div className="rounded-xl border bg-muted/40 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-xs text-muted-foreground">إجمالي التمويل الإعلاني</div>
              <div className="text-xl font-display font-bold mt-1">{fmtCurrency(funding)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">إجمالي الأكواد</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">مصروف التيست</div>
              <div className="text-xl font-display font-bold mt-1 text-[var(--info)]">
                − {fmtCurrency(testTotal)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">جزء من التمويل</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">المصروف الإعلاني المحتسب</div>
              <div className="text-xl font-display font-bold mt-1 text-[var(--success)]">
                {fmtCurrency(performanceAdSpend)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">الداخل في حسبة البونص</div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t text-center text-sm font-medium" dir="ltr">
            {fmtCurrency(funding)} − {fmtCurrency(testTotal)} = {fmtCurrency(performanceAdSpend)}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            مصروف التيست لا يزيد إجمالي التمويل الإعلاني — هو تصنيف لجزء منه.
          </p>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>التاريخ</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>المنتج</TableHead>
              <TableHead>النتيجة</TableHead>
              <TableHead>الأداء</TableHead>
              <TableHead>ملاحظات</TableHead>
              {isAdmin && <TableHead className="w-[60px]"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={isAdmin ? 7 : 6} className="text-center py-6">جاري التحميل...</TableCell></TableRow>
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 7 : 6} className="text-center py-6 text-muted-foreground">
                  لا يوجد مصروف تيست في هذا الشهر
                </TableCell>
              </TableRow>
            ) : entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap">
                  {fmtDate(e.test_date)}
                  {e.test_end_date && e.test_end_date !== e.test_date && (
                    <span className="text-xs text-muted-foreground"> → {fmtDate(e.test_end_date)}</span>
                  )}
                </TableCell>
                <TableCell className="font-medium">{fmtCurrency(Number(e.amount))}</TableCell>
                <TableCell>{e.products?.name ?? e.product_name ?? "—"}</TableCell>
                <TableCell>
                  {e.result
                    ? <Badge variant="outline">{TEST_RESULT_LABELS[e.result as TestResult] ?? e.result}</Badge>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {[
                    e.orders_generated != null ? `${fmtNumber(e.orders_generated)} طلب` : null,
                    e.delivered_orders != null ? `${fmtNumber(e.delivered_orders)} تسليم` : null,
                    e.revenue_generated != null ? fmtCurrency(Number(e.revenue_generated)) : null,
                    e.cost_per_order != null ? `تكلفة/طلب ${fmtCurrency(Number(e.cost_per_order))}` : null,
                  ].filter(Boolean).join(" · ") || "—"}
                </TableCell>
                <TableCell className="max-w-[240px] text-xs">{e.notes ?? "—"}</TableCell>
                {isAdmin && (
                  <TableCell>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                      onClick={() => delMut.mutate(e.id)} disabled={delMut.isPending} title="حذف"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AddTestSpendDialog({
  marketerId, defaultDate, remaining, onDone,
}: {
  marketerId: string;
  defaultDate: string;
  remaining: number;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [testDate, setTestDate] = useState(defaultDate);
  const [testEndDate, setTestEndDate] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [result, setResult] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [ordersGenerated, setOrdersGenerated] = useState("");
  const [deliveredOrders, setDeliveredOrders] = useState("");
  const [revenue, setRevenue] = useState("");
  const [costPerOrder, setCostPerOrder] = useState("");

  // The catalogue is large, so search rather than listing everything.
  const { data: productMatches = [] } = useQuery({
    queryKey: ["product-search", productQuery],
    enabled: productQuery.trim().length >= 2 && !product,
    queryFn: async () => {
      const { data } = await supabase
        .from("products").select("id, name")
        .ilike("name", `%${productQuery.trim()}%`).limit(8);
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const mut = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error("أدخل مبلغ تيست صحيح");
      const productName = product?.name ?? productQuery.trim();
      if (!productName) throw new Error("اختر المنتج الذي تم اختباره أو اكتب اسمه");

      const { error } = await supabase.from("test_spend_entries").insert({
        marketer_id: marketerId,
        amount: amt,
        test_date: testDate,
        test_end_date: testEndDate || null,
        product_id: product?.id ?? null,
        product_name: productName,
        result: result || null,
        notes: notes.trim() || null,
        orders_generated: num(ordersGenerated),
        delivered_orders: num(deliveredOrders),
        revenue_generated: num(revenue),
        cost_per_order: num(costPerOrder),
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("تم تسجيل مصروف التيست"); onDone(); },
    onError: (e: any) => toast.error(e.message ?? "فشل التسجيل"),
  });

  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>إضافة مصروف تيست</DialogTitle></DialogHeader>

      <div className="space-y-3">
        <div className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
          المتاح للتيست من تمويل هذا الشهر: <b className="text-foreground">{fmtCurrency(remaining)}</b>
        </div>

        <div className="space-y-1">
          <Label>مبلغ التيست *</Label>
          <Input type="number" min="0" step="0.01" dir="ltr" value={amount}
            onChange={(e) => setAmount(e.target.value)} />
        </div>

        <div className="space-y-1">
          <Label>المنتج الذي تم اختباره *</Label>
          {product ? (
            <div className="flex items-center justify-between rounded-md border p-2">
              <span className="text-sm">{product.name}</span>
              <Button size="sm" variant="ghost" onClick={() => { setProduct(null); setProductQuery(""); }}>
                تغيير
              </Button>
            </div>
          ) : (
            <>
              <Input
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                placeholder="ابحث في المنتجات أو اكتب الاسم"
              />
              {productMatches.length > 0 && (
                <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
                  {productMatches.map((p) => (
                    <button
                      key={p.id} type="button"
                      className="w-full text-right px-2.5 py-1.5 text-sm hover:bg-muted"
                      onClick={() => { setProduct(p); setProductQuery(p.name); }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>تاريخ الاختبار *</Label>
            <Input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>إلى تاريخ (اختياري)</Label>
            <Input type="date" value={testEndDate} onChange={(e) => setTestEndDate(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1">
          <Label>النتيجة</Label>
          <Select value={result} onValueChange={setResult}>
            <SelectTrigger><SelectValue placeholder="اختر النتيجة" /></SelectTrigger>
            <SelectContent>
              {Object.entries(TEST_RESULT_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border p-3 space-y-3">
          <div className="text-xs font-medium text-muted-foreground">
            تفاصيل الأداء (اختيارية — اتركها فارغة لو غير متاحة)
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">عدد الطلبات</Label>
              <Input type="number" min="0" dir="ltr" value={ordersGenerated}
                onChange={(e) => setOrdersGenerated(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">الطلبات المسلمة</Label>
              <Input type="number" min="0" dir="ltr" value={deliveredOrders}
                onChange={(e) => setDeliveredOrders(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">العائد / العمولة</Label>
              <Input type="number" min="0" step="0.01" dir="ltr" value={revenue}
                onChange={(e) => setRevenue(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">التكلفة لكل طلب</Label>
              <Input type="number" min="0" step="0.01" dir="ltr" value={costPerOrder}
                onChange={(e) => setCostPerOrder(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <Label>ملاحظات</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
      </div>

      <DialogFooter>
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending && <Loader2 className="h-4 w-4 ml-1 animate-spin" />}
          حفظ
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

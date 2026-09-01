import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtCurrency } from "@/lib/format";
import { TEST_RESULT_LABELS, LEGACY_TEST_PRODUCT_PLACEHOLDER } from "@/lib/constants";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";

export type TestSpendEntry = {
  id: string;
  amount: number;
  test_date: string;
  test_end_date: string | null;
  product_id: string | null;
  product_name: string | null;
  result: string | null;
  notes: string | null;
  orders_generated: number | null;
  delivered_orders: number | null;
  revenue_generated: number | null;
  cost_per_order: number | null;
  source_transaction_id: string | null;
  products?: { name: string } | null;
};

/**
 * Add or edit one test entry.
 *
 * In edit mode the amount is intentionally read-only: this dialog exists to
 * complete the *operational* record (which product, when, how it went), and
 * the amount is the financial classification — it stays with the existing
 * authorised money flow rather than being editable from here.
 */
export function TestSpendDialog({
  marketerId, entry, defaultDate, remaining, onDone,
}: {
  marketerId: string;
  entry?: TestSpendEntry;
  defaultDate: string;
  remaining: number;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const isEdit = !!entry;
  const startedUnlisted =
    !!entry && !entry.product_id && entry.product_name !== LEGACY_TEST_PRODUCT_PLACEHOLDER;

  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [testDate, setTestDate] = useState(entry?.test_date ?? defaultDate);
  const [testEndDate, setTestEndDate] = useState(entry?.test_end_date ?? "");
  const [result, setResult] = useState<string>(entry?.result ?? "in_progress");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [ordersGenerated, setOrdersGenerated] = useState(entry?.orders_generated?.toString() ?? "");
  const [deliveredOrders, setDeliveredOrders] = useState(entry?.delivered_orders?.toString() ?? "");
  const [revenue, setRevenue] = useState(entry?.revenue_generated?.toString() ?? "");
  const [costPerOrder, setCostPerOrder] = useState(entry?.cost_per_order?.toString() ?? "");

  // Product: pick from the catalogue by default; only fall back to free text
  // when the user explicitly says the product isn't listed.
  const [unlisted, setUnlisted] = useState(startedUnlisted);
  const [product, setProduct] = useState<{ id: string; name: string } | null>(
    entry?.product_id ? { id: entry.product_id, name: entry.products?.name ?? entry.product_name ?? "" } : null,
  );
  const [search, setSearch] = useState("");
  const [freeText, setFreeText] = useState(
    startedUnlisted ? (entry?.product_name ?? "") : "",
  );

  const { data: matches = [], isFetching } = useQuery({
    queryKey: ["product-search", search],
    enabled: !unlisted && !product && search.trim().length >= 2,
    queryFn: async () => {
      const { data } = await supabase
        .from("products").select("id, name")
        .ilike("name", `%${search.trim()}%`).limit(8);
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const mut = useMutation({
    mutationFn: async () => {
      const productName = unlisted ? freeText.trim() : product?.name ?? "";
      if (!productName) throw new Error("اختر المنتج من القائمة أو اكتب اسمه");
      if (!result) throw new Error("اختر نتيجة الاختبار");
      if (!testDate) throw new Error("أدخل تاريخ بداية الاختبار");

      const payload = {
        test_date: testDate,
        test_end_date: testEndDate || null,
        product_id: unlisted ? null : product?.id ?? null,
        product_name: productName,
        result,
        notes: notes.trim() || null,
        orders_generated: num(ordersGenerated),
        delivered_orders: num(deliveredOrders),
        revenue_generated: num(revenue),
        cost_per_order: num(costPerOrder),
      };

      if (isEdit) {
        // Amount deliberately excluded — descriptive edit only.
        const { error } = await supabase
          .from("test_spend_entries").update(payload).eq("id", entry!.id);
        if (error) throw error;
        return;
      }

      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error("أدخل مبلغ تيست صحيح");
      const { error } = await supabase.from("test_spend_entries").insert({
        ...payload,
        marketer_id: marketerId,
        amount: amt,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(isEdit ? "تم تحديث بيانات الاختبار" : "تم تسجيل مصروف التيست");
      onDone();
    },
    onError: (e: any) => toast.error(e.message ?? "فشل الحفظ"),
  });

  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{isEdit ? "تعديل بيانات الاختبار" : "إضافة مصروف تيست"}</DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        {!isEdit && (
          <div className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
            المتاح للتيست من تمويل هذا الشهر: <b className="text-foreground">{fmtCurrency(remaining)}</b>
          </div>
        )}

        {/* Product */}
        <div className="space-y-1.5">
          <Label>المنتج *</Label>
          {unlisted ? (
            <>
              <Input
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="اكتب اسم المنتج"
              />
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => { setUnlisted(false); setFreeText(""); }}
              >
                رجوع للاختيار من قائمة المنتجات
              </button>
            </>
          ) : product ? (
            <div className="flex items-center justify-between rounded-md border p-2">
              <span className="text-sm">{product.name}</span>
              <Button size="sm" variant="ghost" onClick={() => { setProduct(null); setSearch(""); }}>
                <X className="h-3.5 w-3.5 ml-1" /> تغيير
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ابحث باسم المنتج (حرفين على الأقل)"
                  className="pr-9"
                />
              </div>
              {search.trim().length >= 2 && (
                <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
                  {isFetching ? (
                    <div className="px-2.5 py-2 text-sm text-muted-foreground">جاري البحث...</div>
                  ) : matches.length === 0 ? (
                    <div className="px-2.5 py-2 text-sm text-muted-foreground">لا توجد نتائج</div>
                  ) : matches.map((p) => (
                    <button
                      key={p.id} type="button"
                      className="w-full text-right px-2.5 py-1.5 text-sm hover:bg-muted"
                      onClick={() => setProduct(p)}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => { setUnlisted(true); setProduct(null); }}
              >
                منتج غير موجود بالقائمة
              </button>
            </>
          )}
        </div>

        {/* Amount — new entries only */}
        {isEdit ? (
          <div className="space-y-1">
            <Label>مبلغ التيست</Label>
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
              {fmtCurrency(Number(entry!.amount))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              المبلغ لا يُعدَّل من هنا — التعديل هنا للبيانات الوصفية فقط.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <Label>مبلغ التيست *</Label>
            <Input type="number" min="0" step="0.01" dir="ltr" value={amount}
              onChange={(e) => setAmount(e.target.value)} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>تاريخ بداية الاختبار *</Label>
            <Input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>تاريخ نهاية الاختبار</Label>
            <Input type="date" value={testEndDate} onChange={(e) => setTestEndDate(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1">
          <Label>النتيجة *</Label>
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
            نتائج الاختبار (اختيارية — سيبها فاضية لو غير متاحة، مش هتتحسب أصفار)
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">عدد الأوردرات الناتجة</Label>
              <Input type="number" min="0" dir="ltr" value={ordersGenerated}
                onChange={(e) => setOrdersGenerated(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">عدد الأوردرات المسلمة</Label>
              <Input type="number" min="0" dir="ltr" value={deliveredOrders}
                onChange={(e) => setDeliveredOrders(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">الإيراد / العمولة</Label>
              <Input type="number" min="0" step="0.01" dir="ltr" value={revenue}
                onChange={(e) => setRevenue(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cost Per Order</Label>
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

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/format";
import { ChevronDown, FlaskConical, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type Inputs = { shipped: string; delivered: string; commission: string; adSpend: string };
const EMPTY: Inputs = { shipped: "0", delivered: "0", commission: "0", adSpend: "0" };

/**
 * Read-only what-if simulator.
 * All figures come from the read-only preview_bonus_scenario helper, which reuses
 * the same calculation rules server-side and never writes to the database.
 */
export function BonusSimulator({
  marketerId,
  year,
  month,
  bonus,
}: {
  marketerId: string;
  year: number;
  month: number;
  bonus: any;
}) {
  const [open, setOpen] = useState(false);
  const [inp, setInp] = useState<Inputs>(EMPTY);
  const [result, setResult] = useState<any>(null);

  const baseShipped = Number(bonus.shipped_orders_count ?? 0);
  const baseDelivered = Number(bonus.delivered_orders_count ?? 0);

  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const run = useMutation({
    mutationFn: async () => {
      const shipped = num(inp.shipped);
      const delivered = num(inp.delivered);
      const commission = num(inp.commission);
      const adSpend = num(inp.adSpend);
      if ([shipped, delivered, commission, adSpend].some((v) => !Number.isFinite(v))) {
        throw new Error("برجاء إدخال أرقام صحيحة");
      }
      if ([shipped, delivered, commission, adSpend].some((v) => v < 0)) {
        throw new Error("لا يمكن إدخال قيم بالسالب");
      }
      if (baseDelivered + delivered > baseShipped + shipped) {
        throw new Error("عدد الطلبات المسلمة المتوقعة لا يمكن أن يتجاوز الطلبات التي خرجت للشحن");
      }
      const { data, error } = await (supabase.rpc as any)("preview_bonus_scenario", {
        _marketer_id: marketerId,
        _year: year,
        _month: month,
        _extra_shipped: Math.round(shipped),
        _extra_delivered: Math.round(delivered),
        _extra_commission: commission,
        _extra_ad_spend: adSpend,
      });
      if (error) throw new Error("تعذر تنفيذ المحاكاة، برجاء المحاولة مرة أخرى");
      return data;
    },
    onSuccess: (d) => setResult(d),
    onError: (e: any) => toast.error(e?.message ?? "تعذر تنفيذ المحاكاة"),
  });

  const diff = result
    ? Number(result.system_calculated_total) - Number(result.current_system_calculated_total)
    : 0;

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer flex flex-row items-center justify-between">
            <CardTitle className="text-base inline-flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-primary" /> جرّب سيناريو مختلف
            </CardTitle>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-warning-foreground" />
              <div>
                هذه محاكاة تقديرية فقط ولا تغيّر المستحقات الفعلية أو الحسبة المعتمدة.
                {(bonus.is_locked || bonus.workflow_status === "locked") && (
                  <div className="mt-1 text-muted-foreground">
                    هذا الشهر معتمد ومقفول، والسجل الرسمي لا يتغير.
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Field label="طلبات إضافية خرجت للشحن" value={inp.shipped} onChange={(v) => setInp({ ...inp, shipped: v })} />
              <Field label="طلبات مسلمة إضافية" value={inp.delivered} onChange={(v) => setInp({ ...inp, delivered: v })} />
              <Field label="عمولات إضافية (ج.م)" value={inp.commission} onChange={(v) => setInp({ ...inp, commission: v })} />
              <Field label="إنفاق إعلاني إضافي (ج.م)" value={inp.adSpend} onChange={(v) => setInp({ ...inp, adSpend: v })} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => run.mutate()} disabled={run.isPending}>
                {run.isPending && <Loader2 className="h-4 w-4 ml-1 animate-spin" />} احسب السيناريو
              </Button>
              <Button variant="ghost" onClick={() => { setInp(EMPTY); setResult(null); }}>
                إعادة الضبط
              </Button>
            </div>

            {result && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Out label="خرج للشحن المتوقع" value={`${fmtNumber(result.shipped_orders_count)} طلب`} />
                  <Out label="المسلم المتوقع" value={`${fmtNumber(result.delivered_orders_count)} طلب`} />
                  <Out label="نسبة التسليم المتوقعة" value={fmtPercent(Number(result.delivery_rate ?? 0))} />
                  <Out label="الباقة حسب حجم الطلبات" value={result.volume_tier_name_snapshot ?? "—"} />
                  <Out label="الباقة المستحقة المتوقعة" value={result.earned_tier_name_snapshot ?? "—"} />
                  <Out
                    label="صافي الربح المتوقع"
                    value={fmtCurrency(result.net_profit_before_bonus)}
                    tone={Number(result.net_profit_before_bonus) > 0 ? "text-success" : "text-destructive"}
                  />
                  <Out label="الراتب المتوقع" value={fmtCurrency(result.calculated_salary)} />
                  <Out label="بونص الأرباح المتوقع" value={fmtCurrency(result.calculated_profit_bonus)} />
                  <Out label="الطلبات الإضافية المتوقعة" value={`${fmtNumber(result.extra_delivered_orders)} طلب`} />
                  <Out label="مكافأة الطلبات الإضافية" value={fmtCurrency(result.calculated_extra_orders_bonus)} />
                  <Out label="حسبة النظام المتوقعة" value={fmtCurrency(result.system_calculated_total)} tone="text-primary" />
                  <Out
                    label="الفرق عن الحسبة الحالية"
                    value={`${diff > 0 ? "+ " : diff < 0 ? "- " : ""}${fmtCurrency(Math.abs(diff))}`}
                    tone={diff > 0 ? "text-success" : diff < 0 ? "text-destructive" : ""}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  المحاكاة لا تشمل التسوية اليدوية الحالية ({fmtCurrency(bonus.manual_adjustment_amount)})، وهي أرقام
                  تقديرية غير مضمونة.
                </p>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Out({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-display font-bold text-sm mt-0.5 ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

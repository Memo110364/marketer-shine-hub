import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/format";
import { AlertTriangle, Info } from "lucide-react";

/**
 * "لماذا استحققت هذا المبلغ؟"
 * Step-by-step, read-only explanation built only from the saved monthly snapshot.
 * No authoritative total is recomputed here.
 */
export function BonusExplanation({ bonus }: { bonus: any }) {
  const n = (v: unknown) => Number(v ?? 0);
  const adjustment = n(bonus.manual_adjustment_amount);
  const downgraded =
    bonus.volume_tier_order_snapshot != null &&
    bonus.earned_tier_order_snapshot != null &&
    n(bonus.earned_tier_order_snapshot) < n(bonus.volume_tier_order_snapshot);
  const noProfitBonus = n(bonus.net_profit_before_bonus) <= 0;

  const steps: { label: string; value: string; tone?: string }[] = [
    { label: "خرج للشحن", value: `${fmtNumber(bonus.shipped_orders_count)} طلب` },
    { label: "تم التسليم", value: `${fmtNumber(bonus.delivered_orders_count)} طلب` },
    { label: "نسبة التسليم", value: fmtPercent(n(bonus.delivery_rate)) },
    { label: "الباقة حسب حجم الطلبات", value: bonus.volume_tier_name_snapshot ?? "—" },
    { label: "الباقة المستحقة", value: bonus.earned_tier_name_snapshot ?? "—" },
    { label: "الراتب", value: fmtCurrency(bonus.calculated_salary) },
    { label: "بونص الأرباح", value: fmtCurrency(bonus.calculated_profit_bonus) },
    { label: "الطلبات الإضافية", value: `${fmtNumber(bonus.extra_delivered_orders)} طلب` },
    { label: "مكافأة الطلبات الإضافية", value: fmtCurrency(bonus.calculated_extra_orders_bonus) },
    { label: "حسبة النظام", value: fmtCurrency(bonus.system_calculated_total), tone: "text-primary" },
    {
      label: "التسوية",
      value: `${adjustment > 0 ? "+ " : adjustment < 0 ? "- " : ""}${fmtCurrency(Math.abs(adjustment))}`,
      tone: adjustment > 0 ? "text-success" : adjustment < 0 ? "text-destructive" : "",
    },
    { label: "المستحق النهائي", value: fmtCurrency(bonus.final_approved_amount), tone: "text-primary" },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">لماذا استحققت هذا المبلغ؟</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li
              key={s.label}
              className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{s.label}</span>
              </span>
              <span className={`font-display font-bold ${s.tone ?? ""}`}>{s.value}</span>
            </li>
          ))}
        </ol>

        {downgraded && (
          <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-warning-foreground" />
            <span>
              تم تخفيض الباقة من {bonus.volume_tier_name_snapshot} إلى {bonus.earned_tier_name_snapshot} بسبب عدم
              تحقيق نسبة التسليم المطلوبة للباقة الأعلى.
            </span>
          </div>
        )}

        {noProfitBonus && (
          <div className="flex items-start gap-2 rounded-xl border bg-muted/40 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <span>لم يتم احتساب بونص أرباح لأن صافي الربح بعد خصم الإعلانات والمصروفات غير موجب.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

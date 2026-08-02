import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/format";
import type { Tier } from "@/components/bonus/TierProgress";

/** Read-only breakdown of the saved monthly snapshot. No values are recomputed here. */
export function BonusBreakdown({ bonus, earnedTier }: { bonus: any; earnedTier?: Tier }) {
  const n = (v: unknown) => Number(v ?? 0);
  const shipped = n(bonus.shipped_orders_count);
  const baseSalary = n(earnedTier?.base_salary);
  const salaryThreshold = n(earnedTier?.min_shipped_orders);
  const proportional = salaryThreshold > 0 && shipped < salaryThreshold;
  const netProfit = n(bonus.net_profit_before_bonus);
  const pct = n(earnedTier?.bonus_percentage);
  const perExtra = n(earnedTier?.extra_delivered_order_amount);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">تفاصيل الاحتساب</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <Section title="أ. مدخلات الأداء">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Row label="خرج للشحن" value={`${fmtNumber(shipped)} طلب`} />
            <Row label="تم التسليم" value={`${fmtNumber(bonus.delivered_orders_count)} طلب`} />
            <Row label="نسبة التسليم" value={fmtPercent(n(bonus.delivery_rate))} />
            <Row label="العمولات المحققة" value={fmtCurrency(bonus.realized_commission)} />
            <Row label="الإنفاق الإعلاني" value={fmtCurrency(bonus.ad_spend)} />
            <Row label="المصروفات الأخرى" value={fmtCurrency(bonus.other_expenses)} />
            <Row
              label="صافي الربح قبل البونص"
              value={fmtCurrency(netProfit)}
              className={netProfit > 0 ? "text-success" : "text-destructive"}
            />
          </div>
        </Section>

        <Section title="ب. الراتب">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Row label="الباقة المستحقة" value={bonus.earned_tier_name_snapshot ?? "—"} />
            <Row label="راتب الباقة" value={earnedTier ? fmtCurrency(baseSalary) : "—"} />
            {proportional && (
              <Row
                label="نسبة الإنجاز"
                value={`${fmtNumber(shipped)} من ${fmtNumber(salaryThreshold)} طلب`}
              />
            )}
            <Row
              label={proportional ? "الراتب النسبي" : "الراتب"}
              value={fmtCurrency(bonus.calculated_salary)}
              className="text-primary"
            />
          </div>
          {proportional && (
            <p className="text-xs text-muted-foreground mt-2">
              الراتب محسوب بشكل نسبي لأن عدد الطلبات التي خرجت للشحن أقل من الحد الأدنى للباقة.
            </p>
          )}
        </Section>

        <Section title="ج. بونص الأرباح">
          {netProfit <= 0 ? (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
              لا يوجد بونص أرباح لأن صافي الربح غير موجب
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <Row label="صافي الربح قبل البونص" value={fmtCurrency(netProfit)} />
              <Row label="نسبة البونص" value={earnedTier ? fmtPercent(pct > 1 ? pct / 100 : pct) : "—"} />
              <Row label="بونص الأرباح" value={fmtCurrency(bonus.calculated_profit_bonus)} className="text-primary" />
            </div>
          )}
        </Section>

        <Section title="د. مكافأة الطلبات الإضافية">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Row label="الطلبات الإضافية" value={`${fmtNumber(bonus.extra_delivered_orders)} طلب`} />
            <Row label="قيمة المكافأة لكل طلب" value={earnedTier ? fmtCurrency(perExtra) : "—"} />
            <Row
              label="إجمالي المكافأة"
              value={fmtCurrency(bonus.calculated_extra_orders_bonus)}
              className="text-success"
            />
          </div>
        </Section>

        <Section title="هـ. حسبة النظام">
          <div className="rounded-xl border bg-muted/40 p-4 space-y-2 text-sm">
            <Line label="الراتب" value={fmtCurrency(bonus.calculated_salary)} />
            <Line label="+ بونص الأرباح" value={fmtCurrency(bonus.calculated_profit_bonus)} />
            <Line label="+ مكافأة الطلبات الإضافية" value={fmtCurrency(bonus.calculated_extra_orders_bonus)} />
            <div className="border-t pt-2 flex items-center justify-between font-display font-bold text-base">
              <span>= حسبة النظام</span>
              <span className="text-primary">{fmtCurrency(bonus.system_calculated_total)}</span>
            </div>
          </div>
        </Section>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-medium mb-2">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-display font-bold text-base mt-0.5 ${className ?? ""}`}>{value}</div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

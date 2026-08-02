import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtNumber } from "@/lib/format";
import { TierChip } from "@/components/bonus/BonusBadges";
import { Trophy } from "lucide-react";

export type Tier = {
  id: string;
  tier_name_ar: string;
  tier_name_en: string | null;
  tier_order: number;
  min_shipped_orders: number;
  color_hex: string | null;
  base_salary: number;
  bonus_percentage: number;
  minimum_delivery_rate: number;
  extra_delivered_order_amount: number;
  is_active: boolean;
};

const BELOW_LABEL = "أقل من التدريبية";
const BELOW_COLOR = "hsl(var(--muted-foreground))";

/**
 * Presentation-only horizontal volume tier progress.
 * Thresholds come from bonus_tiers.min_shipped_orders — nothing is hardcoded.
 */
export function TierProgress({
  shipped,
  tiers,
  volumeTierName,
}: {
  shipped: number;
  tiers: Tier[];
  volumeTierName?: string | null;
}) {
  const stages = useMemo(
    () =>
      [...tiers]
        .filter((t) => t.is_active !== false)
        .sort((a, b) => a.min_shipped_orders - b.min_shipped_orders),
    [tiers],
  );

  if (stages.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground text-center">
          إعدادات الباقات غير متوفرة حاليًا — لا يمكن عرض شريط التقدم.
        </CardContent>
      </Card>
    );
  }

  const maxThreshold = stages[stages.length - 1].min_shipped_orders;
  // Index of the highest reached stage, -1 means below the first tier.
  let reachedIdx = -1;
  stages.forEach((t, i) => {
    if (shipped >= t.min_shipped_orders) reachedIdx = i;
  });
  const current = reachedIdx >= 0 ? stages[reachedIdx] : null;
  const next = reachedIdx + 1 < stages.length ? stages[reachedIdx + 1] : null;
  const remaining = next ? Math.max(0, next.min_shipped_orders - shipped) : 0;

  // Segments: [below] + one per tier. Each occupies an equal share of the bar.
  const segments = [
    { label: BELOW_LABEL, color: BELOW_COLOR, from: 0, to: stages[0].min_shipped_orders },
    ...stages.map((t, i) => ({
      label: t.tier_name_ar,
      color: t.color_hex || BELOW_COLOR,
      from: t.min_shipped_orders,
      to: i + 1 < stages.length ? stages[i + 1].min_shipped_orders : Math.max(maxThreshold * 1.2, shipped),
    })),
  ];
  const segWidth = 100 / segments.length;
  const segIdx = reachedIdx + 1;
  const seg = segments[segIdx];
  const within =
    seg.to > seg.from ? Math.min(1, Math.max(0, (shipped - seg.from) / (seg.to - seg.from))) : 1;
  const pct = Math.min(100, segIdx * segWidth + within * segWidth);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base inline-flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" /> تقدّم الباقة حسب عدد الطلبات
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <div className="text-xs text-muted-foreground">أنت حاليًا في</div>
            <div className="mt-1">
              {current ? (
                <TierChip name={volumeTierName ?? current.tier_name_ar} colorHex={current.color_hex} />
              ) : (
                <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {BELOW_LABEL}
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">خرج للشحن</div>
            <div className="font-display font-bold text-xl mt-0.5">{fmtNumber(shipped)} طلب</div>
          </div>
          <div>
            {next ? (
              <>
                <div className="text-xs text-muted-foreground">
                  متبقي للوصول إلى {next.tier_name_ar}
                </div>
                <div className="font-display font-bold text-xl mt-0.5 text-primary">
                  {fmtNumber(remaining)} طلب
                </div>
                <div className="text-[11px] text-muted-foreground">
                  الحد المطلوب: {fmtNumber(next.min_shipped_orders)} طلب
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success">
                تم الوصول إلى أعلى باقة
              </div>
            )}
          </div>
        </div>

        {/* Bar */}
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="relative h-3 w-full rounded-full overflow-hidden flex">
              {segments.map((s, i) => (
                <div
                  key={s.label}
                  className="h-full"
                  style={{
                    width: `${segWidth}%`,
                    backgroundColor: s.color,
                    opacity: i <= segIdx ? 0.95 : 0.15,
                  }}
                />
              ))}
              <div
                className="absolute top-1/2 -translate-y-1/2 h-5 w-5 rounded-full border-2 border-background shadow-md bg-primary"
                style={{ insetInlineStart: `calc(${pct}% - 10px)` }}
              />
            </div>
            <div className="mt-2 flex">
              {segments.map((s, i) => (
                <div key={s.label} className="text-center" style={{ width: `${segWidth}%` }}>
                  <div
                    className={`text-[11px] font-medium ${i <= segIdx ? "" : "text-muted-foreground"}`}
                    style={i <= segIdx ? { color: s.color } : undefined}
                  >
                    {s.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {i === 0 ? `< ${fmtNumber(stages[0].min_shipped_orders)}` : fmtNumber(s.from)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          يعكس هذا الشريط تقدّم عدد الطلبات فقط ولا يحدد الباقة المستحقة النهائية.
        </p>
      </CardContent>
    </Card>
  );
}

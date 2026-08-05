import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TierChip } from "@/components/bonus/BonusBadges";
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/format";
import { monthLabel } from "@/lib/bonus";
import type { Tier } from "@/components/bonus/TierProgress";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

type Metric = "shipped" | "delivered" | "rate" | "final";

const METRICS: { key: Metric; label: string }[] = [
  { key: "shipped", label: "الطلبات التي خرجت للشحن" },
  { key: "delivered", label: "الطلبات المسلمة" },
  { key: "rate", label: "نسبة التسليم" },
  { key: "final", label: "المستحق النهائي" },
];

/** Six-month trend built from the latest saved monthly records (missing months are omitted). */
export function BonusTrend({ history, tiers }: { history: any[]; tiers: Tier[] }) {
  const [metric, setMetric] = useState<Metric>("shipped");

  const data = useMemo(
    () =>
      [...history]
        .sort((a, b) =>
          a.bonus_year === b.bonus_year ? a.bonus_month - b.bonus_month : a.bonus_year - b.bonus_year,
        )
        .slice(-6)
        .map((h) => ({
          name: monthLabel(h.bonus_year, h.bonus_month),
          shipped: Number(h.shipped_orders_count ?? 0),
          delivered: Number(h.delivered_orders_count ?? 0),
          rate: Number(h.delivery_rate ?? 0) * 100,
          final: Number(h.final_approved_amount ?? 0),
          tier: h.earned_tier_name_snapshot as string | null,
        })),
    [history],
  );

  const tierColor = (name: string | null | undefined) =>
    tiers.find((t) => t.tier_name_ar === name || t.tier_name_en === name)?.color_hex;

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">تطور الأداء</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground text-center py-6">
          لا توجد شهور محفوظة لعرض تطور الأداء
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3 gap-3">
        <CardTitle className="text-base">تطور الأداء خلال آخر 6 شهور</CardTitle>
        <div className="flex flex-wrap gap-2">
          {METRICS.map((m) => (
            <Button
              key={m.key}
              size="sm"
              variant={metric === m.key ? "default" : "outline"}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-64 w-full" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => (metric === "rate" ? `${Math.round(v)}%` : fmtNumber(v))}
                width={60}
              />
              <Tooltip content={<TrendTooltip />} />
              <Line
                type="monotone"
                dataKey={metric}
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.map((d) => (
            <div key={d.name} className="rounded-xl border px-3 py-1.5 text-xs flex items-center gap-2">
              <span className="text-muted-foreground">{d.name}</span>
              <TierChip name={d.tier} colorHex={tierColor(d.tier)} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TrendTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-xl border bg-background p-3 text-xs shadow-md space-y-1" dir="rtl">
      <div className="font-medium">{d.name}</div>
      <div>خرج للشحن: {fmtNumber(d.shipped)}</div>
      <div>تم التسليم: {fmtNumber(d.delivered)}</div>
      <div>نسبة التسليم: {fmtPercent(d.rate / 100)}</div>
      <div>الباقة المستحقة: {d.tier ?? "—"}</div>
      <div>المستحق النهائي: {fmtCurrency(d.final)}</div>
    </div>
  );
}

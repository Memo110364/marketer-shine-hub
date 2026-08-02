import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate } from "@/lib/format";
import { CircleDot } from "lucide-react";

const STAGES: { key: string; label: string; marketerLabel: string }[] = [
  { key: "calculated_at", label: "تم الاحتساب", marketerLabel: "تم احتساب المستحقات" },
  { key: "recalculated_at", label: "إعادة احتساب", marketerLabel: "تم تحديث الاحتساب" },
  { key: "reviewed_at", label: "تمت المراجعة", marketerLabel: "تمت المراجعة" },
  { key: "adjustment_proposed_at", label: "تسوية مقترحة", marketerLabel: "جارٍ تعديل المستحقات" },
  { key: "approved_at", label: "تم الاعتماد", marketerLabel: "تم اعتماد المستحقات" },
  { key: "locked_at", label: "تم القفل", marketerLabel: "تم إغلاق الشهر" },
];

export function BonusTimeline({ bonus, isMarketer }: { bonus: any; isMarketer: boolean }) {
  const items = STAGES.filter((s) => !!bonus[s.key]);
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">مسار الحالة</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {items.map((s) => (
            <li key={s.key} className="flex items-start gap-3 text-sm">
              <CircleDot className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <div className="flex-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{isMarketer ? s.marketerLabel : s.label}</span>
                <span className="text-muted-foreground text-xs">{fmtDate(bonus[s.key])}</span>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

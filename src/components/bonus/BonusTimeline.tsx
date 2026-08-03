import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { CircleDot, History } from "lucide-react";

const STAGES: { key: string; label: string; marketerLabel: string }[] = [
  { key: "calculated_at", label: "تم الاحتساب", marketerLabel: "تم احتساب المستحقات" },
  { key: "recalculated_at", label: "إعادة احتساب", marketerLabel: "تم تحديث الاحتساب" },
  { key: "reviewed_at", label: "تمت المراجعة", marketerLabel: "تمت المراجعة" },
  { key: "adjustment_proposed_at", label: "تسوية مقترحة", marketerLabel: "جارٍ تعديل المستحقات" },
  { key: "approved_at", label: "تم الاعتماد", marketerLabel: "تم اعتماد المستحقات" },
  { key: "locked_at", label: "تم القفل", marketerLabel: "تم إغلاق الشهر" },
];

const ACTION_LABELS: Record<string, string> = {
  calculated: "تم الاحتساب",
  recalculated: "إعادة احتساب",
  submitted_for_review: "بدء المراجعة",
  adjustment_proposed: "اقتراح تسوية",
  adjustment_cleared: "إلغاء التسوية",
  approved: "اعتماد المستحقات",
  locked: "قفل الشهر",
  unlocked: "إعادة فتح الشهر",
};

export type AuditLog = {
  id: string;
  action_type: string;
  field_name: string | null;
  old_value: any;
  new_value: any;
  reason: string | null;
  performed_at: string;
  performed_by: string;
  actor_name?: string | null;
};

export function BonusTimeline({
  bonus,
  isMarketer,
  logs = [],
}: {
  bonus: any;
  isMarketer: boolean;
  logs?: AuditLog[];
}) {
  const items = STAGES.filter((s) => !!bonus[s.key]);
  const showLogs = !isMarketer && logs.length > 0;
  if (items.length === 0 && !showLogs) return null;

  const money = (v: any) =>
    v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : fmtCurrency(Number(v));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">مسار الحالة</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.length > 0 && (
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
        )}

        {showLogs && (
          <div className="space-y-2 border-t pt-3">
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <History className="h-3.5 w-3.5" /> سجل التغييرات
            </div>
            <ol className="space-y-3">
              {logs.map((l) => {
                const oldM = money(l.old_value);
                const newM = money(l.new_value);
                return (
                  <li key={l.id} className="rounded-xl border bg-muted/30 p-3 text-sm space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{ACTION_LABELS[l.action_type] ?? l.action_type}</span>
                      <span className="text-muted-foreground text-xs">{fmtDate(l.performed_at)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      بواسطة: {l.actor_name || "مستخدم النظام"}
                    </div>
                    {(oldM || newM) && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">القيمة: </span>
                        {oldM ?? "—"} ← {newM ?? "—"}
                      </div>
                    )}
                    {l.reason && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">السبب: </span>
                        {l.reason}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

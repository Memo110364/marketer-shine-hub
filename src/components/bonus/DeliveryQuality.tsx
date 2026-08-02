import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtNumber, fmtPercent } from "@/lib/format";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

export function DeliveryQuality({
  shipped,
  delivered,
  actualRate,
  requiredRate,
  minimumDelivered,
}: {
  shipped: number;
  delivered: number;
  actualRate: number;
  requiredRate: number;
  minimumDelivered: number;
}) {
  const diff = delivered - minimumDelivered;
  const achieved = diff >= 0;
  const ratio = requiredRate > 0 ? actualRate / requiredRate : 1;
  const close = !achieved && ratio >= 0.9;

  const tone = achieved
    ? { text: "text-success", bar: "bg-success", box: "border-success/30 bg-success/10", Icon: CheckCircle2 }
    : close
      ? { text: "text-warning-foreground", bar: "bg-warning", box: "border-warning/30 bg-warning/10", Icon: AlertTriangle }
      : { text: "text-destructive", bar: "bg-destructive", box: "border-destructive/30 bg-destructive/10", Icon: XCircle };

  const width = Math.min(100, Math.max(0, ratio * 100));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">جودة التسليم</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Item label="خرج للشحن" value={`${fmtNumber(shipped)} طلب`} />
          <Item label="تم التسليم" value={`${fmtNumber(delivered)} طلب`} />
          <Item label="نسبة التسليم الفعلية" value={fmtPercent(actualRate)} className={tone.text} />
          <Item label="النسبة المطلوبة" value={fmtPercent(requiredRate)} />
        </div>

        <div>
          <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${width}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
            <span>الحد الأدنى المطلوب: {fmtNumber(minimumDelivered)} طلب مسلم</span>
            <span>تم تحقيق: {fmtNumber(delivered)} طلب</span>
          </div>
        </div>

        <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${tone.box}`}>
          <tone.Icon className={`h-4 w-4 mt-0.5 ${tone.text}`} />
          <div>
            {achieved ? (
              <div className="font-medium">تم تحقيق الحد الأدنى لنسبة التسليم</div>
            ) : (
              <>
                <div className="font-medium">
                  تحتاج إلى {fmtNumber(Math.abs(diff))} طلبات مسلمة إضافية لتحقيق الحد الأدنى الحالي
                </div>
                <div className="text-muted-foreground text-xs mt-0.5">
                  هذا الرقم لقطة حالية بناءً على حسبة الشهر المحفوظة، وقد يتغير عند إعادة الاحتساب.
                </div>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Item({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-display font-bold text-lg mt-0.5 ${className ?? ""}`}>{value}</div>
    </div>
  );
}

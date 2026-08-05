import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Star, Lightbulb } from "lucide-react";
import { buildRecommendations, performanceScore } from "@/lib/bonus-insights";
import type { Tier } from "@/components/bonus/TierProgress";

const TONE: Record<string, string> = {
  danger: "border-destructive/30 bg-destructive/10",
  warning: "border-warning/30 bg-warning/10",
  info: "border-info/30 bg-info/10",
  success: "border-success/30 bg-success/10",
};

/** Presentation-only monthly performance score + friendly recommendations. */
export function BonusInsights({
  bonus,
  tiers,
  earnedTier,
}: {
  bonus: any;
  tiers: Tier[];
  earnedTier?: Tier;
}) {
  const score = performanceScore(bonus, earnedTier as any);
  const recs = buildRecommendations(bonus, tiers, earnedTier);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">مؤشر الأداء الشهري</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <div className="text-4xl font-display font-bold text-primary">{score.total}</div>
            <div className="text-xs text-muted-foreground">من 100</div>
            <div className="mt-2 flex items-center justify-center gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <Star
                  key={i}
                  className={`h-5 w-5 ${i <= score.stars ? "fill-primary text-primary" : "text-muted-foreground/40"}`}
                />
              ))}
            </div>
            <div className="mt-1 text-sm font-medium">{score.label}</div>
          </div>
          <div className="space-y-2 text-xs">
            <ScoreBar label="جودة التسليم" value={score.delivery} max={50} />
            <ScoreBar label="الربحية" value={score.profitability} max={30} />
            <ScoreBar label="مستوى الباقة" value={score.tier} max={20} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            مؤشر عرض فقط لمتابعة الأداء، ولا يؤثر على الراتب أو البونص أو الباقة أو المستحقات.
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base inline-flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-primary" /> نصائح لتحسين مستحقاتك
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recs.length === 0 ? (
            <div className="text-sm text-muted-foreground">لا توجد ملاحظات على أداء هذا الشهر.</div>
          ) : (
            recs.map((r) => (
              <div key={r.id} className={`rounded-xl border p-3 text-sm ${TONE[r.tone]}`}>
                {r.text}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {value} / {max}
        </span>
      </div>
      <Progress value={(value / max) * 100} className="h-1.5 mt-1" />
    </div>
  );
}

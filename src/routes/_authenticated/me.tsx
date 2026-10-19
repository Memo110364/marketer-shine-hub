import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useOwnMarketer } from "@/lib/use-own-marketer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/KpiCard";
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/format";
import { Trophy, ShoppingBag, TrendingUp, Wallet, Percent, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/me")({
  component: MyPage,
});

type BonusPreview = {
  shipped_orders_count: number;
  delivered_orders_count: number;
  delivery_rate: number;
  realized_commission: number;
  ad_spend: number;
  net_profit_before_bonus: number;
  earned_tier_name_snapshot: string | null;
  earned_tier_order_snapshot: number | null;
  required_delivery_rate: number;
  minimum_delivered_orders: number;
  extra_delivered_orders: number;
  calculated_salary: number;
  calculated_profit_bonus: number;
  calculated_extra_orders_bonus: number;
  system_calculated_total: number;
};

type BonusTier = {
  id: string;
  tier_code: string;
  tier_name_ar: string;
  tier_order: number;
  min_shipped_orders: number;
  minimum_delivery_rate: number;
  base_salary: number;
};

function MyPage() {
  const { role } = useAuth();

  if (role && role !== "marketer") {
    throw redirect({ to: "/dashboard" });
  }

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  const { data: marketer, isLoading: loadingMarketer } = useOwnMarketer();

  const { data: preview, isLoading: loadingPreview } = useQuery({
    queryKey: ["my-bonus-preview", marketer?.id, year, month],
    enabled: !!marketer,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("preview_monthly_bonus", {
        _marketer_id: marketer!.id, _year: year, _month: month,
      });
      if (error) throw error;
      return data as BonusPreview;
    },
  });

  const { data: tiers = [] } = useQuery({
    queryKey: ["bonus-tiers-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bonus_tiers")
        .select("id, tier_code, tier_name_ar, tier_order, min_shipped_orders, minimum_delivery_rate, base_salary")
        .eq("is_active", true)
        .order("tier_order");
      if (error) throw error;
      return (data ?? []) as BonusTier[];
    },
  });

  const nextTier = preview?.earned_tier_order_snapshot != null
    ? tiers.find((t) => t.tier_order === preview.earned_tier_order_snapshot! + 1)
    : undefined;

  if (loadingMarketer) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (!marketer) {
    return (
      <Card>
        <CardContent className="p-10 text-center space-y-2">
          <p className="font-medium">حسابك لسه مش مربوط بسجل مسوّق</p>
          <p className="text-sm text-muted-foreground">تواصل مع مدير الحساب أو الأدمن عشان يربطوا حسابك.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h2 className="text-2xl font-display font-bold">أهلاً {marketer.name}</h2>
        <p className="text-sm text-muted-foreground mt-1">كود: {marketer.marketer_code} — ملخص الشهر الحالي</p>
      </div>

      {loadingPreview || !preview ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="طلبات خرجت للشحن" value={fmtNumber(preview.shipped_orders_count)} icon={ShoppingBag} />
            <KpiCard label="طلبات اتسلّمت" value={fmtNumber(preview.delivered_orders_count)} icon={ShoppingBag} tone="success" />
            <KpiCard label="نسبة التسليم" value={fmtPercent(preview.delivery_rate)} icon={Percent}
              tone={preview.delivery_rate >= preview.required_delivery_rate ? "success" : "warning"} />
            <KpiCard label="العمولة المحققة" value={fmtCurrency(preview.realized_commission)} icon={TrendingUp} tone="success" />
          </div>

          <Card className="border-primary/30">
            <CardHeader><CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" /> الباقة الحالية والبونص المتوقع
            </CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border p-4 text-center">
                  <div className="text-xs text-muted-foreground mb-1">الباقة الحالية</div>
                  <div className="text-xl font-display font-bold text-primary">
                    {preview.earned_tier_name_snapshot ?? "—"}
                  </div>
                </div>
                <div className="rounded-xl border p-4 text-center">
                  <div className="text-xs text-muted-foreground mb-1">الراتب الأساسي</div>
                  <div className="text-xl font-display font-bold">{fmtCurrency(preview.calculated_salary)}</div>
                </div>
                <div className="rounded-xl border border-success/40 bg-success/5 p-4 text-center">
                  <div className="text-xs text-muted-foreground mb-1">إجمالي البونص المتوقع (حتى الآن)</div>
                  <div className="text-xl font-display font-bold text-success">
                    {fmtCurrency(preview.system_calculated_total)}
                  </div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                بونص الأرباح: {fmtCurrency(preview.calculated_profit_bonus)} — بونص الطلبات الإضافية: {fmtCurrency(preview.calculated_extra_orders_bonus)}
              </div>

              {nextTier ? (
                <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-2">
                  <div className="font-medium text-sm">محتاج إيه عشان توصل لباقة "{nextTier.tier_name_ar}"؟</div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      عدد الطلبات المطلوب (شحن): <b>{fmtNumber(nextTier.min_shipped_orders)}</b>
                      {preview.shipped_orders_count < nextTier.min_shipped_orders && (
                        <span className="text-warning-foreground"> (ناقص {fmtNumber(nextTier.min_shipped_orders - preview.shipped_orders_count)})</span>
                      )}
                    </div>
                    <div>
                      نسبة التسليم المطلوبة: <b>{fmtPercent(nextTier.minimum_delivery_rate)}</b>
                      {preview.delivery_rate < nextTier.minimum_delivery_rate && (
                        <span className="text-warning-foreground"> (ناقص {fmtPercent(nextTier.minimum_delivery_rate - preview.delivery_rate)})</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-success/30 bg-success/5 p-3 text-sm text-success font-medium text-center">
                  🏆 إنت على أعلى باقة متاحة
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <KpiCard label="الإنفاق الإعلاني من بداية الشهر" value={fmtCurrency(preview.ad_spend)} icon={Wallet} tone="warning" />
            <KpiCard label="صافي الربح قبل البونص" value={fmtCurrency(preview.net_profit_before_bonus)} icon={TrendingUp}
              tone={preview.net_profit_before_bonus >= 0 ? "success" : "destructive"} />
          </div>
        </>
      )}
    </div>
  );
}

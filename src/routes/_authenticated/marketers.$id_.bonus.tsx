import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency, fmtDate, fmtNumber, fmtPercent } from "@/lib/format";
import { WorkflowBadge, PaymentBadge, TierChip } from "@/components/bonus/BonusBadges";
import { MONTHS_AR, lastCompletedMonth, monthLabel } from "@/lib/bonus";
import { ArrowRight, Wallet, Trophy, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/marketers/$id_/bonus")({
  component: MarketerBonusPage,
});

function MarketerBonusPage() {
  const { id } = Route.useParams();
  const { role } = useAuth();
  const qc = useQueryClient();
  const canRecalculate = role === "admin" || role === "account_manager";

  const def = lastCompletedMonth();
  const [year, setYear] = useState(def.year);
  const [month, setMonth] = useState(def.month);
  const [historyLimit, setHistoryLimit] = useState(12);

  const years = useMemo(() => {
    const cur = new Date().getFullYear();
    return [cur, cur - 1, cur - 2];
  }, []);

  const { data: m } = useQuery({
    queryKey: ["marketer", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketers").select("id, name, marketer_code").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: tiers = [] } = useQuery({
    queryKey: ["bonus-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("bonus_tiers").select("*").order("tier_order");
      return (data ?? []) as any[];
    },
  });

  const { data: bonus, isLoading: loadingBonus } = useQuery({
    queryKey: ["marketer-bonus", id, year, month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monthly_marketer_bonuses").select("*")
        .eq("marketer_id", id).eq("bonus_year", year).eq("bonus_month", month)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["marketer-bonus-history", id, historyLimit],
    queryFn: async () => {
      const { data } = await supabase
        .from("monthly_marketer_bonuses").select("*")
        .eq("marketer_id", id)
        .order("bonus_year", { ascending: false })
        .order("bonus_month", { ascending: false })
        .limit(historyLimit);
      return (data ?? []) as any[];
    },
  });

  const recalc = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("calculate_monthly_bonus", {
        _marketer_id: id, _year: year, _month: month,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("تم إعادة احتساب الشهر");
      qc.invalidateQueries({ queryKey: ["marketer-bonus", id] });
      qc.invalidateQueries({ queryKey: ["marketer-bonus-history", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "تعذر إعادة الاحتساب"),
  });

  const tierByName = (name: string | null | undefined) =>
    tiers.find((t) => t.tier_name_ar === name || t.tier_name_en === name);
  const earnedTier = bonus ? tierByName(bonus.earned_tier_name_snapshot) : undefined;
  const perExtraOrder = Number(earnedTier?.extra_delivered_order_amount ?? 0);
  const downgraded =
    bonus &&
    bonus.volume_tier_order_snapshot != null &&
    bonus.earned_tier_order_snapshot != null &&
    Number(bonus.earned_tier_order_snapshot) < Number(bonus.volume_tier_order_snapshot);

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2">
          <Link to="/marketers/$id" params={{ id }}><ArrowRight className="h-4 w-4 ml-1" /> رجوع للمسوق</Link>
        </Button>
        <h2 className="text-2xl font-display font-bold">البونص والمستحقات — {m?.name ?? ""}</h2>
        <div className="text-sm text-muted-foreground mt-1">{m?.marketer_code}</div>
      </div>

      {/* Tabs (same links used on the marketer details page) */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <Link to="/marketers/$id/expenses" params={{ id }}><Wallet className="h-4 w-4 ml-1" /> المصروفات</Link>
        </Button>
        <Button asChild>
          <Link to="/marketers/$id/bonus" params={{ id }}><Trophy className="h-4 w-4 ml-1" /> البونص والمستحقات</Link>
        </Button>
      </div>

      {/* Period + status header */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label>الشهر</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS_AR.map((label, i) => (
                  <SelectItem key={i} value={String(i + 1)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>السنة</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">حالة سير العمل</div>
            <WorkflowBadge status={bonus?.workflow_status} />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">حالة الدفع</div>
            <PaymentBadge status={bonus?.payment_status} />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">آخر احتساب</div>
            <div className="text-sm">
              {bonus?.recalculated_at || bonus?.calculated_at
                ? fmtDate(bonus.recalculated_at ?? bonus.calculated_at)
                : "—"}
            </div>
          </div>
          {canRecalculate && (
            <div className="mr-auto">
              <Button onClick={() => recalc.mutate()} disabled={recalc.isPending || bonus?.is_locked}>
                {recalc.isPending ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <RefreshCw className="h-4 w-4 ml-1" />}
                إعادة احتساب الشهر
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {loadingBonus ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !bonus ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          لا يوجد سجل بونص محفوظ لشهر {monthLabel(year, month)}
          {canRecalculate ? " — اضغط إعادة احتساب الشهر لإنشائه." : "."}
        </CardContent></Card>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <Stat label="الطلبات التي خرجت للشحن" value={fmtNumber(bonus.shipped_orders_count)} />
            <Stat label="الطلبات المسلمة" value={fmtNumber(bonus.delivered_orders_count)} />
            <Stat label="نسبة التسليم" value={fmtPercent(Number(bonus.delivery_rate ?? 0))}
              hint={`المطلوب: ${fmtPercent(Number(bonus.required_delivery_rate ?? 0))}`} />
            <Stat label="الراتب" value={fmtCurrency(bonus.calculated_salary)} />
            <Stat label="بونص الأرباح" value={fmtCurrency(bonus.calculated_profit_bonus)} />
            <Stat label="مكافأة الطلبات الإضافية" value={fmtCurrency(bonus.calculated_extra_orders_bonus)} />
            <Stat label="حسبة النظام" value={fmtCurrency(bonus.system_calculated_total)} />
            <Stat label="التسوية" value={fmtCurrency(bonus.manual_adjustment_amount)}
              hint={bonus.manual_adjustment_reason ?? undefined} />
            <Stat label="المستحق النهائي" value={fmtCurrency(bonus.final_approved_amount)} tone="primary" />
            <Stat label="المدفوع" value={fmtCurrency(bonus.total_paid_amount)} tone="success" />
            <Stat label="المتبقي" value={fmtCurrency(bonus.remaining_amount)}
              tone={Number(bonus.remaining_amount ?? 0) > 0 ? "destructive" : "success"} />
          </div>

          {/* Tiers */}
          <Card>
            <CardHeader><CardTitle className="text-base">الباقات</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">الباقة حسب عدد الطلبات</div>
                  <TierChip
                    name={bonus.volume_tier_name_snapshot}
                    colorHex={tierByName(bonus.volume_tier_name_snapshot)?.color_hex}
                  />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">الباقة المستحقة</div>
                  <TierChip name={bonus.earned_tier_name_snapshot} colorHex={earnedTier?.color_hex} />
                </div>
              </div>
              {downgraded ? (
                <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-warning-foreground" />
                  <div>
                    <div className="font-medium">
                      {bonus.volume_tier_name_snapshot} ← {bonus.earned_tier_name_snapshot}
                    </div>
                    <div className="text-muted-foreground">
                      تم تخفيض الباقة بسبب عدم تحقيق نسبة التسليم المطلوبة
                      {bonus.tier_change_reason ? ` — ${bonus.tier_change_reason}` : ""}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  تم تحقيق الباقة المستحقة بالكامل بدون تخفيض.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Extra delivered bonus */}
          <Card>
            <CardHeader><CardTitle className="text-base">مكافأة الطلبات المسلمة الإضافية</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">الحد الأدنى المطلوب</div>
                <div className="font-display font-bold text-lg">{fmtNumber(bonus.minimum_delivered_orders)} طلب</div>
              </div>
              <div>
                <div className="text-muted-foreground">تم تحقيق</div>
                <div className="font-display font-bold text-lg">{fmtNumber(bonus.delivered_orders_count)} طلب</div>
              </div>
              <div>
                <div className="text-muted-foreground">الطلبات الإضافية</div>
                <div className="font-display font-bold text-lg">{fmtNumber(bonus.extra_delivered_orders)} طلب</div>
              </div>
              <div>
                <div className="text-muted-foreground">قيمة الحافز</div>
                <div className="font-display font-bold text-lg">
                  {fmtNumber(bonus.extra_delivered_orders)} × {fmtCurrency(perExtraOrder)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">إجمالي المكافأة</div>
                <div className="font-display font-bold text-lg text-success">
                  {fmtCurrency(bonus.calculated_extra_orders_bonus)}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* History */}
      <Card>
        <CardHeader><CardTitle className="text-base">السجل الشهري</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {history.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6">لا يوجد سجل</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الشهر</TableHead>
                    <TableHead>خرج للشحن</TableHead>
                    <TableHead>تم التسليم</TableHead>
                    <TableHead>نسبة التسليم</TableHead>
                    <TableHead>الباقة المستحقة</TableHead>
                    <TableHead>حسبة النظام</TableHead>
                    <TableHead>المستحق النهائي</TableHead>
                    <TableHead>المدفوع</TableHead>
                    <TableHead>المتبقي</TableHead>
                    <TableHead>سير العمل</TableHead>
                    <TableHead>الدفع</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow
                      key={h.id}
                      className="cursor-pointer"
                      onClick={() => { setYear(h.bonus_year); setMonth(h.bonus_month); }}
                    >
                      <TableCell className="font-medium">{monthLabel(h.bonus_year, h.bonus_month)}</TableCell>
                      <TableCell>{fmtNumber(h.shipped_orders_count)}</TableCell>
                      <TableCell>{fmtNumber(h.delivered_orders_count)}</TableCell>
                      <TableCell>{fmtPercent(Number(h.delivery_rate ?? 0))}</TableCell>
                      <TableCell>
                        <TierChip
                          name={h.earned_tier_name_snapshot}
                          colorHex={tierByName(h.earned_tier_name_snapshot)?.color_hex}
                        />
                      </TableCell>
                      <TableCell>{fmtCurrency(h.system_calculated_total)}</TableCell>
                      <TableCell>{fmtCurrency(h.final_approved_amount)}</TableCell>
                      <TableCell>{fmtCurrency(h.total_paid_amount)}</TableCell>
                      <TableCell>{fmtCurrency(h.remaining_amount)}</TableCell>
                      <TableCell><WorkflowBadge status={h.workflow_status} /></TableCell>
                      <TableCell><PaymentBadge status={h.payment_status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {history.length >= historyLimit && (
                <div className="pt-3 text-center">
                  <Button variant="outline" size="sm" onClick={() => setHistoryLimit((l) => l + 12)}>
                    عرض شهور أقدم
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label, value, hint, tone,
}: { label: string; value: string; hint?: string; tone?: "primary" | "success" | "destructive" }) {
  const toneClass =
    tone === "primary" ? "text-primary"
      : tone === "success" ? "text-success"
        : tone === "destructive" ? "text-destructive"
          : "";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-display font-bold mt-1 ${toneClass}`}>{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

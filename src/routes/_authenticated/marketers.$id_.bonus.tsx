import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { TierProgress, type Tier } from "@/components/bonus/TierProgress";
import { DeliveryQuality } from "@/components/bonus/DeliveryQuality";
import { BonusBreakdown } from "@/components/bonus/BonusBreakdown";
import { BonusTimeline, type AuditLog } from "@/components/bonus/BonusTimeline";
import { BonusPayments } from "@/components/bonus/BonusPayments";
import { BonusWorkflowActions } from "@/components/bonus/BonusWorkflowActions";
import { MONTHS_AR, lastCompletedMonth, monthLabel } from "@/lib/bonus";
import { ArrowRight, Wallet, Trophy, RefreshCw, Loader2, AlertTriangle, Lock } from "lucide-react";
import { toast } from "sonner";

type BonusSearch = { year?: number; month?: number; pay?: boolean };

export const Route = createFileRoute("/_authenticated/marketers/$id_/bonus")({
  validateSearch: (search: Record<string, unknown>): BonusSearch => {
    const y = Number(search.year);
    const m = Number(search.month);
    return {
      year: Number.isFinite(y) && y > 2000 ? y : undefined,
      month: Number.isFinite(m) && m >= 1 && m <= 12 ? m : undefined,
      pay: search.pay === true || search.pay === "1" || search.pay === "true" ? true : undefined,
    };
  },

  head: () => ({
    meta: [
      { title: "بونص ومستحقات المسوّق الشهرية" },
      { name: "description", content: "تفاصيل احتساب البونص الشهري وتقدّم الباقات وجودة التسليم والمدفوعات." },
      { property: "og:title", content: "بونص ومستحقات المسوّق الشهرية" },
      { property: "og:description", content: "تفاصيل احتساب البونص الشهري وتقدّم الباقات وجودة التسليم والمدفوعات." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MarketerBonusPage,
});

function MarketerBonusPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/marketers/$id/bonus" });
  const { role } = useAuth();
  const qc = useQueryClient();
  const isMarketer = role === "marketer";
  const isAdmin = role === "admin";
  const canRecalculate = role === "admin" || role === "account_manager";


  const def = lastCompletedMonth();
  const year = search.year ?? def.year;
  const month = search.month ?? def.month;
  const setPeriod = (y: number, m: number) =>
    navigate({ params: { id }, search: { year: y, month: m } });

  const [historyLimit, setHistoryLimit] = useState(6);

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
      return (data ?? []) as Tier[];
    },
  });

  const { data: bonus, isLoading: loadingBonus, isError: bonusError } = useQuery({
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

  const { data: paymentData } = useQuery({
    enabled: !!bonus?.id,
    queryKey: ["bonus-payments", bonus?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("bonus_payments").select("*")
        .eq("monthly_bonus_id", bonus.id)
        .order("payment_date", { ascending: false });
      const rows = (data ?? []) as any[];
      const ids = Array.from(
        new Set(rows.flatMap((r) => [r.created_by, r.deleted_by]).filter(Boolean)),
      );
      let names: Record<string, string> = {};
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        names = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p.full_name]));
      }
      const withNames = rows.map((r) => ({
        ...r,
        creator_name: names[r.created_by] ?? null,
        deleter_name: r.deleted_by ? (names[r.deleted_by] ?? null) : null,
      }));
      return {
        active: withNames.filter((r) => !r.deleted_at),
        deleted: withNames.filter((r) => !!r.deleted_at),
      };
    },
  });
  const payments = paymentData?.active ?? [];
  const deletedPayments = paymentData?.deleted ?? [];


  const { data: auditLogs = [] } = useQuery({
    enabled: !!bonus?.id && !isMarketer,
    queryKey: ["bonus-audit-logs", bonus?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("bonus_audit_logs").select("*")
        .eq("monthly_bonus_id", bonus.id)
        .order("performed_at", { ascending: true });
      const rows = (data ?? []) as any[];
      const actorIds = Array.from(new Set(rows.map((r) => r.performed_by).filter(Boolean)));
      let names: Record<string, string> = {};
      if (actorIds.length) {
        const { data: profs } = await supabase
          .from("profiles").select("id, full_name").in("id", actorIds);
        names = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p.full_name]));
      }
      return rows.map((r) => ({ ...r, actor_name: names[r.performed_by] ?? null })) as AuditLog[];
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
      toast.success("تم احتساب مستحقات الشهر");
      qc.invalidateQueries({ queryKey: ["marketer-bonus", id] });
      qc.invalidateQueries({ queryKey: ["marketer-bonus-history", id] });
    },
    onError: () => toast.error("تعذر تنفيذ الاحتساب، برجاء المحاولة مرة أخرى"),
  });

  const tierByName = (name: string | null | undefined) =>
    tiers.find((t) => t.tier_name_ar === name || t.tier_name_en === name);
  const earnedTier = bonus ? tierByName(bonus.earned_tier_name_snapshot) : undefined;
  const volumeTier = bonus ? tierByName(bonus.volume_tier_name_snapshot) : undefined;
  const perExtraOrder = Number(earnedTier?.extra_delivered_order_amount ?? 0);
  const downgraded =
    bonus &&
    bonus.volume_tier_order_snapshot != null &&
    bonus.earned_tier_order_snapshot != null &&
    Number(bonus.earned_tier_order_snapshot) < Number(bonus.volume_tier_order_snapshot);
  const adjustment = Number(bonus?.manual_adjustment_amount ?? 0);

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2">
          <Link to="/marketers/$id" params={{ id }}><ArrowRight className="h-4 w-4 ml-1" /> رجوع للمسوق</Link>
        </Button>
        <h2 className="text-2xl font-display font-bold">البونص والمستحقات — {m?.name ?? ""}</h2>
        <div className="text-sm text-muted-foreground mt-1">{m?.marketer_code}</div>
      </div>

      {/* Tabs */}
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
            <Select value={String(month)} onValueChange={(v) => setPeriod(year, Number(v))}>
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
            <Select value={String(year)} onValueChange={(v) => setPeriod(Number(v), month)}>
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
            <div className="mr-auto flex items-center gap-2">
              {bonus?.is_locked && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" /> الشهر مقفول
                </span>
              )}
              <Button onClick={() => recalc.mutate()} disabled={recalc.isPending || bonus?.is_locked}>
                {recalc.isPending ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <RefreshCw className="h-4 w-4 ml-1" />}
                {bonus ? "إعادة احتساب الشهر" : "احتساب مستحقات الشهر"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {loadingBonus ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : bonusError ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          تعذر تحميل بيانات المستحقات لهذا الشهر، برجاء المحاولة مرة أخرى.
        </CardContent></Card>
      ) : !bonus ? (
        <Card><CardContent className="p-8 text-center space-y-3">
          <div className="text-sm text-muted-foreground">
            {isMarketer
              ? "لم يتم اعتماد مستحقات هذا الشهر بعد"
              : `لا توجد حسبة بونص لهذا الشهر — ${monthLabel(year, month)}`}
          </div>
          {canRecalculate && (
            <Button onClick={() => recalc.mutate()} disabled={recalc.isPending}>
              {recalc.isPending ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <RefreshCw className="h-4 w-4 ml-1" />}
              احتساب مستحقات الشهر
            </Button>
          )}
        </CardContent></Card>
      ) : (
        <>
          {/* Primary summary */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-6 space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-6">
                <div>
                  <div className="text-sm text-muted-foreground">المستحق النهائي — {monthLabel(year, month)}</div>
                  <div className="text-4xl font-display font-bold text-primary mt-1">
                    {fmtCurrency(bonus.final_approved_amount)}
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
                  <SummaryItem label="حسبة النظام" value={fmtCurrency(bonus.system_calculated_total)} />
                  <SummaryItem
                    label="التسوية"
                    value={`${adjustment > 0 ? "+ " : adjustment < 0 ? "- " : ""}${fmtCurrency(Math.abs(adjustment))}`}
                    className={adjustment > 0 ? "text-success" : adjustment < 0 ? "text-destructive" : ""}
                  />
                  <SummaryItem label="المدفوع" value={fmtCurrency(bonus.total_paid_amount)} className="text-success" />
                  <SummaryItem
                    label="المتبقي"
                    value={fmtCurrency(bonus.remaining_amount)}
                    className={Number(bonus.remaining_amount ?? 0) > 0 ? "text-destructive" : "text-success"}
                  />
                </div>
              </div>
              {adjustment !== 0 && !isMarketer && bonus.manual_adjustment_reason && (
                <div className="rounded-xl border bg-background/60 p-3 text-sm">
                  <span className="text-muted-foreground">سبب التسوية: </span>
                  {bonus.manual_adjustment_reason}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Review / approval workflow */}
          <BonusWorkflowActions bonus={bonus} />

          {/* Volume tier progress */}
          <TierProgress
            shipped={Number(bonus.shipped_orders_count ?? 0)}
            tiers={tiers}
            volumeTierName={bonus.volume_tier_name_snapshot}
          />

          {/* Volume vs earned tier */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">الباقة حسب عدد الطلبات</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <TierChip name={bonus.volume_tier_name_snapshot} colorHex={volumeTier?.color_hex} />
                <div className="text-xs text-muted-foreground">
                  {fmtNumber(bonus.shipped_orders_count)} طلب خرج للشحن
                  {volumeTier
                    ? ` — نسبة التسليم المطلوبة لهذه الباقة: ${fmtPercent(Number(volumeTier.minimum_delivery_rate ?? 0))}`
                    : ""}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">الباقة المستحقة</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <TierChip name={bonus.earned_tier_name_snapshot} colorHex={earnedTier?.color_hex} />
                <div className="text-xs text-muted-foreground">
                  نسبة التسليم الفعلية: {fmtPercent(Number(bonus.delivery_rate ?? 0))} — المطلوبة:{" "}
                  {fmtPercent(Number(bonus.required_delivery_rate ?? 0))}
                </div>
              </CardContent>
            </Card>
          </div>

          {downgraded ? (
            <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-warning-foreground" />
              <div>
                <div className="font-medium">
                  {bonus.volume_tier_name_snapshot} ← {bonus.earned_tier_name_snapshot}
                </div>
                <div className="text-muted-foreground">
                  تم تخفيض الباقة بسبب عدم تحقيق نسبة التسليم المطلوبة
                  {!isMarketer && bonus.tier_change_reason ? ` — ${bonus.tier_change_reason}` : ""}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
              تم تحقيق الباقة المستحقة بالكامل بدون تخفيض.
            </div>
          )}

          {/* Delivery quality */}
          <DeliveryQuality
            shipped={Number(bonus.shipped_orders_count ?? 0)}
            delivered={Number(bonus.delivered_orders_count ?? 0)}
            actualRate={Number(bonus.delivery_rate ?? 0)}
            requiredRate={Number(bonus.required_delivery_rate ?? 0)}
            minimumDelivered={Number(bonus.minimum_delivered_orders ?? 0)}
          />

          {/* Extra delivered reward */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">مكافأة الطلبات الإضافية</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <Field label="الحد الأدنى المطلوب" value={`${fmtNumber(bonus.minimum_delivered_orders)} طلب`} />
                <Field label="تم التسليم فعليًا" value={`${fmtNumber(bonus.delivered_orders_count)} طلب`} />
                <Field label="الطلبات الإضافية" value={`${fmtNumber(bonus.extra_delivered_orders)} طلب`} />
                <Field
                  label="قيمة المكافأة لكل طلب"
                  value={earnedTier ? fmtCurrency(perExtraOrder) : "غير متوفرة"}
                />
                <Field
                  label="إجمالي المكافأة"
                  value={fmtCurrency(bonus.calculated_extra_orders_bonus)}
                  className="text-success"
                />
              </div>
              <div className="rounded-xl border bg-muted/40 p-3 text-sm">
                <div className="text-muted-foreground text-xs mb-1">طريقة الحساب</div>
                الطلبات الإضافية × قيمة المكافأة لكل طلب
                {earnedTier && (
                  <div className="mt-1 font-medium">
                    {fmtNumber(bonus.extra_delivered_orders)} طلب إضافي × {fmtCurrency(perExtraOrder)} ={" "}
                    {fmtCurrency(bonus.calculated_extra_orders_bonus)}
                  </div>
                )}
              </div>
              {!earnedTier && (
                <div className="text-xs text-muted-foreground">
                  إعدادات الباقة غير متوفرة، يتم عرض القيم المحفوظة فقط.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Breakdown + timeline */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2">
              <BonusBreakdown bonus={bonus} earnedTier={earnedTier} />
            </div>
            <div className="space-y-4">
              <BonusTimeline bonus={bonus} isMarketer={isMarketer} logs={auditLogs} />
            </div>
          </div>

          {/* Payments */}
          <BonusPayments
            bonus={bonus}
            payments={payments}
            deletedPayments={deletedPayments}
            isAdmin={isAdmin}
            autoOpenPay={!!search.pay}
          />

        </>
      )}

      {/* History */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">السجل الشهري</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {history.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6">لا يوجد سجل شهري بعد</div>
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
                      className={`cursor-pointer ${h.bonus_year === year && h.bonus_month === month ? "bg-primary/5" : ""}`}
                      onClick={() => setPeriod(h.bonus_year, h.bonus_month)}
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
                  <Button variant="outline" size="sm" onClick={() => setHistoryLimit((l) => l + 6)}>
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

function SummaryItem({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-display font-bold text-lg mt-0.5 ${className ?? ""}`}>{value}</div>
    </div>
  );
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-display font-bold text-lg mt-0.5 ${className ?? ""}`}>{value}</div>
    </div>
  );
}

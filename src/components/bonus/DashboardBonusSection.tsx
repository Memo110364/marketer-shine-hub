import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import { WorkflowBadge, PaymentBadge, TierChip } from "@/components/bonus/BonusBadges";
import { MONTHS_AR, REVIEW_STATES, attentionRank, lastCompletedMonth } from "@/lib/bonus";
import { Trophy, RefreshCw, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export type BonusRow = any;

export function useBonusMonth(year: number, month: number) {
  return useQuery({
    queryKey: ["bonus-month", year, month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monthly_marketer_bonuses")
        .select("*, marketers(id, name, marketer_code)")
        .eq("bonus_year", year)
        .eq("bonus_month", month);
      if (error) throw error;
      return (data ?? []) as BonusRow[];
    },
  });
}

export function isPayable(row: BonusRow) {
  return (
    (row.workflow_status === "approved" || row.workflow_status === "locked") &&
    Number(row.remaining_amount ?? 0) > 0
  );
}

export function summarize(rows: BonusRow[]) {
  const num = (v: unknown) => Number(v ?? 0);
  const payable = rows.filter(isPayable);
  return {
    count: rows.length,
    finalTotal: rows.reduce((s, r) => s + num(r.final_approved_amount), 0),
    paidTotal: rows.reduce((s, r) => s + num(r.total_paid_amount), 0),
    remainingTotal: rows.reduce((s, r) => s + num(r.remaining_amount), 0),
    needsReview: rows.filter((r) => REVIEW_STATES.includes(r.workflow_status)).length,
    awaitingApproval: rows.filter((r) => r.workflow_status !== "approved" && r.workflow_status !== "locked").length,
    notFullyPaid: rows.filter((r) => r.payment_status !== "paid").length,
    awaitingPaymentCount: payable.length,
    awaitingPaymentTotal: payable.reduce((s, r) => s + num(r.remaining_amount), 0),
    fullyPaid: rows.filter((r) => r.payment_status === "paid").length,
  };
}


export function useRecalculateMonth(year: number, month: number) {
  const { role } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (marketerIds?: string[]) => {
      if (role === "admin") {
        const { data, error } = await (supabase.rpc as any)("calculate_monthly_bonuses_for_month", {
          _year: year, _month: month,
        });
        if (error) throw error;
        return data;
      }
      // Account manager: recalculate each assigned marketer individually.
      let ids = marketerIds;
      if (!ids) {
        const { data } = await supabase.from("marketers").select("id").eq("status", "active");
        ids = (data ?? []).map((r) => r.id);
      }
      let ok = 0;
      for (const id of ids) {
        const { error } = await (supabase.rpc as any)("calculate_monthly_bonus", {
          _marketer_id: id, _year: year, _month: month,
        });
        if (!error) ok += 1;
      }
      return { calculated: ok };
    },
    onSuccess: (res: any) => {
      toast.success(`تم احتساب ${fmtNumber(res?.calculated ?? 0)} مسوّق`);
      qc.invalidateQueries({ queryKey: ["bonus-month"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "تعذر تنفيذ الاحتساب"),
  });
}

export function DashboardBonusSection() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const canRecalculate = isAdmin || role === "account_manager";
  const def = lastCompletedMonth();
  const [year, setYear] = useState(def.year);
  const [month, setMonth] = useState(def.month);

  const { data: rows = [], isLoading } = useBonusMonth(year, month);
  const { data: tiers = [] } = useQuery({
    queryKey: ["bonus-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("bonus_tiers").select("*").order("tier_order");
      return (data ?? []) as any[];
    },
  });
  const recalc = useRecalculateMonth(year, month);

  const s = useMemo(() => summarize(rows), [rows]);
  const attention = useMemo(
    () => [...rows].sort((a, b) => attentionRank(a) - attentionRank(b)).slice(0, 8),
    [rows],
  );
  const years = useMemo(() => {
    const cur = new Date().getFullYear();
    return [cur, cur - 1, cur - 2];
  }, []);
  const tierColor = (name: string | null) =>
    tiers.find((t) => t.tier_name_ar === name || t.tier_name_en === name)?.color_hex;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" /> مستحقات المسوقين الشهرية
            </CardTitle>
            <div className="text-xs text-muted-foreground mt-1">
              متابعة حساب ومراجعة ودفع مستحقات المسوقين
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS_AR.map((l, i) => <SelectItem key={i} value={String(i + 1)}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-24 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            {canRecalculate && (
              <Button size="sm" variant="outline" onClick={() => recalc.mutate(undefined)} disabled={recalc.isPending}>
                {recalc.isPending ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <RefreshCw className="h-4 w-4 ml-1" />}
                {isAdmin ? "إعادة احتساب الشهر" : "إعادة احتساب المسوقين التابعين"}
              </Button>
            )}
            <Button size="sm" asChild>
              <Link to="/bonus-calculator">
                {isAdmin ? "عرض جميع المستحقات" : "عرض مستحقات المسوقين التابعين"}
                <ArrowLeft className="h-4 w-4 mr-1" />
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <MiniKpi label="إجمالي المستحقات" value={fmtCurrency(s.finalTotal)} tone="text-primary" />
          <MiniKpi label="تم دفعه" value={fmtCurrency(s.paidTotal)} tone="text-success" hint={`${fmtNumber(s.fullyPaid)} مدفوع بالكامل`} />
          <MiniKpi label="المتبقي" value={fmtCurrency(s.remainingTotal)} tone={s.remainingTotal > 0 ? "text-destructive" : ""} />
          <MiniKpi
            label="بانتظار التحويل"
            value={fmtCurrency(s.awaitingPaymentTotal)}
            tone={s.awaitingPaymentTotal > 0 ? "text-destructive" : ""}
            hint={`${fmtNumber(s.awaitingPaymentCount)} مسوّق معتمد بدون دفع كامل`}
          />
          <MiniKpi label="يحتاج مراجعة" value={fmtNumber(s.needsReview)} hint={`${fmtNumber(s.awaitingApproval)} بانتظار الاعتماد`} />
          <MiniKpi label="لم يتم دفعه بالكامل" value={fmtNumber(s.notFullyPaid)} hint={`${fmtNumber(s.count)} مسوّق بسجل`} />
        </div>


        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : attention.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">لا توجد سجلات مستحقات لهذا الشهر</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المسوّق</TableHead>
                    <TableHead>الباقة المستحقة</TableHead>
                    <TableHead>المستحق النهائي</TableHead>
                    <TableHead>المدفوع</TableHead>
                    <TableHead>المتبقي</TableHead>
                    <TableHead>سير العمل</TableHead>
                    <TableHead>الدفع</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attention.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.marketers?.name ?? "—"}</TableCell>
                      <TableCell>
                        <TierChip name={r.earned_tier_name_snapshot} colorHex={tierColor(r.earned_tier_name_snapshot)} />
                      </TableCell>
                      <TableCell>{fmtCurrency(r.final_approved_amount)}</TableCell>
                      <TableCell>{fmtCurrency(r.total_paid_amount)}</TableCell>
                      <TableCell>{fmtCurrency(r.remaining_amount)}</TableCell>
                      <TableCell><WorkflowBadge status={r.workflow_status} /></TableCell>
                      <TableCell><PaymentBadge status={r.payment_status} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {isAdmin && isPayable(r) && (
                            <Button size="sm" asChild>
                              <Link to="/marketers/$id/bonus" params={{ id: r.marketer_id }} search={{ year, month, pay: true }}>
                                تسجيل دفعة
                              </Link>
                            </Button>
                          )}
                          <Button size="sm" variant="outline" asChild>
                            <Link to="/marketers/$id/bonus" params={{ id: r.marketer_id }} search={{ year, month }}>عرض التفاصيل</Link>
                          </Button>
                        </div>
                      </TableCell>

                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {attention.map((r) => (
                <div key={r.id} className="rounded-xl border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{r.marketers?.name ?? "—"}</div>
                    <TierChip name={r.earned_tier_name_snapshot} colorHex={tierColor(r.earned_tier_name_snapshot)} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><div className="text-muted-foreground">المستحق</div>{fmtCurrency(r.final_approved_amount)}</div>
                    <div><div className="text-muted-foreground">المدفوع</div>{fmtCurrency(r.total_paid_amount)}</div>
                    <div><div className="text-muted-foreground">المتبقي</div>{fmtCurrency(r.remaining_amount)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <WorkflowBadge status={r.workflow_status} />
                    <PaymentBadge status={r.payment_status} />
                    <Button size="sm" variant="outline" className="mr-auto" asChild>
                      <Link to="/marketers/$id/bonus" params={{ id: r.marketer_id }} search={{ year, month }}>عرض التفاصيل</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MiniKpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-display font-bold mt-1 ${tone ?? ""}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency, fmtNumber, fmtPercent } from "@/lib/format";
import { WorkflowBadge, PaymentBadge, TierChip } from "@/components/bonus/BonusBadges";
import {
  MONTHS_AR, PAYMENT_LABELS, WORKFLOW_LABELS, WORKFLOW_STATUSES, PAYMENT_STATUSES,
  attentionRank, lastCompletedMonth, monthLabel,
} from "@/lib/bonus";
import { useBonusMonth, summarize, useRecalculateMonth } from "@/components/bonus/DashboardBonusSection";
import { Loader2, RefreshCw, Trophy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/bonus-calculator")({
  head: () => ({
    meta: [
      { title: "مستحقات المسوقين الشهرية" },
      { name: "description", content: "متابعة حساب ومراجعة ودفع مستحقات المسوقين الشهرية." },
      { property: "og:title", content: "مستحقات المسوقين الشهرية" },
      { property: "og:description", content: "متابعة حساب ومراجعة ودفع مستحقات المسوقين الشهرية." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BonusCalculatorPage,
});

function BonusCalculatorPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const canRecalculate = isAdmin || role === "account_manager";
  const def = lastCompletedMonth();
  const [year, setYear] = useState(def.year);
  const [month, setMonth] = useState(def.month);
  const [workflowFilter, setWorkflowFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");

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
  const filtered = useMemo(
    () =>
      rows
        .filter((r) => workflowFilter === "all" || r.workflow_status === workflowFilter)
        .filter((r) => paymentFilter === "all" || r.payment_status === paymentFilter)
        .sort((a, b) => attentionRank(a) - attentionRank(b)),
    [rows, workflowFilter, paymentFilter],
  );
  const years = useMemo(() => {
    const cur = new Date().getFullYear();
    return [cur, cur - 1, cur - 2];
  }, []);
  const tierColor = (name: string | null) =>
    tiers.find((t) => t.tier_name_ar === name || t.tier_name_en === name)?.color_hex;

  const workflowCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of rows) map[r.workflow_status] = (map[r.workflow_status] ?? 0) + 1;
    return map;
  }, [rows]);
  const paymentCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of rows) map[r.payment_status] = (map[r.payment_status] ?? 0) + 1;
    return map;
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-display font-bold inline-flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" /> مستحقات المسوقين الشهرية
          </h2>
          <div className="text-sm text-muted-foreground mt-1">
            {monthLabel(year, month)} — متابعة حساب ومراجعة ودفع مستحقات المسوقين
          </div>
        </div>
        {canRecalculate && (
          <Button onClick={() => recalc.mutate(undefined)} disabled={recalc.isPending}>
            {recalc.isPending ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <RefreshCw className="h-4 w-4 ml-1" />}
            {isAdmin ? "إعادة احتساب الشهر" : "إعادة احتساب المسوقين التابعين"}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>الشهر</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS_AR.map((l, i) => <SelectItem key={i} value={String(i + 1)}>{l}</SelectItem>)}
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
            <Label>حالة سير العمل</Label>
            <Select value={workflowFilter} onValueChange={setWorkflowFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {WORKFLOW_STATUSES.map((w) => <SelectItem key={w} value={w}>{WORKFLOW_LABELS[w]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>حالة الدفع</Label>
            <Select value={paymentFilter} onValueChange={setPaymentFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {PAYMENT_STATUSES.map((p) => <SelectItem key={p} value={p}>{PAYMENT_LABELS[p]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="إجمالي المستحقات" value={fmtCurrency(s.finalTotal)} tone="text-primary" />
        <Kpi label="تم دفعه" value={fmtCurrency(s.paidTotal)} tone="text-success" />
        <Kpi label="المتبقي" value={fmtCurrency(s.remainingTotal)} tone={s.remainingTotal > 0 ? "text-destructive" : ""} />
        <Kpi label="يحتاج مراجعة" value={fmtNumber(s.needsReview)} />
        <Kpi label="لم يتم دفعه بالكامل" value={fmtNumber(s.notFullyPaid)} hint={`${fmtNumber(s.count)} مسوّق بسجل`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">ملخص سير العمل</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {WORKFLOW_STATUSES.map((w) => (
              <div key={w} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <WorkflowBadge status={w} /> <span>{fmtNumber(workflowCounts[w] ?? 0)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">ملخص الدفع</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {PAYMENT_STATUSES.map((p) => (
              <div key={p} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <PaymentBadge status={p} /> <span>{fmtNumber(paymentCounts[p] ?? 0)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">مستحقات المسوقين</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">لا توجد سجلات</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المسوّق</TableHead>
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
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.marketers?.name ?? "—"}</TableCell>
                    <TableCell>{fmtNumber(r.shipped_orders_count)}</TableCell>
                    <TableCell>{fmtNumber(r.delivered_orders_count)}</TableCell>
                    <TableCell>{fmtPercent(Number(r.delivery_rate ?? 0))}</TableCell>
                    <TableCell>
                      <TierChip name={r.earned_tier_name_snapshot} colorHex={tierColor(r.earned_tier_name_snapshot)} />
                    </TableCell>
                    <TableCell>{fmtCurrency(r.system_calculated_total)}</TableCell>
                    <TableCell>{fmtCurrency(r.final_approved_amount)}</TableCell>
                    <TableCell>{fmtCurrency(r.total_paid_amount)}</TableCell>
                    <TableCell>{fmtCurrency(r.remaining_amount)}</TableCell>
                    <TableCell><WorkflowBadge status={r.workflow_status} /></TableCell>
                    <TableCell><PaymentBadge status={r.payment_status} /></TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/marketers/$id/bonus" params={{ id: r.marketer_id }} search={{ year, month }}>عرض التفاصيل</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-display font-bold mt-1 ${tone ?? ""}`}>{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

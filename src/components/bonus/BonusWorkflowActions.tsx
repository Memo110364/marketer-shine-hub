import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { WorkflowBadge } from "@/components/bonus/BonusBadges";
import { fmtCurrency } from "@/lib/format";
import { Loader2, ClipboardCheck, PencilLine, CheckCircle2, Lock, Unlock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type Mode = "increase" | "deduct" | "clear";

export function BonusWorkflowActions({ bonus }: { bonus: any }) {
  const { role } = useAuth();
  const qc = useQueryClient();
  const isAdmin = role === "admin";
  const isManager = role === "account_manager";
  if (!isAdmin && !isManager) return null;

  const status: string = bonus.workflow_status;
  const locked: boolean = !!bonus.is_locked || status === "locked";
  const system = Number(bonus.system_calculated_total ?? 0);
  const currentAdj = Number(bonus.manual_adjustment_amount ?? 0);

  const [adjOpen, setAdjOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("increase");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [unlockReason, setUnlockReason] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["marketer-bonus"] });
    qc.invalidateQueries({ queryKey: ["marketer-bonus-history"] });
    qc.invalidateQueries({ queryKey: ["bonus-audit-logs"] });
    qc.invalidateQueries({ queryKey: ["bonus-month"] });
  };

  const run = useMutation({
    mutationFn: async (p: { fn: string; args: Record<string, unknown> }) => {
      const { data, error } = await (supabase.rpc as any)(p.fn, p.args);
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, p) => {
      const messages: Record<string, string> = {
        submit_bonus_for_review: "تم بدء المراجعة",
        propose_bonus_adjustment: "تم حفظ التسوية",
        approve_monthly_bonus: "تم اعتماد المستحقات",
        lock_monthly_bonus: "تم قفل الشهر",
        unlock_monthly_bonus: "تم إعادة فتح الشهر",
      };
      toast.success(messages[p.fn] ?? "تم التنفيذ");
      setAdjOpen(false);
      setUnlockOpen(false);
      setAmount("");
      setReason("");
      setUnlockReason("");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "تعذر تنفيذ العملية"),
  });

  const signedAmount = mode === "clear" ? 0 : (mode === "deduct" ? -1 : 1) * Math.abs(Number(amount) || 0);
  const previewFinal = Math.max(system + signedAmount, 0);
  const reasonOk = signedAmount === 0 || reason.trim().length >= 5;

  const canSubmitReview = !locked && (status === "calculated" || status === "draft");
  const canAdjust = !locked && (status === "under_review" || status === "adjustment_proposed" || status === "calculated");
  const canApprove = isAdmin && !locked && (status === "under_review" || status === "adjustment_proposed" || status === "calculated");
  const canLock = isAdmin && !locked && status === "approved";
  const canUnlock = isAdmin && locked;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base inline-flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-primary" /> مراجعة المستحقات
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">الحالة الحالية:</span>
          <WorkflowBadge status={status} />
          {locked && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" /> الشهر مقفول ولا يمكن تعديله
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {canSubmitReview && (
            <Button
              variant="outline"
              disabled={run.isPending}
              onClick={() => run.mutate({ fn: "submit_bonus_for_review", args: { _monthly_bonus_id: bonus.id } })}
            >
              {run.isPending ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <ClipboardCheck className="h-4 w-4 ml-1" />}
              بدء المراجعة
            </Button>
          )}
          {canAdjust && (
            <Button variant="outline" onClick={() => { setMode(currentAdj < 0 ? "deduct" : "increase"); setAmount(currentAdj ? String(Math.abs(currentAdj)) : ""); setReason(bonus.manual_adjustment_reason ?? ""); setAdjOpen(true); }}>
              <PencilLine className="h-4 w-4 ml-1" /> {currentAdj !== 0 ? "تعديل التسوية" : "اقتراح تسوية"}
            </Button>
          )}
          {canApprove && (
            <Button
              disabled={run.isPending}
              onClick={() => run.mutate({ fn: "approve_monthly_bonus", args: { _monthly_bonus_id: bonus.id } })}
            >
              {run.isPending ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 ml-1" />}
              اعتماد المستحقات
            </Button>
          )}
          {canLock && (
            <Button
              variant="gold"
              disabled={run.isPending}
              onClick={() => run.mutate({ fn: "lock_monthly_bonus", args: { _monthly_bonus_id: bonus.id } })}
            >
              <Lock className="h-4 w-4 ml-1" /> قفل الشهر
            </Button>
          )}
          {canUnlock && (
            <Button variant="outline" onClick={() => setUnlockOpen(true)}>
              <Unlock className="h-4 w-4 ml-1" /> إعادة فتح الشهر
            </Button>
          )}
          {isManager && !locked && (
            <span className="text-xs text-muted-foreground self-center">
              الاعتماد والقفل من صلاحيات الأدمن فقط
            </span>
          )}
        </div>
      </CardContent>

      {/* Adjustment dialog */}
      <Dialog open={adjOpen} onOpenChange={setAdjOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تسوية يدوية على المستحقات</DialogTitle>
            <DialogDescription>
              لا يتم تعديل حسبة النظام — تُضاف التسوية فوقها ويظل السبب مسجلًا في سجل التغييرات.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              {([["increase", "إضافة"], ["deduct", "خصم"], ["clear", "إلغاء التسوية"]] as [Mode, string][]).map(([k, label]) => (
                <Button key={k} type="button" size="sm" variant={mode === k ? "default" : "outline"} onClick={() => setMode(k)}>
                  {label}
                </Button>
              ))}
            </div>
            {mode !== "clear" && (
              <div className="space-y-1">
                <Label>المبلغ</Label>
                <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
            )}
            <div className="space-y-1">
              <Label>السبب {mode !== "clear" && <span className="text-destructive">*</span>}</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
                placeholder="اكتب سببًا واضحًا للتسوية (5 أحرف على الأقل)" />
            </div>
            <div className="rounded-xl border bg-muted/40 p-3 text-sm space-y-1">
              <Row label="حسبة النظام" value={fmtCurrency(system)} />
              <Row label="التسوية" value={`${signedAmount > 0 ? "+ " : signedAmount < 0 ? "- " : ""}${fmtCurrency(Math.abs(signedAmount))}`} />
              <Row label="المستحق النهائي بعد التسوية" value={fmtCurrency(previewFinal)} strong />
              {system + signedAmount < 0 && (
                <div className="text-xs text-warning-foreground">لا يمكن أن يقل المستحق عن صفر، سيتم اعتماد صفر.</div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjOpen(false)}>إلغاء</Button>
            <Button
              disabled={!reasonOk || run.isPending}
              onClick={() => run.mutate({
                fn: "propose_bonus_adjustment",
                args: { _monthly_bonus_id: bonus.id, _adjustment_amount: signedAmount, _adjustment_reason: reason.trim() || null },
              })}
            >
              {run.isPending && <Loader2 className="h-4 w-4 ml-1 animate-spin" />} حفظ التسوية
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlock dialog */}
      <Dialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إعادة فتح شهر مقفول</DialogTitle>
            <DialogDescription>
              إعادة الفتح تسمح بتعديل واحتساب المستحقات مرة أخرى. لا يمكن إعادة فتح شهر تم دفعه كليًا أو جزئيًا.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-warning-foreground" />
              <span>سيتم تسجيل هذه العملية في سجل التغييرات باسمك وبالسبب المكتوب.</span>
            </div>
            <div className="space-y-1">
              <Label>سبب إعادة الفتح <span className="text-destructive">*</span></Label>
              <Textarea value={unlockReason} onChange={(e) => setUnlockReason(e.target.value)} rows={3}
                placeholder="اكتب سبب إعادة الفتح (5 أحرف على الأقل)" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlockOpen(false)}>إلغاء</Button>
            <Button
              disabled={unlockReason.trim().length < 5 || run.isPending}
              onClick={() => run.mutate({
                fn: "unlock_monthly_bonus",
                args: { _monthly_bonus_id: bonus.id, _unlock_reason: unlockReason.trim() },
              })}
            >
              {run.isPending && <Loader2 className="h-4 w-4 ml-1 animate-spin" />} تأكيد إعادة الفتح
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-display font-bold" : ""}>{value}</span>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { PaymentBadge } from "@/components/bonus/BonusBadges";
import {
  BonusPaymentDialog, METHOD_LABELS, PROOF_BUCKET, friendlyError,
} from "@/components/bonus/BonusPaymentDialog";
import { Plus, Wallet, PencilLine, Trash2, Paperclip, AlertTriangle, Loader2, ChevronDown } from "lucide-react";
import { toast } from "sonner";

export function BonusPayments({
  bonus,
  payments,
  deletedPayments = [],
  isAdmin = false,
  autoOpenPay = false,
}: {
  bonus: any;
  payments: any[];
  deletedPayments?: any[];
  isAdmin?: boolean;
  autoOpenPay?: boolean;
}) {
  const qc = useQueryClient();
  const final = Number(bonus.final_approved_amount ?? 0);
  const paid = Number(bonus.total_paid_amount ?? 0);
  const remaining = Number(bonus.remaining_amount ?? 0);
  const completion = final > 0 ? Math.min(paid / final, 1) : 1;
  const eligible =
    (bonus.workflow_status === "approved" || bonus.workflow_status === "locked") && final > 0;

  const [payOpen, setPayOpen] = useState(false);
  const [prefill, setPrefill] = useState<number | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);

  useEffect(() => {
    if (autoOpenPay && isAdmin && eligible && remaining > 0) {
      setPrefill(null);
      setEditing(null);
      setPayOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenPay, isAdmin, eligible]);

  const removePayment = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)("delete_bonus_payment", {
        _payment_id: deleting.id,
        _delete_reason: deleteReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حذف الدفعة");
      setDeleting(null);
      setDeleteReason("");
      qc.invalidateQueries({ queryKey: ["marketer-bonus"] });
      qc.invalidateQueries({ queryKey: ["bonus-payments"] });
      qc.invalidateQueries({ queryKey: ["bonus-audit-logs"] });
      qc.invalidateQueries({ queryKey: ["bonus-month"] });
    },
    onError: (e: any) => toast.error(friendlyError(e?.message)),
  });

  const openProof = async (path: string) => {
    const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      toast.error("تعذر فتح إثبات التحويل");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base inline-flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" /> ملخص الدفع
        </CardTitle>
        {isAdmin && eligible && remaining > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { setEditing(null); setPrefill(null); setPayOpen(true); }}>
              <Plus className="h-4 w-4 ml-1" /> تسجيل دفعة
            </Button>
            <Button size="sm" variant="outline"
              onClick={() => { setEditing(null); setPrefill(remaining); setPayOpen(true); }}>
              دفع المتبقي بالكامل
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">المستحق النهائي</div>
            <div className="font-display font-bold text-lg mt-0.5 text-primary">{fmtCurrency(final)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">المدفوع</div>
            <div className="font-display font-bold text-lg mt-0.5 text-success">{fmtCurrency(paid)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">المتبقي</div>
            <div className={`font-display font-bold text-lg mt-0.5 ${remaining > 0 ? "text-destructive" : "text-success"}`}>
              {fmtCurrency(remaining)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">حالة الدفع</div>
            <PaymentBadge status={bonus.payment_status} />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>نسبة إتمام الدفع</span>
            <span>{Math.round(completion * 100)}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-success transition-all" style={{ width: `${completion * 100}%` }} />
          </div>
        </div>

        {final <= 0 && (
          <div className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground text-center">
            لا توجد مستحقات مالية واجبة التحويل لهذا الشهر
          </div>
        )}
        {final > 0 && !eligible && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
            لا يمكن تسجيل الدفعات قبل اعتماد مستحقات الشهر.
          </div>
        )}

        {payments.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4 border rounded-xl">
            لا توجد دفعات مسجلة لهذا الشهر
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>الطريقة</TableHead>
                  <TableHead>الرقم المرجعي</TableHead>
                  <TableHead>ملاحظات</TableHead>
                  <TableHead>الإثبات</TableHead>
                  {isAdmin && <TableHead>سُجلت بواسطة</TableHead>}
                  {isAdmin && <TableHead>آخر تحديث</TableHead>}
                  {isAdmin && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{fmtDate(p.payment_date)}</TableCell>
                    <TableCell className="font-medium">{fmtCurrency(p.amount)}</TableCell>
                    <TableCell>{METHOD_LABELS[p.payment_method] ?? p.payment_method}</TableCell>
                    <TableCell>{p.reference_code || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{p.notes || "—"}</TableCell>
                    <TableCell>
                      {p.proof_url ? (
                        <Button size="sm" variant="ghost" onClick={() => void openProof(p.proof_url)}>
                          <Paperclip className="h-4 w-4 ml-1" /> عرض
                        </Button>
                      ) : "—"}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-xs text-muted-foreground">
                        {p.creator_name || "—"}
                        <div>{fmtDate(p.created_at)}</div>
                      </TableCell>
                    )}
                    {isAdmin && (
                      <TableCell className="text-xs text-muted-foreground">
                        {p.updated_at ? fmtDate(p.updated_at) : "—"}
                      </TableCell>
                    )}
                    {isAdmin && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(p); setPrefill(null); setPayOpen(true); }}>
                            <PencilLine className="h-4 w-4 ml-1" /> تعديل
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive"
                            onClick={() => { setDeleting(p); setDeleteReason(""); }}>
                            <Trash2 className="h-4 w-4 ml-1" /> حذف
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {isAdmin && deletedPayments.length > 0 && (
          <div className="border rounded-xl">
            <button type="button" onClick={() => setShowDeleted((v) => !v)}
              className="w-full flex items-center justify-between p-3 text-sm">
              <span className="text-muted-foreground">الدفعات المحذوفة ({deletedPayments.length})</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showDeleted ? "rotate-180" : ""}`} />
            </button>
            {showDeleted && (
              <div className="border-t p-3 space-y-2">
                {deletedPayments.map((p) => (
                  <div key={p.id} className="rounded-xl bg-muted/40 p-3 text-xs space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {fmtCurrency(p.amount)} — {METHOD_LABELS[p.payment_method] ?? p.payment_method}
                        {p.reference_code ? ` — ${p.reference_code}` : ""}
                      </span>
                      <span className="text-muted-foreground">{fmtDate(p.payment_date)}</span>
                    </div>
                    <div className="text-muted-foreground">
                      حُذفت في {fmtDate(p.deleted_at)}
                      {p.deleter_name ? ` بواسطة ${p.deleter_name}` : ""}
                    </div>
                    {p.deletion_reason && <div>السبب: {p.deletion_reason}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {isAdmin && (
        <BonusPaymentDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          bonus={bonus}
          payment={editing}
          prefillAmount={prefill}
        />
      )}

      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>حذف الدفعة</DialogTitle>
            <DialogDescription>
              سيتم استبعاد هذه الدفعة من إجمالي المدفوع وإعادة حساب المتبقي، مع الاحتفاظ بها في سجل المراجعة.
            </DialogDescription>
          </DialogHeader>
          {deleting && (
            <div className="space-y-3">
              <div className="rounded-xl border bg-muted/40 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">المبلغ</span><span>{fmtCurrency(deleting.amount)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">التاريخ</span><span>{fmtDate(deleting.payment_date)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">الطريقة</span><span>{METHOD_LABELS[deleting.payment_method] ?? deleting.payment_method}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">الرقم المرجعي</span><span>{deleting.reference_code || "—"}</span></div>
              </div>
              <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-warning-foreground" />
                <span>سيتم تسجيل هذه العملية في سجل المراجعة باسمك وبالسبب المكتوب.</span>
              </div>
              <div className="space-y-1">
                <Label>سبب الحذف <span className="text-destructive">*</span></Label>
                <Textarea rows={3} value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="اكتب سبب الحذف (5 أحرف على الأقل)" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>إلغاء</Button>
            <Button variant="destructive" disabled={deleteReason.trim().length < 5 || removePayment.isPending}
              onClick={() => removePayment.mutate()}>
              {removePayment.isPending && <Loader2 className="h-4 w-4 ml-1 animate-spin" />} تأكيد الحذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

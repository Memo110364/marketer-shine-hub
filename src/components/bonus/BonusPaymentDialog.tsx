import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { fmtCurrency } from "@/lib/format";
import { Loader2, AlertTriangle, Upload } from "lucide-react";
import { toast } from "sonner";

export const PAYMENT_METHODS: { value: string; label: string; refRequired: boolean }[] = [
  { value: "fawry", label: "فوري", refRequired: true },
  { value: "bank_transfer", label: "تحويل بنكي", refRequired: true },
  { value: "wallet", label: "محفظة إلكترونية", refRequired: true },
  { value: "cash", label: "نقدي", refRequired: false },
  { value: "other", label: "أخرى", refRequired: false },
];

export const METHOD_LABELS: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.value, m.label]),
);

export const PROOF_BUCKET = "bonus-payment-proofs";
const MAX_PROOF_BYTES = 5 * 1024 * 1024;

const today = () => new Date().toISOString().slice(0, 10);

export function BonusPaymentDialog({
  open,
  onOpenChange,
  bonus,
  payment,
  prefillAmount,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bonus: any;
  /** When provided the dialog runs in edit mode. */
  payment?: any | null;
  prefillAmount?: number | null;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!payment;
  const final = Number(bonus?.final_approved_amount ?? 0);
  const paid = Number(bonus?.total_paid_amount ?? 0);
  const remaining = Number(bonus?.remaining_amount ?? 0);
  const editableRemaining = isEdit ? remaining + Number(payment?.amount ?? 0) : remaining;

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (payment) {
      setAmount(String(Number(payment.amount ?? 0)));
      setDate(payment.payment_date ?? today());
      setMethod(payment.payment_method ?? "bank_transfer");
      setReference(payment.reference_code ?? "");
      setNotes(payment.notes ?? "");
      setProofUrl(payment.proof_url ?? null);
    } else {
      setAmount(prefillAmount ? String(prefillAmount) : "");
      setDate(today());
      setMethod("bank_transfer");
      setReference("");
      setNotes("");
      setProofUrl(null);
    }
    setReason("");
  }, [open, payment, prefillAmount]);

  const amt = Number(amount) || 0;
  const refRequired = PAYMENT_METHODS.find((m) => m.value === method)?.refRequired ?? false;
  const paidAfter = isEdit ? paid - Number(payment?.amount ?? 0) + amt : paid + amt;
  const remainingAfter = Math.max(final - paidAfter, 0);

  const amountError =
    amt <= 0
      ? "مبلغ التحويل يجب أن يكون أكبر من صفر"
      : amt > editableRemaining + 0.0001
        ? "مبلغ التحويل أكبر من المبلغ المتبقي."
        : null;
  const valid =
    !amountError &&
    !!date &&
    (!refRequired || reference.trim().length > 0) &&
    (!isEdit || reason.trim().length >= 5);

  const upload = async (file: File) => {
    if (file.size > MAX_PROOF_BYTES) {
      toast.error("حجم الملف أكبر من 5 ميجابايت");
      return;
    }
    if (!/^(image\/|application\/pdf)/.test(file.type)) {
      toast.error("يُسمح بالصور وملفات PDF فقط");
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop() ?? "bin";
    const path = `${bonus.marketer_id}/${bonus.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(PROOF_BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    setUploading(false);
    if (error) {
      toast.error("تعذر رفع إثبات التحويل");
      return;
    }
    setProofUrl(path);
    toast.success("تم رفع إثبات التحويل");
  };

  const save = useMutation({
    mutationFn: async () => {
      const args = isEdit
        ? {
            fn: "update_bonus_payment",
            payload: {
              _payment_id: payment.id,
              _payment_date: date,
              _amount: amt,
              _payment_method: method,
              _update_reason: reason.trim(),
              _reference_code: reference.trim() || null,
              _notes: notes.trim() || null,
              _proof_url: proofUrl,
            },
          }
        : {
            fn: "add_bonus_payment",
            payload: {
              _monthly_bonus_id: bonus.id,
              _payment_date: date,
              _amount: amt,
              _payment_method: method,
              _reference_code: reference.trim() || null,
              _notes: notes.trim() || null,
              _proof_url: proofUrl,
            },
          };
      const { data, error } = await (supabase.rpc as any)(args.fn, args.payload);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(isEdit ? "تم تعديل الدفعة" : "تم تسجيل الدفعة");
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["marketer-bonus"] });
      qc.invalidateQueries({ queryKey: ["marketer-bonus-history"] });
      qc.invalidateQueries({ queryKey: ["bonus-payments"] });
      qc.invalidateQueries({ queryKey: ["bonus-audit-logs"] });
      qc.invalidateQueries({ queryKey: ["bonus-month"] });
      onDone?.();
    },
    onError: (e: any) => toast.error(friendlyError(e?.message)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "تعديل الدفعة" : "تسجيل تحويل للمسوق"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "تعديل الدفعة سيعيد حساب إجمالي المدفوع والمتبقي وحالة الدفع."
              : "سجّل كل تحويل بشكل منفصل بتاريخه وطريقته ورقمه المرجعي."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 rounded-xl border bg-muted/40 p-3 text-sm">
            <ReadOnly label="المستحق النهائي" value={fmtCurrency(final)} />
            <ReadOnly label="المدفوع سابقًا" value={fmtCurrency(paid)} />
            <ReadOnly label="المتبقي" value={fmtCurrency(remaining)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>مبلغ التحويل (ج.م) <span className="text-destructive">*</span></Label>
              <Input type="number" min="0" step="0.01" value={amount}
                onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              {amountError && amount !== "" && (
                <div className="text-xs text-destructive">{amountError}</div>
              )}
            </div>
            <div className="space-y-1">
              <Label>تاريخ التحويل <span className="text-destructive">*</span></Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>طريقة الدفع <span className="text-destructive">*</span></Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>
                الرقم المرجعي / كود العملية {refRequired && <span className="text-destructive">*</span>}
              </Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)}
                placeholder={refRequired ? "مطلوب" : "اختياري"} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>ملاحظات</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" />
          </div>

          <div className="space-y-1">
            <Label>إثبات التحويل (صورة أو PDF)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept="image/*,application/pdf"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
              {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            {proofUrl && (
              <div className="text-xs text-success inline-flex items-center gap-1">
                <Upload className="h-3.5 w-3.5" /> تم إرفاق إثبات التحويل
              </div>
            )}
          </div>

          {isEdit && (
            <div className="space-y-1">
              <Label>سبب التعديل <span className="text-destructive">*</span></Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="اكتب سبب التعديل (5 أحرف على الأقل)" />
              {Number(payment?.amount ?? 0) !== amt && (
                <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-2 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-warning-foreground" />
                  <span>
                    المبلغ القديم: {fmtCurrency(payment?.amount ?? 0)} ← المبلغ الجديد: {fmtCurrency(amt)}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border bg-muted/40 p-3 text-sm space-y-1">
            <Row label="المستحق" value={fmtCurrency(final)} />
            <Row label="المدفوع بعد هذه الدفعة" value={fmtCurrency(paidAfter)} />
            <Row label="المتبقي" value={fmtCurrency(remainingAfter)} strong />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button disabled={!valid || save.isPending || uploading} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="h-4 w-4 ml-1 animate-spin" />}
            {isEdit ? "حفظ التعديل" : "تسجيل الدفعة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function friendlyError(message?: string) {
  if (!message) return "تعذر تنفيذ العملية";
  if (/[\u0600-\u06FF]/.test(message)) return message;
  return "تعذر تنفيذ العملية، برجاء مراجعة البيانات والمحاولة مرة أخرى.";
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display font-bold mt-0.5">{value}</div>
    </div>
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

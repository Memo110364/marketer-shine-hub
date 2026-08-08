import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { PaymentBadge } from "@/components/bonus/BonusBadges";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

const METHOD_LABELS: Record<string, string> = {
  fawry: "فوري",
  bank_transfer: "تحويل بنكي",
  wallet: "محفظة إلكترونية",
  cash: "كاش",
  other: "أخرى",
};

export function BonusPayments({
  bonus, payments, onPaymentRecorded,
}: { bonus: any; payments: any[]; onPaymentRecorded?: () => void }) {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const canRecord = role === "admin";

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">ملخص الدفع</CardTitle>
        {canRecord && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 ml-1" /> تسجيل دفعة
              </Button>
            </DialogTrigger>
            <RecordPaymentDialog
              bonus={bonus}
              onClose={() => setOpen(false)}
              onSaved={() => {
                setOpen(false);
                onPaymentRecorded?.();
              }}
            />
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">المستحق النهائي</div>
            <div className="font-display font-bold text-lg mt-0.5 text-primary">
              {fmtCurrency(bonus.final_approved_amount)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">المدفوع</div>
            <div className="font-display font-bold text-lg mt-0.5 text-success">
              {fmtCurrency(bonus.total_paid_amount)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">المتبقي</div>
            <div
              className={`font-display font-bold text-lg mt-0.5 ${
                Number(bonus.remaining_amount ?? 0) > 0 ? "text-destructive" : "text-success"
              }`}
            >
              {fmtCurrency(bonus.remaining_amount)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">حالة الدفع</div>
            <PaymentBadge status={bonus.payment_status} />
          </div>
        </div>

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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecordPaymentDialog({
  bonus, onClose, onSaved,
}: { bonus: any; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const remaining = Number(bonus.remaining_amount ?? 0);
  const [form, setForm] = useState({
    payment_date: new Date().toISOString().slice(0, 10),
    amount: remaining > 0 ? String(remaining) : "",
    payment_method: "fawry",
    reference_code: "",
    notes: "",
  });

  const save = useMutation({
    mutationFn: async () => {
      const amount = Number(form.amount);
      if (!amount || amount <= 0) throw new Error("المبلغ يجب أن يكون أكبر من صفر");
      if (!user?.id) throw new Error("لا يمكن تحديد هوية المستخدم الحالي");
      const { error } = await supabase.from("bonus_payments").insert({
        monthly_bonus_id: bonus.id,
        marketer_id: bonus.marketer_id,
        payment_date: form.payment_date,
        amount,
        payment_method: form.payment_method,
        reference_code: form.reference_code || null,
        notes: form.notes || null,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تسجيل الدفعة");
      onSaved();
    },
    onError: (error: unknown) => {
      const e = error as { message?: string } | null;
      toast.error("تعذر تسجيل الدفعة", { description: e?.message ?? String(error) });
    },
  });

  return (
    <DialogContent dir="rtl" className="max-w-md">
      <DialogHeader>
        <DialogTitle>تسجيل دفعة جديدة</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label>تاريخ الدفع</Label>
          <Input type="date" value={form.payment_date}
            onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>المبلغ</Label>
          <Input type="number" min={0} step="0.01" value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          {remaining > 0 && (
            <div className="text-xs text-muted-foreground">المتبقي حاليًا: {fmtCurrency(remaining)}</div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>طريقة الدفع</Label>
          <Select value={form.payment_method} onValueChange={(v) => setForm((f) => ({ ...f, payment_method: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fawry">فوري</SelectItem>
              <SelectItem value="bank_transfer">تحويل بنكي</SelectItem>
              <SelectItem value="wallet">محفظة إلكترونية</SelectItem>
              <SelectItem value="cash">كاش</SelectItem>
              <SelectItem value="other">أخرى</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>الرقم المرجعي (اختياري)</Label>
          <Input value={form.reference_code}
            onChange={(e) => setForm((f) => ({ ...f, reference_code: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>ملاحظات (اختياري)</Label>
          <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="h-4 w-4 ml-1 animate-spin" />}
          حفظ
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

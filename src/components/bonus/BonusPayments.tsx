import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { PaymentBadge } from "@/components/bonus/BonusBadges";

const METHOD_LABELS: Record<string, string> = {
  cash: "كاش",
  bank: "تحويل بنكي",
  instapay: "إنستا باي",
  vodafone_cash: "فودافون كاش",
  wallet: "محفظة إلكترونية",
  other: "أخرى",
};

/** Read-only payment summary + history. No entry or edit controls in this phase. */
export function BonusPayments({ bonus, payments }: { bonus: any; payments: any[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">ملخص الدفع</CardTitle>
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

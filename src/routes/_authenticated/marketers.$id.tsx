import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/KpiCard";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtCurrency, fmtDate, fmtNumber, fmtPercent } from "@/lib/format";
import { ORDER_STATUS_KEYS, type OrderStatus } from "@/lib/constants";
import { ArrowRight, ShoppingBag, DollarSign, Wallet, TrendingUp, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/marketers/$id")({
  component: MarketerDetails,
});

function MarketerDetails() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [fawry, setFawry] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: m } = useQuery({
    queryKey: ["marketer", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketers").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["marketer-orders", id],
    queryFn: async () => {
      const { data } = await supabase.from("orders").select("*").eq("marketer_id", id)
        .order("order_date", { ascending: false }).limit(50);
      return data ?? [];
    },
  });

  const { data: spend = [] } = useQuery({
    queryKey: ["marketer-spend", id],
    queryFn: async () => {
      const { data } = await supabase.from("ad_spend_transactions").select("*")
        .eq("marketer_id", id).order("transaction_date", { ascending: false });
      return data ?? [];
    },
  });

  const counts = ORDER_STATUS_KEYS.reduce((a, k) => {
    a[k] = orders.filter((o) => o.status === k).length;
    return a;
  }, {} as Record<OrderStatus, number>);

  const total = orders.length;
  const gross = orders.reduce((s, o) => s + Number(o.commission || 0), 0);
  const totalSpend = spend.reduce((s, t) => s + Number(t.amount || 0), 0);
  const net = gross - totalSpend;
  const delivered = counts.delivered + counts.done;
  const deliveryRate = total > 0 ? delivered / total : 0;

  async function addSpend() {
    if (!amount || Number(amount) <= 0) { toast.error("أدخل مبلغًا صحيحًا"); return; }
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("ad_spend_transactions").insert({
      marketer_id: id,
      amount: Number(amount),
      fawry_code: fawry || null,
      transaction_date: date,
      notes: notes || null,
      created_by: userData.user?.id,
    });
    setBusy(false);
    if (error) { toast.error("فشل الحفظ", { description: error.message }); return; }
    toast.success("تم إضافة المعاملة");
    setAddOpen(false);
    setAmount(""); setFawry(""); setNotes("");
    qc.invalidateQueries({ queryKey: ["marketer-spend", id] });
  }

  if (!m) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to="/marketers"><ArrowRight className="h-4 w-4 ml-1" /> رجوع</Link>
          </Button>
          <h2 className="text-2xl font-display font-bold">{m.name}</h2>
          <div className="text-sm text-muted-foreground">كود: {m.marketer_code}</div>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 ml-1" /> إضافة معاملة محفظة</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>إضافة معاملة إنفاق إعلاني</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>المبلغ</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div><Label>كود فوري</Label><Input value={fawry} onChange={(e) => setFawry(e.target.value)} dir="ltr" /></div>
              <div><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button onClick={addSpend} disabled={busy}>
                {busy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><div className="text-muted-foreground">الهاتف</div><div dir="ltr">{m.phone ?? "—"}</div></div>
          <div><div className="text-muted-foreground">واتساب</div><div dir="ltr">{m.whatsapp ?? "—"}</div></div>
          <div><div className="text-muted-foreground">البريد</div><div dir="ltr">{m.email ?? "—"}</div></div>
          <div><div className="text-muted-foreground">الحالة</div><div>{m.status}</div></div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="إجمالي الطلبات" value={fmtNumber(total)} icon={ShoppingBag} />
        <KpiCard label="إجمالي العمولات" value={fmtCurrency(gross)} icon={DollarSign} tone="success" />
        <KpiCard label="الإنفاق الإعلاني" value={fmtCurrency(totalSpend)} icon={Wallet} tone="warning" />
        <KpiCard label="صافي الربح" value={fmtCurrency(net)} icon={TrendingUp}
          tone={net >= 0 ? "success" : "destructive"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
        {ORDER_STATUS_KEYS.map((k) => (
          <Card key={k}><CardContent className="p-3">
            <StatusBadge status={k} />
            <div className="text-lg font-bold mt-2">{fmtNumber(counts[k])}</div>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">معدل التسليم: {fmtPercent(deliveryRate)}</CardTitle></CardHeader>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">آخر الطلبات</CardTitle></CardHeader>
        <Table>
          <TableHeader><TableRow>
            <TableHead>التاريخ</TableHead><TableHead>رقم الطلب</TableHead>
            <TableHead>العميل</TableHead><TableHead>السعر</TableHead>
            <TableHead>العمولة</TableHead><TableHead>الحالة</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">لا توجد طلبات</TableCell></TableRow>
            ) : orders.slice(0, 20).map((o) => (
              <TableRow key={o.id}>
                <TableCell>{fmtDate(o.order_date)}</TableCell>
                <TableCell dir="ltr">{o.external_order_id ?? "—"}</TableCell>
                <TableCell>{o.customer_name ?? "—"}</TableCell>
                <TableCell>{fmtCurrency(Number(o.price))}</TableCell>
                <TableCell>{fmtCurrency(Number(o.commission))}</TableCell>
                <TableCell><StatusBadge status={o.status as OrderStatus} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">معاملات الإنفاق الإعلاني</CardTitle></CardHeader>
        <Table>
          <TableHeader><TableRow>
            <TableHead>التاريخ</TableHead><TableHead>المبلغ</TableHead>
            <TableHead>كود فوري</TableHead><TableHead>ملاحظات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {spend.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">لا توجد معاملات</TableCell></TableRow>
            ) : spend.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{fmtDate(t.transaction_date)}</TableCell>
                <TableCell className="font-medium">{fmtCurrency(Number(t.amount))}</TableCell>
                <TableCell dir="ltr">{t.fawry_code ?? "—"}</TableCell>
                <TableCell>{t.notes ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

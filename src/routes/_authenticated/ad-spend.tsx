import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/KpiCard";
import { fmtCurrency, fmtDate, fmtNumber } from "@/lib/format";
import { Wallet, Receipt, TrendingDown } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ad-spend")({
  component: AdSpendPage,
});

function AdSpendPage() {
  const [marketerId, setMarketerId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: marketers = [] } = useQuery({
    queryKey: ["marketers-list"],
    queryFn: async () => (await supabase.from("marketers").select("id, name")).data ?? [],
  });

  const { data: tx = [] } = useQuery({
    queryKey: ["ad-spend", marketerId, from, to],
    queryFn: async () => {
      let q = supabase.from("ad_spend_transactions").select("*, marketers(name)")
        .order("transaction_date", { ascending: false });
      if (marketerId !== "all") q = q.eq("marketer_id", marketerId);
      if (from) q = q.gte("transaction_date", from);
      if (to) q = q.lte("transaction_date", to);
      return (await q).data ?? [];
    },
  });

  const total = useMemo(() => tx.reduce((s, t) => s + Number(t.amount || 0), 0), [tx]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-display font-bold">الإنفاق الإعلاني</h2>
        <p className="text-sm text-muted-foreground">معاملات شحن المحفظة الإعلانية</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="إجمالي الإنفاق" value={fmtCurrency(total)} icon={Wallet} tone="warning" />
        <KpiCard label="عدد المعاملات" value={fmtNumber(tx.length)} icon={Receipt} />
        <KpiCard label="متوسط المعاملة" value={fmtCurrency(tx.length ? total / tx.length : 0)} icon={TrendingDown} />
      </div>

      <Card className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div><Label className="text-xs">المسوّق</Label>
          <Select value={marketerId} onValueChange={setMarketerId}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              {marketers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">من</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" /></div>
        <div><Label className="text-xs">إلى</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" /></div>
      </Card>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>التاريخ</TableHead><TableHead>المسوّق</TableHead>
            <TableHead>المبلغ</TableHead><TableHead>كود فوري</TableHead>
            <TableHead>ملاحظات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {tx.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">لا توجد معاملات</TableCell></TableRow>
            ) : tx.map((t: any) => (
              <TableRow key={t.id}>
                <TableCell>{fmtDate(t.transaction_date)}</TableCell>
                <TableCell>{t.marketers?.name ?? "—"}</TableCell>
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

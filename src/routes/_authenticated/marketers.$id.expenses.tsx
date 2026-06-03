import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { fetchAll } from "@/lib/fetch-all";
import { ArrowRight, Download, Wallet } from "lucide-react";
import { toast } from "sonner";

const SPEND_TYPE_LABELS = {
  meta_ads: "Meta Ads",
  tiktok_ads: "Tiktok Ads",
  easy_order: "Easy Order",
  salary: "Salary",
  other: "Other",
} as const;
type SpendType = keyof typeof SPEND_TYPE_LABELS;

export const Route = createFileRoute("/_authenticated/marketers/$id/expenses")({
  component: ExpensesPage,
});

function ExpensesPage() {
  const { id } = Route.useParams();
  const today = new Date().toISOString().slice(0, 10);
  const thirtyAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

  const [fromDate, setFromDate] = useState(thirtyAgo);
  const [toDate, setToDate] = useState(today);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: m } = useQuery({
    queryKey: ["marketer", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketers").select("id, name, marketer_code").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: allSpend = [] } = useQuery({
    queryKey: ["marketer-spend-all", id],
    queryFn: () =>
      fetchAll<any>((a, b) =>
        supabase.from("ad_spend_transactions").select("*")
          .eq("marketer_id", id).order("transaction_date", { ascending: false }).range(a, b),
      ),
  });

  const filtered = useMemo(() => {
    return allSpend.filter((t) => {
      const d = t.transaction_date;
      if (!d || d < fromDate || d > toDate) return false;
      if (typeFilter !== "all" && t.spend_type !== typeFilter) return false;
      return true;
    });
  }, [allSpend, fromDate, toDate, typeFilter]);

  const totals = useMemo(() => {
    const byType: Record<string, number> = {};
    let sum = 0;
    for (const t of filtered) {
      const amt = Number(t.amount || 0);
      sum += amt;
      byType[t.spend_type] = (byType[t.spend_type] ?? 0) + amt;
    }
    return { sum, byType };
  }, [filtered]);

  function setPreset(days: number) {
    const d = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);
    setFromDate(d);
    setToDate(today);
  }

  function exportCsv() {
    if (filtered.length === 0) {
      toast.error("لا توجد بيانات للتصدير");
      return;
    }
    const headers = ["التاريخ", "النوع", "المبلغ", "كود فوري", "ملاحظات"];
    const rows = filtered.map((t) => [
      t.transaction_date ?? "",
      SPEND_TYPE_LABELS[t.spend_type as SpendType] ?? t.spend_type ?? "",
      String(Number(t.amount || 0)),
      t.fawry_code ?? "",
      (t.notes ?? "").replace(/\r?\n/g, " "),
    ]);
    const escape = (v: string) => {
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const csv = "\uFEFF" + [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const code = m?.marketer_code ?? "marketer";
    a.download = `expenses_${code}_${fromDate}_${toDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("تم تصدير الملف");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            to="/marketers/$id"
            params={{ id }}
            className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
          >
            <ArrowRight className="h-3 w-3" /> العودة لصفحة المسوق
          </Link>
          <h2 className="text-2xl font-display font-bold mt-1 flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" />
            مصروفات المسوق {m?.name ? `— ${m.name}` : ""}
          </h2>
        </div>
        <Button onClick={exportCsv} variant="outline">
          <Download className="h-4 w-4 ml-1" /> تصدير CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>من</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>إلى</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="space-y-1 min-w-[180px]">
            <Label>نوع المصروف</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {Object.entries(SPEND_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPreset(7)}>7 أيام</Button>
            <Button variant="outline" size="sm" onClick={() => setPreset(30)}>30 يوم</Button>
            <Button variant="outline" size="sm" onClick={() => setPreset(90)}>90 يوم</Button>
            <Button variant="outline" size="sm" onClick={() => { setFromDate("2000-01-01"); setToDate(today); }}>الكل</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="border-primary/30">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">الإجمالي</div>
            <div className="text-2xl font-bold mt-1">{fmtCurrency(totals.sum)}</div>
            <div className="text-xs text-muted-foreground mt-1">{filtered.length} معاملة</div>
          </CardContent>
        </Card>
        {Object.entries(SPEND_TYPE_LABELS).map(([k, v]) => (
          <Card key={k}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{v}</div>
              <div className="text-lg font-bold mt-1">{fmtCurrency(totals.byType[k] ?? 0)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">المعاملات</CardTitle></CardHeader>
        <Table>
          <TableHeader><TableRow>
            <TableHead>التاريخ</TableHead>
            <TableHead>النوع</TableHead>
            <TableHead>المبلغ</TableHead>
            <TableHead>كود فوري</TableHead>
            <TableHead>ملاحظات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">لا توجد معاملات</TableCell></TableRow>
            ) : filtered.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{fmtDate(t.transaction_date)}</TableCell>
                <TableCell>{SPEND_TYPE_LABELS[t.spend_type as SpendType] ?? t.spend_type}</TableCell>
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

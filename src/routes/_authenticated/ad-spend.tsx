import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { fetchAll } from "@/lib/fetch-all";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { KpiCard } from "@/components/KpiCard";
import { fmtCurrency, fmtDate, fmtNumber } from "@/lib/format";
import { SPEND_TYPE_LABELS, AD_FUNDING_SPEND_TYPES, type SpendType } from "@/lib/constants";
import { Wallet, Receipt, TrendingDown, Plus, FileDown } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ad-spend")({
  component: AdSpendPage,
});

type ExportTxRow = {
  transaction_date: string;
  amount: number;
  // Widened past SpendType: the DB enum still carries the retired
  // 'test_ads' value for old rows (nothing writes it any more — see
  // 20260830130000_test_spend_as_funding_classification.sql), and every
  // such row has since been migrated out of this table, but the column's
  // type still allows it.
  spend_type: SpendType | "test_ads";
  fawry_code: string | null;
  notes: string | null;
  marketers: { name: string } | null;
};

type ExportTestRow = {
  test_date: string;
  test_end_date: string | null;
  amount: number;
  product_name: string | null;
  result: string | null;
  notes: string | null;
  marketers: { name: string } | null;
};

/**
 * Per-marketer summary (wallet totals by type + test spend + the net
 * performance ad spend the bonus engine actually charges), plus full detail
 * sheets for both the wallet ledger and the test-spend classifications.
 */
function buildExportWorkbook(txRows: ExportTxRow[], testRows: ExportTestRow[]) {
  const typeKeys = Object.keys(SPEND_TYPE_LABELS) as SpendType[];
  const names = new Set<string>();
  const txByMarketer = new Map<string, { totals: Record<SpendType, number>; rows: ExportTxRow[] }>();
  const testByMarketer = new Map<string, { total: number; rows: ExportTestRow[] }>();

  for (const r of txRows) {
    const name = r.marketers?.name ?? "بدون مسوّق";
    names.add(name);
    if (!txByMarketer.has(name)) {
      txByMarketer.set(name, {
        totals: Object.fromEntries(typeKeys.map((k) => [k, 0])) as Record<SpendType, number>,
        rows: [],
      });
    }
    const entry = txByMarketer.get(name)!;
    if (r.spend_type !== "test_ads") entry.totals[r.spend_type] += Number(r.amount || 0);
    entry.rows.push(r);
  }
  for (const r of testRows) {
    const name = r.marketers?.name ?? "بدون مسوّق";
    names.add(name);
    if (!testByMarketer.has(name)) testByMarketer.set(name, { total: 0, rows: [] });
    const entry = testByMarketer.get(name)!;
    entry.total += Number(r.amount || 0);
    entry.rows.push(r);
  }
  const marketerNames = Array.from(names).sort((a, b) => a.localeCompare(b, "ar"));

  const summaryHeader = [
    "المسوّق", ...typeKeys.map((k) => SPEND_TYPE_LABELS[k]),
    "إجمالي المحفظة", "مصروف التيست", "صافي الإنفاق الإعلاني (بعد خصم التيست)",
  ];
  const summaryRows = marketerNames.map((name) => {
    const t = txByMarketer.get(name)?.totals ?? (Object.fromEntries(typeKeys.map((k) => [k, 0])) as Record<SpendType, number>);
    const walletTotal = typeKeys.reduce((s, k) => s + t[k], 0);
    const testSpend = testByMarketer.get(name)?.total ?? 0;
    const funding = AD_FUNDING_SPEND_TYPES.reduce((s, k) => s + t[k], 0);
    const netAdSpend = Math.max(funding - testSpend, 0);
    return [name, ...typeKeys.map((k) => t[k]), walletTotal, testSpend, netAdSpend];
  });
  const sumCol = (i: number) => summaryRows.reduce((s, row) => s + Number(row[i] ?? 0), 0);
  summaryRows.push([
    "الإجمالي",
    ...typeKeys.map((_, i) => sumCol(i + 1)),
    sumCol(typeKeys.length + 1), sumCol(typeKeys.length + 2), sumCol(typeKeys.length + 3),
  ]);

  const txDetailHeader = ["المسوّق", "التاريخ", "نوع الصرف", "المبلغ", "كود فوري", "ملاحظات"];
  const txDetailRows: (string | number)[][] = [];
  for (const name of marketerNames) {
    for (const r of txByMarketer.get(name)?.rows ?? []) {
      txDetailRows.push([
        name, r.transaction_date, r.spend_type === "test_ads" ? "Test Ads (قديم)" : SPEND_TYPE_LABELS[r.spend_type],
        Number(r.amount || 0), r.fawry_code ?? "", r.notes ?? "",
      ]);
    }
  }

  const testDetailHeader = ["المسوّق", "من", "إلى", "المنتج", "المبلغ", "النتيجة", "ملاحظات"];
  const testDetailRows: (string | number)[][] = [];
  for (const name of marketerNames) {
    for (const r of testByMarketer.get(name)?.rows ?? []) {
      testDetailRows.push([
        name, r.test_date, r.test_end_date ?? "", r.product_name ?? "",
        Number(r.amount || 0), r.result ?? "", r.notes ?? "",
      ]);
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows]), "ملخص لكل مسوّق");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([txDetailHeader, ...txDetailRows]), "تفاصيل معاملات المحفظة");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([testDetailHeader, ...testDetailRows]), "تفاصيل مصروف التيست");
  return wb;
}

function AdSpendPage() {
  const { user, role } = useAuth();
  const canAdd = role === "admin" || role === "account_manager";
  const qc = useQueryClient();
  const [marketerId, setMarketerId] = useState("all");
  const [spendType, setSpendType] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState(false);

  const { data: marketers = [] } = useQuery({
    queryKey: ["marketers-list"],
    queryFn: async () => (await supabase.from("marketers").select("id, name").order("name")).data ?? [],
  });

  const { data: tx = [] } = useQuery({
    queryKey: ["ad-spend", marketerId, spendType, from, to],
    queryFn: async () => {
      let q = supabase.from("ad_spend_transactions").select("*, marketers(name)")
        .order("transaction_date", { ascending: false });
      if (marketerId !== "all") q = q.eq("marketer_id", marketerId);
      if (spendType !== "all") q = q.eq("spend_type", spendType as SpendType);
      if (from) q = q.gte("transaction_date", from);
      if (to) q = q.lte("transaction_date", to);
      return (await q).data ?? [];
    },
  });

  const { data: dailySpend = [] } = useQuery({
    queryKey: ["ad-spend-daily", marketerId, from, to],
    queryFn: async () => {
      let q = (supabase.from("ad_spend_daily") as any).select("spend_amount, marketer_id, spend_date, source");
      if (marketerId !== "all") q = q.eq("marketer_id", marketerId);
      if (from) q = q.gte("spend_date", from);
      if (to) q = q.lte("spend_date", to);
      const { data } = await q;
      return (data ?? []) as { spend_amount: number; source: string }[];
    },
  });
  const dailyTotal = useMemo(
    () => dailySpend.reduce((s, r) => s + Number(r.spend_amount || 0), 0),
    [dailySpend],
  );

  const createdByIds = useMemo(
    () => Array.from(new Set(tx.map((t: any) => t.created_by).filter(Boolean))),
    [tx],
  );

  const { data: profilesMap = {} } = useQuery({
    queryKey: ["ad-spend-profiles", createdByIds],
    enabled: createdByIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", createdByIds);
      const map: Record<string, { full_name: string | null; email: string | null }> = {};
      (data ?? []).forEach((p: any) => { map[p.id] = { full_name: p.full_name, email: p.email }; });
      return map;
    },
  });

  const total = useMemo(() => tx.reduce((s, t) => s + Number(t.amount || 0), 0), [tx]);

  const exportMut = useMutation({
    mutationFn: async () => {
      const [txRows, testRows] = await Promise.all([
        fetchAll<ExportTxRow>((a, b) => {
          let q = supabase.from("ad_spend_transactions")
            .select("transaction_date, amount, spend_type, fawry_code, notes, marketers(name)")
            .order("transaction_date", { ascending: true });
          if (from) q = q.gte("transaction_date", from);
          if (to) q = q.lte("transaction_date", to);
          return q.range(a, b);
        }),
        fetchAll<ExportTestRow>((a, b) => {
          let q = supabase.from("test_spend_entries")
            .select("test_date, test_end_date, amount, product_name, result, notes, marketers(name)")
            .order("test_date", { ascending: true });
          if (from) q = q.gte("test_date", from);
          if (to) q = q.lte("test_date", to);
          return q.range(a, b);
        }),
      ]);
      if (txRows.length === 0 && testRows.length === 0) throw new Error("لا توجد معاملات في الفترة المحددة");
      const wb = buildExportWorkbook(txRows, testRows);
      const label = from && to ? `${from}_الى_${to}` : from ? `من_${from}` : to ? `حتى_${to}` : "كل_الفترات";
      XLSX.writeFile(wb, `مصاريف-اعلانية_${label}.xlsx`);
    },
    onSuccess: () => toast.success("تم تجهيز الملف"),
    onError: (e: any) => toast.error(e.message ?? "فشل التصدير"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-display font-bold">الإنفاق الإعلاني</h2>
          <p className="text-sm text-muted-foreground">معاملات شحن المحفظة الإعلانية</p>
        </div>
        {canAdd && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => exportMut.mutate()} disabled={exportMut.isPending}>
              <FileDown className="ml-1" />
              {exportMut.isPending ? "جارٍ التصدير..." : "تصدير Excel"}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="ml-1" />إضافة مصروف إعلاني</Button>
              </DialogTrigger>
              <AddExpenseDialog
                marketers={marketers}
                userId={user?.id ?? null}
                onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["ad-spend"] }); }}
              />
            </Dialog>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard label="إجمالي الإنفاق (محفظة)" value={fmtCurrency(total)} icon={Wallet} tone="warning" />
        <KpiCard label="الإنفاق اليومي للحسابات" value={fmtCurrency(dailyTotal)} icon={TrendingDown} tone="info" hint="مجموع ad_spend_daily (يدوي + مزامنة Meta التلقائية)" />
        <KpiCard label="عدد المعاملات" value={fmtNumber(tx.length)} icon={Receipt} />
        <KpiCard label="متوسط المعاملة" value={fmtCurrency(tx.length ? total / tx.length : 0)} icon={TrendingDown} />
      </div>

      <Card className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div><Label className="text-xs">المسوّق</Label>
          <Select value={marketerId} onValueChange={setMarketerId}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              {marketers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">نوع الصرف</Label>
          <Select value={spendType} onValueChange={setSpendType}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              {(Object.keys(SPEND_TYPE_LABELS) as SpendType[]).map((k) => (
                <SelectItem key={k} value={k}>{SPEND_TYPE_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">من</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" /></div>
        <div><Label className="text-xs">إلى</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" /></div>
      </Card>
      {canAdd && (
        <p className="text-xs text-muted-foreground -mt-2">
          ملف Excel بيصدّر كل المسوّقين دايمًا (بغض النظر عن فلتر "المسوّق" فوق) حسب فترة التاريخ المحددة، بنفس حسبة صافي الإنفاق الإعلاني المستخدمة في احتساب البونص.
        </p>
      )}

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>التاريخ</TableHead><TableHead>المسوّق</TableHead>
            <TableHead>كود فوري</TableHead><TableHead>المبلغ</TableHead>
            <TableHead>نوع الصرف</TableHead>
            <TableHead>ملاحظات</TableHead><TableHead>أضيف بواسطة</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {tx.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">لا توجد معاملات</TableCell></TableRow>
            ) : tx.map((t: any) => {
              const p = t.created_by ? profilesMap[t.created_by] : null;
              return (
                <TableRow key={t.id}>
                  <TableCell>{fmtDate(t.transaction_date)}</TableCell>
                  <TableCell>{t.marketers?.name ?? "—"}</TableCell>
                  <TableCell dir="ltr">{t.fawry_code ?? "—"}</TableCell>
                  <TableCell className="font-medium">{fmtCurrency(Number(t.amount))}</TableCell>
                  <TableCell>{SPEND_TYPE_LABELS[t.spend_type as keyof typeof SPEND_TYPE_LABELS] ?? "—"}</TableCell>
                  <TableCell>{t.notes ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p?.full_name || p?.email || "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function AddExpenseDialog({
  marketers, userId, onDone,
}: {
  marketers: { id: string; name: string }[];
  userId: string | null;
  onDone: () => void;
}) {
  const [marketerId, setMarketerId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fawryCode, setFawryCode] = useState("");
  const [amount, setAmount] = useState("");
  const [spendType, setSpendType] = useState<SpendType>("meta_ads");
  const [notes, setNotes] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      if (!marketerId) throw new Error("اختر المسوّق");
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error("أدخل مبلغًا صحيحًا");
      const code = fawryCode.trim();
      if (code) {
        const { data: existing } = await supabase
          .from("ad_spend_transactions")
          .select("id").eq("fawry_code", code).maybeSingle();
        if (existing) throw new Error("كود فوري مستخدم من قبل، لا يمكن تكراره");
      }
      const { error } = await supabase.from("ad_spend_transactions").insert({
        marketer_id: marketerId,
        transaction_date: date,
        fawry_code: code || null,
        amount: amt,
        spend_type: spendType,
        notes: notes || null,
        created_by: userId,
      } as any);
      if (error) {
        if ((error as any).code === "23505") throw new Error("كود فوري مستخدم من قبل، لا يمكن تكراره");
        throw error;
      }
    },
    onSuccess: () => { toast.success("تم إضافة المصروف"); onDone(); },
    onError: (e: any) => toast.error(e.message ?? "فشل الحفظ"),
  });

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>إضافة مصروف إعلاني</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">المسوّق</Label>
          <Select value={marketerId} onValueChange={setMarketerId}>
            <SelectTrigger className="h-9"><SelectValue placeholder="اختر المسوّق" /></SelectTrigger>
            <SelectContent>
              {marketers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">التاريخ</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
        </div>
        <div>
          <Label className="text-xs">الرقم المرجعي (كود فوري)</Label>
          <Input dir="ltr" value={fawryCode} onChange={(e) => setFawryCode(e.target.value)} className="h-9" placeholder="فريد - لا يمكن تكراره" />
        </div>
        <div>
          <Label className="text-xs">المبلغ</Label>
          <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9" />
        </div>
        <div>
          <Label className="text-xs">نوع الصرف</Label>
          <Select value={spendType} onValueChange={(v) => setSpendType(v as SpendType)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(SPEND_TYPE_LABELS) as SpendType[]).map((k) => (
                <SelectItem key={k} value={k}>{SPEND_TYPE_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            مصروف التيست بيتسجل من صفحة مصروفات المسوّق، لأنه جزء من التمويل الإعلاني وليس مبلغًا إضافيًا.
          </p>
        </div>
        <div>
          <Label className="text-xs">ملاحظات</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

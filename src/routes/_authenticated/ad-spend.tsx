import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
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
import { Wallet, Receipt, TrendingDown, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ad-spend")({
  component: AdSpendPage,
});

const SPEND_TYPE_LABELS = {
  meta_ads: "Meta Ads",
  tiktok_ads: "Tiktok Ads",
  easy_order: "Easy Order",
  test_ads: "Test Ads",
  salary: "Salary",
  other: "Other",
} as const;
type SpendType = keyof typeof SPEND_TYPE_LABELS;

function AdSpendPage() {
  const { user } = useAuth();
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-display font-bold">الإنفاق الإعلاني</h2>
          <p className="text-sm text-muted-foreground">معاملات شحن المحفظة الإعلانية</p>
        </div>
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard label="إجمالي الإنفاق (محفظة)" value={fmtCurrency(total)} icon={Wallet} tone="warning" />
        <KpiCard label="الإنفاق اليومي للحسابات" value={fmtCurrency(dailyTotal)} icon={TrendingDown} tone="info" hint="مجموع ad_spend_daily (يدوي + Meta/TikTok مستقبلاً)" />
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
          {spendType === "test_ads" && (
            <p className="text-xs text-muted-foreground mt-1">
              مصاريف تجارب تطلبها الشركة — الشركة هي اللي بتتحملها ومش بتتخصم من أرباح أو بونص المسوّق.
            </p>
          )}
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

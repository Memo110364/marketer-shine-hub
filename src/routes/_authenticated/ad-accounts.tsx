import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { KpiCard } from "@/components/KpiCard";
import { fmtDate } from "@/lib/format";
import { Megaphone, Plug, AlertTriangle, RefreshCw, Plus, Pencil, Trash2, Receipt, History, Link2, Shield, Eye, CheckCircle2, ChevronLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ad-accounts")({
  component: AdAccountsPage,
});

const PLATFORM_LABELS: Record<string, string> = { meta: "Meta", tiktok: "TikTok", manual: "يدوي" };

function getConnLabel(account: Account) {
  const s = account.connection_status;
  const p = account.platform;
  if (s === "not_connected") return { label: "غير متصل", tone: "secondary" as const };
  if (s === "connected") {
    if (p === "meta" && account.external_account_id) return { label: "متصل عبر Meta", tone: "success" as const };
    return { label: "متصل يدويًا", tone: "success" as const };
  }
  if (s === "expired") return { label: "يحتاج إعادة ربط", tone: "warning" as const };
  if (s === "error") return { label: "خطأ في الربط", tone: "destructive" as const };
  return { label: s, tone: "secondary" as const };
}

type Account = {
  id: string;
  marketer_id: string | null;
  platform: "meta" | "tiktok" | "manual";
  account_name: string | null;
  ad_account_id: string | null;
  external_account_id: string | null;
  currency: string | null;
  connection_status: string;
  access_status: string | null;
  last_sync_at: string | null;
  marketers?: { name: string } | null;
};

function AdAccountsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [spendFor, setSpendFor] = useState<Account | null>(null);
  const [logsFor, setLogsFor] = useState<Account | null>(null);
  const [metaConnectOpen, setMetaConnectOpen] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ["ad-accounts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("ad_accounts")
        .select("*, marketers(name)")
        .order("created_at", { ascending: false });
      return (data ?? []) as Account[];
    },
  });

  const { data: marketers = [] } = useQuery({
    queryKey: ["marketers-list"],
    queryFn: async () => (await supabase.from("marketers").select("id, name").order("name")).data ?? [],
  });

  const stats = useMemo(() => {
    const total = accounts.length;
    const connected = accounts.filter((a) => a.connection_status === "connected").length;
    const needs = accounts.filter((a) => a.connection_status === "expired" || a.connection_status === "error").length;
    const last = accounts
      .map((a) => a.last_sync_at)
      .filter(Boolean)
      .sort()
      .reverse()[0];
    return { total, connected, needs, last: last ? fmtDate(last as string) : "—" };
  }, [accounts]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["ad-accounts"] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-display font-bold">حسابات الإعلانات</h2>
          <p className="text-sm text-muted-foreground">إدارة حسابات Meta و TikTok والمزامنة المستقبلية</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setMetaConnectOpen(true)}>
            <Link2 className="ml-1 h-4 w-4" />ربط حساب Meta
          </Button>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditing(null)}><Plus className="ml-1" />إضافة حساب إعلاني</Button>
            </DialogTrigger>
            <AccountDialog
              account={editing}
              marketers={marketers as { id: string; name: string }[]}
              onDone={() => { setOpen(false); setEditing(null); refresh(); }}
            />
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard label="عدد الحسابات المسجلة" value={stats.total} icon={Megaphone} />
        <KpiCard label="الحسابات المتصلة" value={stats.connected} icon={Plug} tone="success" />
        <KpiCard label="تحتاج إعادة ربط" value={stats.needs} icon={AlertTriangle} tone="warning" />
        <KpiCard label="آخر مزامنة" value={stats.last} icon={RefreshCw} tone="info" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">الحسابات المسجّلة</CardTitle></CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المسوّق</TableHead>
              <TableHead>المنصة</TableHead>
              <TableHead>اسم الحساب</TableHead>
              <TableHead>رقم الحساب الإعلاني</TableHead>
              <TableHead>العملة</TableHead>
              <TableHead>حالة الاتصال</TableHead>
              <TableHead>آخر مزامنة</TableHead>
              <TableHead className="text-left">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">لا توجد حسابات</TableCell></TableRow>
            ) : accounts.map((a) => {
              const conn = getConnLabel(a);
              return (
                <TableRow key={a.id}>
                  <TableCell>{a.marketers?.name ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{PLATFORM_LABELS[a.platform] ?? a.platform}</Badge></TableCell>
                  <TableCell>{a.account_name ?? "—"}</TableCell>
                  <TableCell dir="ltr">{a.external_account_id ?? a.ad_account_id ?? "—"}</TableCell>
                  <TableCell>{a.currency ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={conn.tone === "secondary" ? "secondary" : "outline"}
                      className={
                        conn.tone === "success" ? "bg-success/15 text-success border-success/30" :
                        conn.tone === "warning" ? "bg-warning/15 text-warning-foreground border-warning/30" :
                        conn.tone === "destructive" ? "bg-destructive/15 text-destructive border-destructive/30" : ""
                      }>
                      {conn.label}
                    </Badge>
                  </TableCell>
                  <TableCell>{a.last_sync_at ? fmtDate(a.last_sync_at) : "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" title="تعديل"
                        onClick={() => { setEditing(a); setOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="تسجيل إنفاق يدوي"
                        onClick={() => setSpendFor(a)}>
                        <Receipt className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="عرض سجل المزامنة"
                        onClick={() => setLogsFor(a)}>
                        <History className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="حذف"
                        onClick={() => setDeleting(a)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Manual spend dialog */}
      {spendFor && (
        <ManualSpendDialog
          account={spendFor}
          onClose={() => setSpendFor(null)}
        />
      )}

      {/* Sync logs dialog */}
      {logsFor && (
        <SyncLogsDialog account={logsFor} onClose={() => setLogsFor(null)} />
      )}

      {/* Meta connect modal */}
      <MetaConnectDialog
        open={metaConnectOpen}
        onClose={() => setMetaConnectOpen(false)}
        onManual={() => { setMetaConnectOpen(false); setEditing(null); setOpen(true); }}
        onStartWizard={() => { setMetaConnectOpen(false); navigate({ to: "/ad-accounts/connect-meta" }); }}
      />
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الحساب الإعلاني؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف الحساب وجميع بيانات الإنفاق اليومي وسجلات المزامنة المرتبطة به.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleting) return;
                const { error } = await supabase.from("ad_accounts").delete().eq("id", deleting.id);
                if (error) toast.error(error.message);
                else { toast.success("تم الحذف"); refresh(); }
                setDeleting(null);
              }}
            >حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AccountDialog({
  account, marketers, onDone,
}: {
  account: Account | null;
  marketers: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [marketerId, setMarketerId] = useState(account?.marketer_id ?? "");
  const [platform, setPlatform] = useState<string>(account?.platform ?? "meta");
  const [accountName, setAccountName] = useState(account?.account_name ?? "");
  const [externalId, setExternalId] = useState(account?.external_account_id ?? account?.ad_account_id ?? "");
  const [currency, setCurrency] = useState(account?.currency ?? "EGP");
  const [conn, setConn] = useState(account?.connection_status ?? "not_connected");

  const mut = useMutation({
    mutationFn: async () => {
      if (!marketerId) throw new Error("اختر المسوّق");
      const payload = {
        marketer_id: marketerId,
        platform: platform as "meta" | "tiktok" | "manual",
        account_name: accountName || null,
        external_account_id: externalId || null,
        ad_account_id: externalId || null,
        currency: currency || "EGP",
        connection_status: conn,
      };
      if (account) {
        const { error } = await supabase.from("ad_accounts").update(payload).eq("id", account.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("ad_accounts").insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success(account ? "تم التحديث" : "تمت الإضافة"); onDone(); },
    onError: (e: any) => toast.error(e.message ?? "فشل الحفظ"),
  });

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{account ? "تعديل حساب إعلاني" : "إضافة حساب إعلاني"}</DialogTitle></DialogHeader>
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
          <Label className="text-xs">المنصة</Label>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="meta">Meta</SelectItem>
              <SelectItem value="tiktok">TikTok</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">اسم الحساب</Label>
          <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} className="h-9" />
        </div>
        <div>
          <Label className="text-xs">رقم الحساب الإعلاني</Label>
          <Input dir="ltr" value={externalId} onChange={(e) => setExternalId(e.target.value)} className="h-9" />
        </div>
        <div>
          <Label className="text-xs">العملة</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="EGP">EGP</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
              <SelectItem value="SAR">SAR</SelectItem>
              <SelectItem value="AED">AED</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">حالة الاتصال</Label>
          <Select value={conn} onValueChange={setConn}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="not_connected">غير متصل</SelectItem>
              <SelectItem value="connected">متصل</SelectItem>
              <SelectItem value="expired">منتهي</SelectItem>
              <SelectItem value="error">خطأ</SelectItem>
            </SelectContent>
          </Select>
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

function ManualSpendDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      if (!account.marketer_id) throw new Error("لا يوجد مسوّق مرتبط بالحساب");
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error("أدخل مبلغًا صحيحًا");
      const { error } = await (supabase.from("ad_spend_daily") as any).insert({
        marketer_id: account.marketer_id,
        ad_account_id: account.id,
        platform: account.platform,
        spend_date: date,
        spend_amount: amt,
        currency: account.currency ?? "EGP",
        source: "manual",
        sync_status: "ok",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تسجيل الإنفاق");
      qc.invalidateQueries({ queryKey: ["ad-spend-daily"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "فشل الحفظ"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>تسجيل إنفاق يدوي — {account.account_name ?? ""}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">التاريخ</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">المبلغ ({account.currency ?? "EGP"})</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SyncLogsDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const { data: logs = [] } = useQuery({
    queryKey: ["sync-logs", account.id],
    queryFn: async () => {
      const { data } = await (supabase.from("integration_sync_logs") as any)
        .select("*")
        .eq("ad_account_id", account.id)
        .order("sync_started_at", { ascending: false })
        .limit(50);
      return (data ?? []) as any[];
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>سجل المزامنة — {account.account_name ?? ""}</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>البداية</TableHead>
                <TableHead>النهاية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>أُنشئ</TableHead>
                <TableHead>حُدّث</TableHead>
                <TableHead>الخطأ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">لا توجد سجلات بعد</TableCell></TableRow>
              ) : logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{fmtDate(l.sync_started_at)}</TableCell>
                  <TableCell>{l.sync_finished_at ? fmtDate(l.sync_finished_at) : "—"}</TableCell>
                  <TableCell><Badge variant="outline">{l.status}</Badge></TableCell>
                  <TableCell>{l.records_created}</TableCell>
                  <TableCell>{l.records_updated}</TableCell>
                  <TableCell className="text-destructive text-xs">{l.error_message ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetaConnectDialog({
  open, onClose, onManual,
}: {
  open: boolean;
  onClose: () => void;
  onManual: () => void;
}) {
  const steps = [
    "سجّل الدخول بحساب فيسبوك المرتبط بمدير الأعمال أو الحساب الإعلاني.",
    "امنح صلاحية قراءة بيانات الإعلانات فقط.",
    "اختر الحساب الإعلاني الذي تريد ربطه.",
    "تأكد أن الحساب الإعلاني تابع لكود المسوق الصحيح.",
    "اضغط تأكيد الربط.",
  ];

  const syncItems = [
    { label: "Ad Account ID", icon: Eye },
    { label: "Ad Account Name", icon: Megaphone },
    { label: "Currency", icon: Receipt },
    { label: "Daily Spend", icon: Receipt },
    { label: "Spend Date", icon: Receipt },
    { label: "Sync Status", icon: CheckCircle2 },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            ربط حساب Meta الإعلاني
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Steps */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground">خطوات الربط:</p>
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Important note */}
          <div className="rounded-lg bg-accent/30 border border-accent/40 p-3 space-y-1">
            <div className="flex items-center gap-2 text-accent-foreground font-semibold text-sm">
              <Shield className="h-4 w-4" />
              ملاحظة هامة
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              النظام سيستخدم صلاحية قراءة بيانات الإعلانات فقط بهدف جلب الإنفاق اليومي، ولن يقوم بإنشاء أو تعديل أو حذف أي حملات إعلانية.
            </p>
          </div>

          {/* Permissions box */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="text-sm font-semibold text-foreground">الصلاحية المطلوبة:</p>
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 font-mono text-sm text-foreground">
              <Shield className="h-4 w-4 text-primary" />
              ads_read
            </div>
          </div>

          {/* Future data preview */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">البيانات التي سيتم مزامنتها:</p>
            <div className="grid grid-cols-2 gap-2">
              {syncItems.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground"
                >
                  <item.icon className="h-3.5 w-3.5 text-primary" />
                  {item.label}
                </div>
              ))}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex flex-col gap-2 pt-2">
            <Button disabled className="w-full gap-2">
              <Link2 className="h-4 w-4" />
              ابدأ الربط مع Meta
              <Badge variant="secondary" className="mr-1 text-[10px] px-1.5 py-0">قريبًا</Badge>
            </Button>
            <Button variant="outline" className="w-full gap-2" onClick={onManual}>
              <Plus className="h-4 w-4" />
              إضافة الحساب يدويًا الآن
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

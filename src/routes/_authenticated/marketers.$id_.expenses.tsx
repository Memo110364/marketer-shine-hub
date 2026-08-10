import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { fetchAll } from "@/lib/fetch-all";
import { ArrowRight, Download, Wallet, Pencil, Trash2, Check, X, Clock } from "lucide-react";
import { toast } from "sonner";

const SPEND_TYPE_LABELS = {
  meta_ads: "Meta Ads",
  tiktok_ads: "Tiktok Ads",
  easy_order: "Easy Order",
  test_ads: "Test Ads",
  salary: "Salary",
  other: "Other",
} as const;
type SpendType = keyof typeof SPEND_TYPE_LABELS;

export const Route = createFileRoute("/_authenticated/marketers/$id_/expenses")({
  component: ExpensesPage,
});

function ExpensesPage() {
  const { id } = Route.useParams();
  const { user, role } = useAuth();
  const isAdmin = role === "admin";
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const thirtyAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

  const [fromDate, setFromDate] = useState(thirtyAgo);
  const [toDate, setToDate] = useState(today);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const [editTx, setEditTx] = useState<any | null>(null);
  const [deleteTx, setDeleteTx] = useState<any | null>(null);

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

  const { data: requests = [] } = useQuery({
    queryKey: ["spend-change-requests", id],
    queryFn: async () => {
      const { data } = await (supabase.from("ad_spend_change_requests") as any)
        .select("*")
        .eq("marketer_id", id)
        .order("created_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const pendingByTx = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of requests) {
      if (r.status === "pending") map[r.transaction_id] = r;
    }
    return map;
  }, [requests]);

  const pendingRequests = useMemo(() => requests.filter((r) => r.status === "pending"), [requests]);

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

  const reviewMut = useMutation({
    mutationFn: async ({ req, approve, notes }: { req: any; approve: boolean; notes?: string }) => {
      if (approve) {
        if (req.action === "delete") {
          const { error } = await supabase.from("ad_spend_transactions").delete().eq("id", req.transaction_id);
          if (error) throw error;
        } else if (req.action === "update") {
          const payload = req.proposed_data ?? {};
          const { error } = await supabase.from("ad_spend_transactions").update({
            transaction_date: payload.transaction_date,
            amount: payload.amount,
            spend_type: payload.spend_type,
            fawry_code: payload.fawry_code || null,
            notes: payload.notes || null,
          }).eq("id", req.transaction_id);
          if (error) throw error;
        }
      }
      const { error } = await (supabase.from("ad_spend_change_requests") as any).update({
        status: approve ? "approved" : "rejected",
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
        review_notes: notes ?? null,
      }).eq("id", req.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.approve ? "تمت الموافقة وتطبيق التغيير" : "تم رفض الطلب");
      qc.invalidateQueries({ queryKey: ["spend-change-requests", id] });
      qc.invalidateQueries({ queryKey: ["marketer-spend-all", id] });
    },
    onError: (e: any) => toast.error(e.message ?? "فشل تنفيذ الطلب"),
  });

  const cancelReqMut = useMutation({
    mutationFn: async (reqId: string) => {
      const { error } = await supabase.from("ad_spend_change_requests").delete().eq("id", reqId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم إلغاء الطلب");
      qc.invalidateQueries({ queryKey: ["spend-change-requests", id] });
    },
    onError: (e: any) => toast.error(e.message ?? "فشل الإلغاء"),
  });

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

      {pendingRequests.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              طلبات تعديل/حذف قيد المراجعة ({pendingRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingRequests.map((r) => {
              const tx = allSpend.find((t) => t.id === r.transaction_id);
              const isOwner = r.requested_by === user?.id;
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-2 p-2 rounded border bg-muted/30">
                  <Badge variant={r.action === "delete" ? "destructive" : "secondary"}>
                    {r.action === "delete" ? "حذف" : "تعديل"}
                  </Badge>
                  <div className="text-sm flex-1 min-w-[200px]">
                    {tx ? `${fmtDate(tx.transaction_date)} — ${fmtCurrency(Number(tx.amount))} — ${SPEND_TYPE_LABELS[tx.spend_type as SpendType] ?? tx.spend_type}` : "معاملة محذوفة"}
                    {r.reason && <div className="text-xs text-muted-foreground mt-1">السبب: {r.reason}</div>}
                    {r.action === "update" && r.proposed_data && tx && (
                      <div className="text-xs text-muted-foreground mt-1">
                        التغيير: 
                        {r.proposed_data.amount !== tx.amount && ` المبلغ ${fmtCurrency(Number(r.proposed_data.amount))} `}
                        {r.proposed_data.transaction_date !== tx.transaction_date && ` التاريخ ${fmtDate(r.proposed_data.transaction_date)} `}
                        {r.proposed_data.spend_type !== tx.spend_type && ` النوع ${SPEND_TYPE_LABELS[r.proposed_data.spend_type as SpendType]} `}
                      </div>
                    )}
                  </div>
                  {isAdmin ? (
                    <>
                      <Button size="sm" variant="default" onClick={() => reviewMut.mutate({ req: r, approve: true })} disabled={reviewMut.isPending}>
                        <Check className="h-3 w-3 ml-1" /> موافقة
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => reviewMut.mutate({ req: r, approve: false })} disabled={reviewMut.isPending}>
                        <X className="h-3 w-3 ml-1" /> رفض
                      </Button>
                    </>
                  ) : isOwner ? (
                    <Button size="sm" variant="outline" onClick={() => cancelReqMut.mutate(r.id)} disabled={cancelReqMut.isPending}>
                      إلغاء الطلب
                    </Button>
                  ) : (
                    <Badge variant="outline">بانتظار الادمن</Badge>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

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
            <TableHead className="w-[140px]">إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">لا توجد معاملات</TableCell></TableRow>
            ) : filtered.map((t) => {
              const pending = pendingByTx[t.id];
              return (
                <TableRow key={t.id}>
                  <TableCell>{fmtDate(t.transaction_date)}</TableCell>
                  <TableCell>{SPEND_TYPE_LABELS[t.spend_type as SpendType] ?? t.spend_type}</TableCell>
                  <TableCell className="font-medium">{fmtCurrency(Number(t.amount))}</TableCell>
                  <TableCell dir="ltr">{t.fawry_code ?? "—"}</TableCell>
                  <TableCell>{t.notes ?? "—"}</TableCell>
                  <TableCell>
                    {pending ? (
                      <Badge variant="outline" className="text-amber-600 border-amber-500/40">
                        <Clock className="h-3 w-3 ml-1" /> قيد المراجعة
                      </Badge>
                    ) : (
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditTx(t)} title={isAdmin ? "تعديل" : "طلب تعديل"}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteTx(t)} title={isAdmin ? "حذف" : "طلب حذف"}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {editTx && (
        <EditDialog
          tx={editTx}
          isAdmin={isAdmin}
          userId={user?.id ?? null}
          marketerId={id}
          onClose={() => setEditTx(null)}
          onDone={() => {
            setEditTx(null);
            qc.invalidateQueries({ queryKey: ["marketer-spend-all", id] });
            qc.invalidateQueries({ queryKey: ["spend-change-requests", id] });
          }}
        />
      )}

      {deleteTx && (
        <DeleteDialog
          tx={deleteTx}
          isAdmin={isAdmin}
          userId={user?.id ?? null}
          marketerId={id}
          onClose={() => setDeleteTx(null)}
          onDone={() => {
            setDeleteTx(null);
            qc.invalidateQueries({ queryKey: ["marketer-spend-all", id] });
            qc.invalidateQueries({ queryKey: ["spend-change-requests", id] });
          }}
        />
      )}
    </div>
  );
}

function EditDialog({
  tx, isAdmin, userId, marketerId, onClose, onDone,
}: {
  tx: any; isAdmin: boolean; userId: string | null; marketerId: string;
  onClose: () => void; onDone: () => void;
}) {
  const [date, setDate] = useState(tx.transaction_date ?? "");
  const [amount, setAmount] = useState(String(tx.amount ?? ""));
  const [spendType, setSpendType] = useState<SpendType>(tx.spend_type);
  const [fawryCode, setFawryCode] = useState(tx.fawry_code ?? "");
  const [notes, setNotes] = useState(tx.notes ?? "");
  const [reason, setReason] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error("أدخل مبلغًا صحيحًا");
      const payload = {
        transaction_date: date,
        amount: amt,
        spend_type: spendType,
        fawry_code: fawryCode.trim() || null,
        notes: notes || null,
      };
      if (isAdmin) {
        const { error } = await supabase.from("ad_spend_transactions").update(payload).eq("id", tx.id);
        if (error) throw error;
      } else {
        if (!reason.trim()) throw new Error("أدخل سبب التعديل");
        const { error } = await (supabase.from("ad_spend_change_requests") as any).insert({
          transaction_id: tx.id,
          marketer_id: marketerId,
          requested_by: userId,
          action: "update",
          proposed_data: payload,
          reason: reason.trim(),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(isAdmin ? "تم التعديل" : "تم إرسال طلب التعديل للموافقة");
      onDone();
    },
    onError: (e: any) => toast.error(e.message ?? "فشل العملية"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isAdmin ? "تعديل المصروف" : "طلب تعديل المصروف"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">التاريخ</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
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
                مصاريف تجارب تطلبها الشركة — مش بتتخصم من أرباح أو بونص المسوّق.
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs">كود فوري</Label>
            <Input dir="ltr" value={fawryCode} onChange={(e) => setFawryCode(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">ملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          {!isAdmin && (
            <div>
              <Label className="text-xs">سبب طلب التعديل *</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="وضّح سبب التعديل للادمن" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "جارٍ..." : isAdmin ? "حفظ" : "إرسال للموافقة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  tx, isAdmin, userId, marketerId, onClose, onDone,
}: {
  tx: any; isAdmin: boolean; userId: string | null; marketerId: string;
  onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      if (isAdmin) {
        const { error } = await supabase.from("ad_spend_transactions").delete().eq("id", tx.id);
        if (error) throw error;
      } else {
        if (!reason.trim()) throw new Error("أدخل سبب الحذف");
        const { error } = await (supabase.from("ad_spend_change_requests") as any).insert({
          transaction_id: tx.id,
          marketer_id: marketerId,
          requested_by: userId,
          action: "delete",
          reason: reason.trim(),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(isAdmin ? "تم الحذف" : "تم إرسال طلب الحذف للموافقة");
      onDone();
    },
    onError: (e: any) => toast.error(e.message ?? "فشل العملية"),
  });

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isAdmin ? "تأكيد الحذف" : "طلب حذف المصروف"}</AlertDialogTitle>
          <AlertDialogDescription>
            معاملة بتاريخ {fmtDate(tx.transaction_date)} بمبلغ {fmtCurrency(Number(tx.amount))}.
            {isAdmin ? " هل أنت متأكد من الحذف؟" : " سيتم إرسال طلب الحذف للادمن للموافقة."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!isAdmin && (
          <div className="space-y-1">
            <Label className="text-xs">سبب طلب الحذف *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="وضّح سبب الحذف للادمن" />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); mut.mutate(); }} disabled={mut.isPending}>
            {mut.isPending ? "جارٍ..." : isAdmin ? "حذف" : "إرسال للموافقة"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

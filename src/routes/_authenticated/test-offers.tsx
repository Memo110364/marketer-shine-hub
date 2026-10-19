import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { fmtCurrency, fmtDate, fmtNumber } from "@/lib/format";
import { FlaskConical, Plus, Lock, LockOpen, Trash2, Search, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/test-offers")({
  component: TestOffersPage,
});

type OfferRow = {
  id: string;
  product_id: string | null;
  product_name: string | null;
  daily_test_budget: number;
  duration_days: number;
  max_marketers: number;
  notes: string | null;
  status: "open" | "closed";
  created_at: string;
  products?: { name: string } | null;
};

type ClaimRow = {
  id: string;
  offer_id: string;
  marketer_id: string;
  accepted_at: string;
  marketers?: { name: string; marketer_code: string } | null;
};

function TestOffersPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  if (role && role !== "admin" && role !== "account_manager") {
    throw redirect({ to: "/dashboard" });
  }

  const { data: offers = [], isLoading } = useQuery({
    queryKey: ["test-product-offers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("test_product_offers")
        .select("*, products(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as OfferRow[];
    },
  });

  const { data: claims = [] } = useQuery({
    queryKey: ["test-product-offer-claims"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("test_product_offer_claims")
        .select("*, marketers(name, marketer_code)");
      if (error) throw error;
      return data as unknown as ClaimRow[];
    },
  });

  const claimsByOffer = useMemo(() => {
    const map = new Map<string, ClaimRow[]>();
    for (const c of claims) {
      if (!map.has(c.offer_id)) map.set(c.offer_id, []);
      map.get(c.offer_id)!.push(c);
    }
    return map;
  }, [claims]);

  const toggleStatus = useMutation({
    mutationFn: async (offer: OfferRow) => {
      const { error } = await supabase
        .from("test_product_offers")
        .update({ status: offer.status === "open" ? "closed" : "open" })
        .eq("id", offer.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test-product-offers"] }),
    onError: (e: any) => toast.error(e.message ?? "فشل تحديث الحالة"),
  });

  const deleteOffer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("test_product_offers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حذف الفرصة");
      qc.invalidateQueries({ queryKey: ["test-product-offers"] });
      qc.invalidateQueries({ queryKey: ["test-product-offer-claims"] });
    },
    onError: (e: any) => toast.error(e.message ?? "فشل الحذف"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-display font-bold">فرص اختبار المنتجات</h2>
          <p className="text-sm text-muted-foreground">
            أرقام استرشادية فقط لتنسيق مين بيجرب إيه — لا تدخل في حسابات البونص أو الأرباح أو تمويل الإعلانات. مصروف التيست الحقيقي يُسجَّل كالمعتاد من صفحة المسوّق.
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 ml-1" /> إضافة فرصة تيست</Button>
          </DialogTrigger>
          <AddOfferDialog onDone={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ["test-product-offers"] }); }} />
        </Dialog>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المنتج</TableHead>
                <TableHead>البادجيت اليومي</TableHead>
                <TableHead>عدد الأيام</TableHead>
                <TableHead>الأماكن</TableHead>
                <TableHead>المسوّقين اللي قبلوا</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="w-[110px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">جارٍ التحميل…</TableCell></TableRow>
              ) : offers.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">لا توجد فرص تيست مضافة بعد</TableCell></TableRow>
              ) : offers.map((o) => {
                const acceptedList = claimsByOffer.get(o.id) ?? [];
                const full = acceptedList.length >= o.max_marketers;
                return (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.products?.name ?? o.product_name ?? "—"}</TableCell>
                    <TableCell>{fmtCurrency(o.daily_test_budget)}</TableCell>
                    <TableCell>{fmtNumber(o.duration_days)}</TableCell>
                    <TableCell>
                      {fmtNumber(acceptedList.length)} / {fmtNumber(o.max_marketers)}
                      {full && <Badge variant="outline" className="mr-1 text-[10px]">مكتملة</Badge>}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      {acceptedList.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {acceptedList.map((c) => (
                            <Badge key={c.id} variant="outline" className="text-[11px]">
                              {c.marketers?.name ?? "—"} · {fmtDate(c.accepted_at)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={o.status === "open" ? "default" : "outline"}>
                        {o.status === "open" ? "مفتوحة" : "مقفولة"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7"
                          title={o.status === "open" ? "إقفال الفرصة" : "إعادة فتح الفرصة"}
                          onClick={() => toggleStatus.mutate(o)}
                        >
                          {o.status === "open" ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                          title="حذف الفرصة"
                          onClick={() => { if (confirm("حذف فرصة التيست دي نهائيًا؟")) deleteOffer.mutate(o.id); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function AddOfferDialog({ onDone }: { onDone: () => void }) {
  const [unlisted, setUnlisted] = useState(false);
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = useState("");
  const [freeText, setFreeText] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [maxMarketers, setMaxMarketers] = useState("1");
  const [notes, setNotes] = useState("");

  const { data: matches = [], isFetching } = useQuery({
    queryKey: ["test-offer-product-search", search],
    enabled: !unlisted && !product && search.trim().length >= 2,
    queryFn: async () => {
      const { data } = await supabase
        .from("products").select("id, name")
        .ilike("name", `%${search.trim()}%`).limit(8);
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const mut = useMutation({
    mutationFn: async () => {
      const name = unlisted ? freeText.trim() : product?.name ?? "";
      if (!name) throw new Error("اختر المنتج من القائمة أو اكتب اسمه");
      const budget = Number(dailyBudget);
      if (!budget || budget <= 0) throw new Error("أدخل بادجيت يومي صحيح");
      const days = Number(durationDays);
      if (!days || days <= 0) throw new Error("أدخل عدد أيام صحيح");
      const slots = Number(maxMarketers);
      if (!slots || slots <= 0) throw new Error("أدخل عدد أماكن صحيح");

      const { data: userRes } = await supabase.auth.getUser();
      const { error } = await supabase.from("test_product_offers").insert({
        product_id: unlisted ? null : product?.id ?? null,
        product_name: name,
        daily_test_budget: budget,
        duration_days: days,
        max_marketers: slots,
        notes: notes.trim() || null,
        created_by: userRes.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم إضافة فرصة التيست");
      onDone();
    },
    onError: (e: any) => toast.error(e.message ?? "فشل الحفظ"),
  });

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4" /> إضافة فرصة تيست جديدة</DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>المنتج *</Label>
          {unlisted ? (
            <>
              <Input value={freeText} onChange={(e) => setFreeText(e.target.value)} placeholder="اكتب اسم المنتج" />
              <button type="button" className="text-xs text-primary hover:underline"
                onClick={() => { setUnlisted(false); setFreeText(""); }}>
                رجوع للاختيار من قائمة المنتجات
              </button>
            </>
          ) : product ? (
            <div className="flex items-center justify-between rounded-md border p-2">
              <span className="text-sm">{product.name}</span>
              <Button size="sm" variant="ghost" onClick={() => { setProduct(null); setSearch(""); }}>
                <X className="h-3.5 w-3.5 ml-1" /> تغيير
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="ابحث باسم المنتج (حرفين على الأقل)" className="pr-9" />
              </div>
              {search.trim().length >= 2 && (
                <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
                  {isFetching ? (
                    <div className="px-2.5 py-2 text-sm text-muted-foreground">جاري البحث...</div>
                  ) : matches.length === 0 ? (
                    <div className="px-2.5 py-2 text-sm text-muted-foreground">لا توجد نتائج</div>
                  ) : matches.map((p) => (
                    <button key={p.id} type="button"
                      className="w-full text-right px-2.5 py-1.5 text-sm hover:bg-muted"
                      onClick={() => setProduct(p)}>
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" className="text-xs text-primary hover:underline"
                onClick={() => { setUnlisted(true); setProduct(null); }}>
                منتج غير موجود بالقائمة
              </button>
            </>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">البادجيت اليومي *</Label>
            <Input type="number" min="0" step="0.01" dir="ltr" value={dailyBudget}
              onChange={(e) => setDailyBudget(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">عدد الأيام *</Label>
            <Input type="number" min="1" dir="ltr" value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">عدد الأماكن *</Label>
            <Input type="number" min="1" dir="ltr" value={maxMarketers}
              onChange={(e) => setMaxMarketers(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1">
          <Label>ملاحظات</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="تفاصيل إضافية عن المنتج (اختياري)" />
        </div>
      </div>

      <DialogFooter>
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending && <Loader2 className="h-4 w-4 ml-1 animate-spin" />}
          حفظ
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

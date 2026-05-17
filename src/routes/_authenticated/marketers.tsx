import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Eye, Loader2 } from "lucide-react";
import { MARKETER_STATUS } from "@/lib/constants";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/marketers")({
  component: MarketersPage,
});

const empty = {
  marketer_code: "", name: "", phone: "", whatsapp: "", email: "",
  facebook_profile: "", tiktok_profile: "", status: "active" as const, notes: "",
};

function MarketersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<typeof empty>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: marketers = [], isLoading } = useQuery({
    queryKey: ["marketers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketers")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    if (!search) return marketers;
    const s = search.toLowerCase();
    return marketers.filter((m) =>
      [m.name, m.marketer_code, m.phone, m.email].some((v) => v?.toLowerCase().includes(s))
    );
  }, [marketers, search]);

  async function save() {
    if (!form.marketer_code || !form.name) {
      toast.error("الكود والاسم مطلوبان");
      return;
    }
    setBusy(true);
    const payload = { ...form, email: form.email || null };
    const { error } = editing
      ? await supabase.from("marketers").update(payload).eq("id", editing)
      : await supabase.from("marketers").insert(payload);
    setBusy(false);
    if (error) {
      toast.error("فشل الحفظ", { description: error.message });
      return;
    }
    toast.success(editing ? "تم التحديث" : "تم إضافة المسوّق");
    setOpen(false);
    setEditing(null);
    setForm(empty);
    qc.invalidateQueries({ queryKey: ["marketers"] });
  }

  function startEdit(m: any) {
    setEditing(m.id);
    setForm({
      marketer_code: m.marketer_code,
      name: m.name,
      phone: m.phone ?? "",
      whatsapp: m.whatsapp ?? "",
      email: m.email ?? "",
      facebook_profile: m.facebook_profile ?? "",
      tiktok_profile: m.tiktok_profile ?? "",
      status: m.status,
      notes: m.notes ?? "",
    });
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-display font-bold">المسوّقون</h2>
          <p className="text-sm text-muted-foreground">إدارة قائمة المسوّقين بالعمولة</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(empty); } }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 ml-1" /> إضافة مسوّق</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? "تعديل مسوّق" : "إضافة مسوّق جديد"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>كود المسوّق *</Label>
                <Input value={form.marketer_code} onChange={(e) => setForm({ ...form, marketer_code: e.target.value })} /></div>
              <div className="space-y-1"><Label>الاسم *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-1"><Label>الهاتف</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" /></div>
              <div className="space-y-1"><Label>واتساب</Label>
                <Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} dir="ltr" /></div>
              <div className="space-y-1 col-span-2"><Label>البريد الإلكتروني</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" /></div>
              <div className="space-y-1"><Label>فيسبوك</Label>
                <Input value={form.facebook_profile} onChange={(e) => setForm({ ...form, facebook_profile: e.target.value })} dir="ltr" /></div>
              <div className="space-y-1"><Label>تيك توك</Label>
                <Input value={form.tiktok_profile} onChange={(e) => setForm({ ...form, tiktok_profile: e.target.value })} dir="ltr" /></div>
              <div className="space-y-1 col-span-2"><Label>الحالة</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(MARKETER_STATUS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select></div>
              <div className="space-y-1 col-span-2"><Label>ملاحظات</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button onClick={save} disabled={busy}>
                {busy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-3">
        <div className="relative max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="ابحث بالاسم أو الكود..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="pr-9" />
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الكود</TableHead>
              <TableHead>الاسم</TableHead>
              <TableHead>الهاتف</TableHead>
              <TableHead>واتساب</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="text-left">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">
                <Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                لا يوجد مسوّقون</TableCell></TableRow>
            ) : filtered.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono">{m.marketer_code}</TableCell>
                <TableCell className="font-medium">{m.name}</TableCell>
                <TableCell dir="ltr">{m.phone ?? "—"}</TableCell>
                <TableCell dir="ltr">{m.whatsapp ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={m.status === "active" ? "default" : "secondary"}>
                    {MARKETER_STATUS[m.status as keyof typeof MARKETER_STATUS]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/marketers/$id" params={{ id: m.id }}><Eye className="h-4 w-4" /></Link>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(m)}>تعديل</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

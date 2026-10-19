import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS } from "@/lib/constants";
import {
  Loader2, CheckCircle2, XCircle, Users as UsersIcon, UserPlus, Pencil, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { invokeFn } from "@/lib/edge-functions";

export const Route = createFileRoute("/_authenticated/users/")({
  component: UsersPage,
  beforeLoad: () => {
    // role check happens client-side; backend RLS is the real gate
  },
});

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

type MarketerRow = {
  id: string;
  name: string;
  marketer_code: string;
  account_manager_id: string | null;
};

const STATUS_LABEL = {
  pending: { label: "بانتظار الموافقة", variant: "secondary" as const },
  approved: { label: "مفعّل", variant: "default" as const },
  rejected: { label: "مرفوض", variant: "destructive" as const },
};

type MarketerLinkChoice =
  | { mode: "skip" }
  | { mode: "existing"; marketerId: string; label: string }
  | { mode: "new"; name: string; marketerCode: string };

const SKIP_LINK: MarketerLinkChoice = { mode: "skip" };

/** Links (or creates) a marketers row to this user's auth id. Only ever
 * touches marketers with no login yet (user_id IS NULL), so it can never
 * steal another marketer's account. */
async function applyMarketerLink(userId: string, choice: MarketerLinkChoice): Promise<void> {
  if (choice.mode === "skip") return;
  if (choice.mode === "existing") {
    const { error } = await supabase
      .from("marketers")
      .update({ user_id: userId })
      .eq("id", choice.marketerId)
      .is("user_id", null);
    if (error) throw new Error("فشل ربط المسوّق: " + error.message);
    return;
  }
  const name = choice.name.trim();
  const marketerCode = choice.marketerCode.trim();
  if (!name || !marketerCode) throw new Error("اسم المسوّق وكوده مطلوبان");
  const { error } = await supabase.from("marketers").insert({
    name, marketer_code: marketerCode, user_id: userId, status: "active",
  });
  if (error) {
    if ((error as any).code === "23505") throw new Error("كود المسوّق مستخدم من قبل");
    throw new Error("فشل إنشاء المسوّق: " + error.message);
  }
}

function MarketerLinkField({
  value, onChange,
}: {
  value: MarketerLinkChoice;
  onChange: (v: MarketerLinkChoice) => void;
}) {
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");

  const { data: matches = [], isFetching } = useQuery({
    queryKey: ["marketer-link-search", search],
    enabled: search.trim().length >= 2,
    queryFn: async () => {
      const { data } = await supabase
        .from("marketers")
        .select("id, name, marketer_code")
        .is("user_id", null)
        .or(`name.ilike.%${search.trim()}%,marketer_code.ilike.%${search.trim()}%`)
        .limit(8);
      return (data ?? []) as { id: string; name: string; marketer_code: string }[];
    },
  });

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Label className="text-xs">ربط حساب الدخول بسجل مسوّق (اختياري لكن موصى به)</Label>
      <div className="flex gap-2 text-xs">
        <Button type="button" size="sm" variant={value.mode === "skip" ? "default" : "outline"}
          onClick={() => onChange(SKIP_LINK)}>بدون ربط</Button>
        <Button type="button" size="sm" variant={value.mode === "existing" ? "default" : "outline"}
          onClick={() => onChange({ mode: "existing", marketerId: "", label: "" })}>مسوّق موجود</Button>
        <Button type="button" size="sm" variant={value.mode === "new" ? "default" : "outline"}
          onClick={() => onChange({ mode: "new", name: newName, marketerCode: newCode })}>مسوّق جديد</Button>
      </div>

      {value.mode === "existing" && (
        <div className="space-y-1">
          <Input placeholder="ابحث بالاسم أو الكود..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="h-9" />
          {value.marketerId && (
            <div className="text-xs text-success">مختار: {value.label}</div>
          )}
          {search.trim().length >= 2 && (
            <div className="rounded-md border divide-y max-h-36 overflow-y-auto">
              {isFetching ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">جاري البحث...</div>
              ) : matches.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">لا يوجد مسوّقين غير مربوطين بهذا الاسم</div>
              ) : matches.map((m) => (
                <button key={m.id} type="button"
                  className="w-full text-right px-2 py-1.5 text-xs hover:bg-muted"
                  onClick={() => onChange({ mode: "existing", marketerId: m.id, label: `${m.name} (${m.marketer_code})` })}>
                  {m.name} <span className="text-muted-foreground font-mono">({m.marketer_code})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {value.mode === "new" && (
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="اسم المسوّق" value={newName}
            onChange={(e) => { setNewName(e.target.value); onChange({ mode: "new", name: e.target.value, marketerCode: newCode }); }}
            className="h-9" />
          <Input placeholder="كود المسوّق" dir="ltr" value={newCode}
            onChange={(e) => { setNewCode(e.target.value); onChange({ mode: "new", name: newName, marketerCode: e.target.value }); }}
            className="h-9" />
        </div>
      )}
    </div>
  );
}

function UsersPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const [approveUser, setApproveUser] = useState<ProfileRow | null>(null);
  const [pickedRole, setPickedRole] = useState<AppRole>("marketer");
  const [marketerLink, setMarketerLink] = useState<MarketerLinkChoice>(SKIP_LINK);
  const [busy, setBusy] = useState(false);
  const [assignFor, setAssignFor] = useState<ProfileRow | null>(null);
  const [editUser, setEditUser] = useState<ProfileRow | null>(null);
  const [deleteUser, setDeleteUser] = useState<ProfileRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function confirmDeleteUser() {
    if (!deleteUser) return;
    setDeleteBusy(true);
    try {
      await invokeFn("admin-manage-user", { action: "delete", user_id: deleteUser.id });
      toast.success("تم حذف المستخدم");
      setDeleteUser(null);
      qc.invalidateQueries({ queryKey: ["all-profiles"] });
      qc.invalidateQueries({ queryKey: ["all-user-roles"] });
      qc.invalidateQueries({ queryKey: ["marketers"] });
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "فشل حذف المستخدم");
    } finally {
      setDeleteBusy(false);
    }
  }

  if (role && role !== "admin") {
    throw redirect({ to: "/dashboard" });
  }

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, status, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
  });

  const { data: roles = [] } = useQuery({
    queryKey: ["all-user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role");
      if (error) throw error;
      return data ?? [];
    },
  });

  const rolesByUser = roles.reduce<Record<string, AppRole[]>>((acc, r: any) => {
    (acc[r.user_id] ??= []).push(r.role as AppRole);
    return acc;
  }, {});

  async function approve() {
    if (!approveUser) return;
    setBusy(true);
    try {
      if (pickedRole === "marketer") {
        await applyMarketerLink(approveUser.id, marketerLink);
      }
      // Remove existing roles for clean assignment
      await supabase.from("user_roles").delete().eq("user_id", approveUser.id);
      const { error: roleErr } = await supabase
        .from("user_roles")
        .insert({ user_id: approveUser.id, role: pickedRole });
      if (roleErr) throw roleErr;
      const { error: statusErr } = await supabase
        .from("profiles")
        .update({ status: "approved" })
        .eq("id", approveUser.id);
      if (statusErr) throw statusErr;
      toast.success("تمت الموافقة وتعيين الدور");
      setApproveUser(null);
      setMarketerLink(SKIP_LINK);
      qc.invalidateQueries({ queryKey: ["all-profiles"] });
      qc.invalidateQueries({ queryKey: ["all-user-roles"] });
      qc.invalidateQueries({ queryKey: ["marketers"] });
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "فشلت العملية");
    } finally {
      setBusy(false);
    }
  }

  async function reject(u: ProfileRow) {
    if (!confirm(`رفض المستخدم ${u.email}؟`)) return;
    const { error } = await supabase
      .from("profiles")
      .update({ status: "rejected" })
      .eq("id", u.id);
    if (error) { console.error(error); toast.error("فشل الرفض"); return; }
    await supabase.from("user_roles").delete().eq("user_id", u.id);
    toast.success("تم رفض الحساب");
    qc.invalidateQueries({ queryKey: ["all-profiles"] });
    qc.invalidateQueries({ queryKey: ["all-user-roles"] });
  }

  async function changeRole(userId: string, newRole: AppRole) {
    await supabase.from("user_roles").delete().eq("user_id", userId);
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole });
    if (error) { console.error(error); toast.error("فشل تغيير الدور"); return; }
    toast.success("تم تغيير الدور");
    qc.invalidateQueries({ queryKey: ["all-user-roles"] });
  }

  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-display font-bold">إدارة المستخدمين</h2>
          <p className="text-sm text-muted-foreground">إضافة مستخدمين، الموافقة على التسجيلات، تعيين الأدوار وإسناد المسوّقين</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="h-4 w-4 ml-1" /> إضافة مستخدم
        </Button>
      </div>

      <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} />


      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>البريد</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>الدور</TableHead>
              <TableHead className="text-left">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">
                <Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
            ) : users.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                لا يوجد مستخدمون</TableCell></TableRow>
            ) : users.map((u) => {
              const userRoles = rolesByUser[u.id] ?? [];
              const primaryRole: AppRole | undefined =
                userRoles.includes("admin") ? "admin"
                : userRoles.includes("account_manager") ? "account_manager"
                : userRoles.includes("marketer") ? "marketer"
                : undefined;
              return (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.full_name ?? "—"}</TableCell>
                  <TableCell dir="ltr" className="text-sm">{u.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_LABEL[u.status].variant}>
                      {STATUS_LABEL[u.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {u.status === "approved" && primaryRole ? (
                      <Select value={primaryRole} onValueChange={(v) => changeRole(u.id, v as AppRole)}>
                        <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(ROLE_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {u.status !== "approved" && (
                        <Button size="sm" variant="default" onClick={() => { setApproveUser(u); setPickedRole("marketer"); }}>
                          <CheckCircle2 className="h-4 w-4 ml-1" /> موافقة
                        </Button>
                      )}
                      {u.status !== "rejected" && (
                        <Button size="sm" variant="ghost" onClick={() => reject(u)}>
                          <XCircle className="h-4 w-4 ml-1" /> رفض
                        </Button>
                      )}
                      {u.status === "approved" && primaryRole === "account_manager" && (
                        <Button size="sm" variant="outline" onClick={() => setAssignFor(u)}>
                          <UsersIcon className="h-4 w-4 ml-1" /> المسوّقون
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setEditUser(u)}>
                        <Pencil className="h-4 w-4 ml-1" /> تعديل
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteUser(u)}>
                        <Trash2 className="h-4 w-4 ml-1" /> حذف
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!approveUser} onOpenChange={(o) => { if (!o) { setApproveUser(null); setMarketerLink(SKIP_LINK); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>الموافقة على الحساب</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {approveUser?.full_name} — <span dir="ltr">{approveUser?.email}</span>
            </p>
            <div className="space-y-1">
              <Label>اختر الدور</Label>
              <Select value={pickedRole} onValueChange={(v) => { setPickedRole(v as AppRole); setMarketerLink(SKIP_LINK); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {pickedRole === "marketer" && (
              <MarketerLinkField value={marketerLink} onChange={setMarketerLink} />
            )}
          </div>
          <DialogFooter>
            <Button onClick={approve} disabled={busy}>
              {busy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              تأكيد الموافقة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AssignMarketersDialog user={assignFor} onClose={() => setAssignFor(null)} />

      <EditUserDialog user={editUser} onClose={() => setEditUser(null)} onSaved={() => {
        qc.invalidateQueries({ queryKey: ["all-profiles"] });
      }} />

      <AlertDialog open={!!deleteUser} onOpenChange={(o) => !o && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المستخدم؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف حساب {deleteUser?.full_name} ({deleteUser?.email}) نهائيًا — الحساب لن يقدر يدخل النظام تاني.
              لو كان مربوط بسجل مسوّق، السجل نفسه (والطلبات والبونص المرتبطة به) هيفضل موجود، بس هيبقى من غير حساب دخول.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBusy}
              onClick={(e) => { e.preventDefault(); confirmDeleteUser(); }}
            >
              {deleteBusy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              حذف نهائي
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditUserDialog({
  user, onClose, onSaved,
}: {
  user: ProfileRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setFullName(user.full_name ?? "");
      setEmail(user.email ?? "");
      setPassword("");
    }
  }, [user]);

  async function save() {
    if (!user) return;
    if (!fullName.trim() || !email.trim()) {
      toast.error("الاسم والبريد مطلوبان");
      return;
    }
    if (password && password.length < 8) {
      toast.error("كلمة السر الجديدة لازم تكون 8 أحرف على الأقل");
      return;
    }
    setBusy(true);
    try {
      await invokeFn("admin-manage-user", {
        action: "update",
        user_id: user.id,
        full_name: fullName.trim(),
        email: email.trim(),
        ...(password ? { password } : {}),
      });
      toast.success("تم تحديث بيانات المستخدم");
      onSaved();
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "فشل تحديث المستخدم");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>تعديل بيانات المستخدم</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>الاسم الكامل</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>البريد الإلكتروني</Label>
            <Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>كلمة سر جديدة (اختياري — سيبها فاضية لو مش عايز تغيّرها)</Label>
            <Input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignMarketersDialog({ user, onClose }: { user: ProfileRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: marketers = [] } = useQuery({
    queryKey: ["marketers-for-assign"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketers")
        .select("id, name, marketer_code, account_manager_id")
        .order("name");
      if (error) throw error;
      return (data ?? []) as MarketerRow[];
    },
    enabled: !!user,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user) {
      setSelected(new Set(marketers.filter((m) => m.account_manager_id === user.id).map((m) => m.id)));
    } else {
      setSelected(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, marketers]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  async function save() {
    if (!user) return;
    setBusy(true);
    try {
      // Unassign ones removed
      const toUnassign = marketers
        .filter((m) => m.account_manager_id === user.id && !selected.has(m.id))
        .map((m) => m.id);
      const toAssign = Array.from(selected).filter(
        (id) => !marketers.find((m) => m.id === id && m.account_manager_id === user.id),
      );
      if (toUnassign.length) {
        const { error } = await supabase
          .from("marketers")
          .update({ account_manager_id: null })
          .in("id", toUnassign);
        if (error) throw error;
      }
      if (toAssign.length) {
        const { error } = await supabase
          .from("marketers")
          .update({ account_manager_id: user.id })
          .in("id", toAssign);
        if (error) throw error;
      }
      toast.success("تم تحديث الإسناد");
      qc.invalidateQueries({ queryKey: ["marketers-for-assign"] });
      qc.invalidateQueries({ queryKey: ["marketers"] });
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("فشل التحديث");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>إسناد مسوّقين إلى {user?.full_name}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[400px] overflow-y-auto space-y-2 border rounded-md p-3">
          {marketers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">لا يوجد مسوّقون</p>
          ) : marketers.map((m) => (
            <label key={m.id} className="flex items-center gap-3 cursor-pointer hover:bg-muted/50 p-2 rounded">
              <Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggle(m.id)} />
              <div className="flex-1">
                <div className="text-sm font-medium">{m.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{m.marketer_code}</div>
              </div>
              {m.account_manager_id && m.account_manager_id !== user?.id && (
                <Badge variant="secondary" className="text-xs">مسند لآخر</Badge>
              )}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("marketer");
  const [marketerLink, setMarketerLink] = useState<MarketerLinkChoice>(SKIP_LINK);
  const [busy, setBusy] = useState(false);

  function reset() {
    setFullName(""); setEmail(""); setPassword(""); setRole("marketer"); setMarketerLink(SKIP_LINK);
  }

  async function submit() {
    if (!fullName || !email || password.length < 8) {
      toast.error("املأ جميع الحقول (كلمة السر 8 أحرف على الأقل)");
      return;
    }
    setBusy(true);
    try {
      const { id } = await invokeFn<{ id: string }>("admin-create-user", { full_name: fullName, email, password, role });
      if (role === "marketer") {
        try {
          await applyMarketerLink(id, marketerLink);
        } catch (linkErr: any) {
          console.error(linkErr);
          toast.warning("تم إنشاء المستخدم، لكن فشل ربطه بالمسوّق", { description: linkErr?.message });
          qc.invalidateQueries({ queryKey: ["all-profiles"] });
          qc.invalidateQueries({ queryKey: ["all-user-roles"] });
          reset();
          onClose();
          return;
        }
      }
      toast.success("تم إنشاء المستخدم");
      qc.invalidateQueries({ queryKey: ["all-profiles"] });
      qc.invalidateQueries({ queryKey: ["all-user-roles"] });
      qc.invalidateQueries({ queryKey: ["marketers"] });
      reset();
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "فشل إنشاء المستخدم");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>إضافة مستخدم جديد</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>الاسم الكامل</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>البريد الإلكتروني</Label>
            <Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>كلمة السر (8 أحرف على الأقل)</Label>
            <Input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>الدور</Label>
            <Select value={role} onValueChange={(v) => { setRole(v as AppRole); setMarketerLink(SKIP_LINK); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ROLE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {role === "marketer" && (
            <MarketerLinkField value={marketerLink} onChange={setMarketerLink} />
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
            إنشاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

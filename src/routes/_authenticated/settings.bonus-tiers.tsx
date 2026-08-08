import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { fmtCurrency, fmtPercent } from "@/lib/format";
import { TierChip } from "@/components/bonus/BonusBadges";
import { Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";

type BonusTier = {
  id: string;
  tier_code: string;
  tier_name_ar: string;
  tier_name_en: string | null;
  tier_order: number;
  min_shipped_orders: number;
  base_salary: number;
  bonus_percentage: number;
  minimum_delivery_rate: number;
  extra_delivered_order_amount: number;
  color_hex: string | null;
  is_active: boolean;
};

export const Route = createFileRoute("/_authenticated/settings/bonus-tiers")({
  head: () => ({ meta: [{ title: "إعدادات باقات البونص" }] }),
  component: BonusTiersSettings,
});

function BonusTiersSettings() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BonusTier | null>(null);
  const isAdmin = role === "admin";

  const { data: tiers = [], isLoading } = useQuery({
    queryKey: ["bonus-tiers-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bonus_tiers").select("*").order("tier_order");
      if (error) throw error;
      return data as BonusTier[];
    },
  });

  if (!isAdmin) {
    return (
      <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
        هذه الصفحة متاحة للأدمن فقط.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h2 className="text-2xl font-display font-bold">إعدادات باقات البونص</h2>
        <p className="text-sm text-muted-foreground">
          الرواتب والنسب وقيمة المكافأة لكل باقة — تُستخدم مباشرة في حساب مستحقات المسوّقين الشهرية.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tiers.map((t) => (
            <Card key={t.id}>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div className="flex items-center gap-2">
                  <TierChip name={t.tier_name_ar} colorHex={t.color_hex} />
                  {!t.is_active && (
                    <span className="text-xs text-muted-foreground border rounded px-1.5 py-0.5">غير مفعّلة</span>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <Field label="الحد الأدنى للطلبات" value={String(t.min_shipped_orders)} />
                <Field label="الراتب الأساسي" value={fmtCurrency(t.base_salary)} />
                <Field label="نسبة البونص من الربح" value={fmtPercent(t.bonus_percentage)} />
                <Field label="نسبة التسليم المطلوبة" value={fmtPercent(t.minimum_delivery_rate)} />
                <Field label="مكافأة كل طلب إضافي" value={fmtCurrency(t.extra_delivered_order_amount)} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <EditTierDialog
          tier={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["bonus-tiers-settings"] });
            qc.invalidateQueries({ queryKey: ["bonus-tiers"] });
          }}
        />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium mt-0.5">{value}</div>
    </div>
  );
}

function EditTierDialog({
  tier, onClose, onSaved,
}: { tier: BonusTier; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    tier_name_ar: tier.tier_name_ar,
    tier_name_en: tier.tier_name_en ?? "",
    min_shipped_orders: String(tier.min_shipped_orders),
    base_salary: String(tier.base_salary),
    bonus_percentage: String(Math.round(tier.bonus_percentage * 100)),
    minimum_delivery_rate: String(Math.round(tier.minimum_delivery_rate * 100)),
    extra_delivered_order_amount: String(tier.extra_delivered_order_amount),
    color_hex: tier.color_hex ?? "#94A3B8",
    is_active: tier.is_active,
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("bonus_tiers").update({
        tier_name_ar: form.tier_name_ar,
        tier_name_en: form.tier_name_en || null,
        min_shipped_orders: Number(form.min_shipped_orders),
        base_salary: Number(form.base_salary),
        bonus_percentage: Number(form.bonus_percentage) / 100,
        minimum_delivery_rate: Number(form.minimum_delivery_rate) / 100,
        extra_delivered_order_amount: Number(form.extra_delivered_order_amount),
        color_hex: form.color_hex,
        is_active: form.is_active,
      }).eq("id", tier.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حفظ إعدادات الباقة");
      onSaved();
    },
    onError: (error: unknown) => {
      const e = error as { message?: string } | null;
      toast.error("فشل الحفظ", { description: e?.message ?? String(error) });
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>تعديل باقة: {tier.tier_name_ar}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5 col-span-2 sm:col-span-1">
            <Label>الاسم بالعربي</Label>
            <Input value={form.tier_name_ar} onChange={(e) => setForm((f) => ({ ...f, tier_name_ar: e.target.value }))} />
          </div>
          <div className="space-y-1.5 col-span-2 sm:col-span-1">
            <Label>الاسم بالإنجليزي</Label>
            <Input value={form.tier_name_en} onChange={(e) => setForm((f) => ({ ...f, tier_name_en: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>الحد الأدنى لعدد الطلبات</Label>
            <Input type="number" min={0} value={form.min_shipped_orders}
              onChange={(e) => setForm((f) => ({ ...f, min_shipped_orders: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>الراتب الأساسي</Label>
            <Input type="number" min={0} step="0.01" value={form.base_salary}
              onChange={(e) => setForm((f) => ({ ...f, base_salary: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>نسبة البونص من الربح (%)</Label>
            <Input type="number" min={0} max={100} step="0.1" value={form.bonus_percentage}
              onChange={(e) => setForm((f) => ({ ...f, bonus_percentage: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>نسبة التسليم المطلوبة (%)</Label>
            <Input type="number" min={0} max={100} step="0.1" value={form.minimum_delivery_rate}
              onChange={(e) => setForm((f) => ({ ...f, minimum_delivery_rate: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>مكافأة كل طلب إضافي</Label>
            <Input type="number" min={0} step="0.01" value={form.extra_delivered_order_amount}
              onChange={(e) => setForm((f) => ({ ...f, extra_delivered_order_amount: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>اللون</Label>
            <Input type="color" value={form.color_hex} className="h-10 p-1"
              onChange={(e) => setForm((f) => ({ ...f, color_hex: e.target.value }))} />
          </div>
          <div className="col-span-2 flex items-center gap-2 pt-1">
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
            <Label>الباقة مفعّلة</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 ml-1 animate-spin" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

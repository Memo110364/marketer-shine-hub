import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/mappings")({
  component: MappingsSettings,
});

function MappingsSettings() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["mappings"],
    queryFn: async () => (await supabase.from("column_mappings").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  async function remove(id: string) {
    if (!confirm("حذف هذا القالب؟")) return;
    const { error } = await supabase.from("column_mappings").delete().eq("id", id);
    if (error) { console.error("Delete mapping error:", error); toast.error("فشل الحذف"); }
    else { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["mappings"] }); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-display font-bold">إعدادات الاستيراد</h2>
        <p className="text-sm text-muted-foreground">قوالب ربط أعمدة Excel المحفوظة</p>
      </div>

      {data.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          لا توجد قوالب. احفظ قالبًا من صفحة الاستيراد.
        </CardContent></Card>
      ) : data.map((m: any) => (
        <Card key={m.id}>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {m.name}
                {m.is_default && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
                    افتراضي
                  </span>
                )}
              </CardTitle>
              <div className="text-xs text-muted-foreground">{fmtDate(m.created_at)}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => remove(m.id)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
              {Object.entries(m.mapping as Record<string, string>).map(([k, v]) => (
                <div key={k} className="flex justify-between border rounded px-2 py-1 bg-muted/30">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-mono text-xs">{v}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

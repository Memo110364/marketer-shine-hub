import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Megaphone, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ad-accounts")({
  component: AdAccountsPage,
});

function AdAccountsPage() {
  const { data: accounts = [] } = useQuery({
    queryKey: ["ad-accounts"],
    queryFn: async () => (await supabase.from("ad_accounts").select("*, marketers(name)")).data ?? [],
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-display font-bold">حسابات الإعلانات</h2>
        <p className="text-sm text-muted-foreground">Meta Ads و TikTok Ads</p>
      </div>

      <Card className="border-info/40 bg-info/5">
        <CardContent className="p-4 flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-info mt-0.5" />
          <div>
            <div className="font-medium">قريباً — التكامل التلقائي</div>
            <div className="text-sm text-muted-foreground">
              التكامل المباشر مع Meta Ads و TikTok Ads قيد التحضير. حالياً يمكنك تسجيل الحسابات يدوياً.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2">
          <Megaphone className="h-4 w-4" /> الحسابات المسجّلة</CardTitle></CardHeader>
        <Table>
          <TableHeader><TableRow>
            <TableHead>المسوّق</TableHead><TableHead>المنصة</TableHead>
            <TableHead>معرّف الحساب</TableHead><TableHead>الاسم</TableHead>
            <TableHead>حالة الوصول</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">لا توجد حسابات</TableCell></TableRow>
            ) : accounts.map((a: any) => (
              <TableRow key={a.id}>
                <TableCell>{a.marketers?.name ?? "—"}</TableCell>
                <TableCell><Badge variant="outline">{a.platform}</Badge></TableCell>
                <TableCell dir="ltr">{a.ad_account_id ?? "—"}</TableCell>
                <TableCell>{a.account_name ?? "—"}</TableCell>
                <TableCell><Badge variant="secondary">{a.access_status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

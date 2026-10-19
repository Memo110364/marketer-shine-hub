import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useOwnMarketer } from "@/lib/use-own-marketer";
import { Card, CardContent } from "@/components/ui/card";
import { MarketerTestOffersBoard } from "@/components/MarketerTestOffersBoard";
import { TestSpendSection } from "@/components/TestSpendSection";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/my-test-offers")({
  component: MyTestOffersPage,
});

function MyTestOffersPage() {
  const { role } = useAuth();
  if (role && role !== "marketer") {
    throw redirect({ to: "/dashboard" });
  }

  const { data: marketer, isLoading } = useOwnMarketer();

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (!marketer) {
    return (
      <Card>
        <CardContent className="p-10 text-center space-y-2">
          <p className="font-medium">حسابك لسه مش مربوط بسجل مسوّق</p>
          <p className="text-sm text-muted-foreground">تواصل مع مدير الحساب أو الأدمن عشان يربطوا حسابك.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h2 className="text-2xl font-display font-bold">منتجات متاحة للتيست</h2>
        <p className="text-sm text-muted-foreground mt-1">قبول تيست منتج هنا استرشادي فقط ولا يؤثر على أرقام حسابك</p>
      </div>
      <MarketerTestOffersBoard marketerId={marketer.id} />

      <div>
        <h3 className="text-lg font-display font-bold mb-3">سجل اختباراتي</h3>
        <TestSpendSection marketerId={marketer.id} />
      </div>
    </div>
  );
}

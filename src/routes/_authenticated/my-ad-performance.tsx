import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useOwnMarketer } from "@/lib/use-own-marketer";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/my-ad-performance")({
  component: MyAdPerformanceRedirect,
});

function MyAdPerformanceRedirect() {
  const { role } = useAuth();
  if (role && role !== "marketer") {
    throw redirect({ to: "/dashboard" });
  }

  const navigate = useNavigate();
  const { data: marketer, isLoading } = useOwnMarketer();

  useEffect(() => {
    if (marketer) {
      navigate({ to: "/marketers/$id/ad-performance", params: { id: marketer.id }, replace: true });
    }
  }, [marketer, navigate]);

  if (isLoading || marketer) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <Card>
      <CardContent className="p-10 text-center space-y-2">
        <p className="font-medium">حسابك لسه مش مربوط بسجل مسوّق</p>
        <p className="text-sm text-muted-foreground">تواصل مع مدير الحساب أو الأدمن عشان يربطوا حسابك.</p>
      </CardContent>
    </Card>
  );
}

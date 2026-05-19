import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Clock, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const { session, loading, status, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [session, loading, navigate]);

  if (loading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (status === "pending" || status === "rejected") {
    const pending = status === "pending";
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-accent/30 to-background">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center space-y-3">
            <div className="mx-auto p-3 rounded-2xl w-fit bg-primary/10">
              {pending ? <Clock className="h-8 w-8 text-primary" /> : <XCircle className="h-8 w-8 text-destructive" />}
            </div>
            <CardTitle className="font-display text-xl">
              {pending ? "حسابك بانتظار الموافقة" : "تم رفض طلب التسجيل"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              {pending
                ? "يجب على أحد المديرين تفعيل حسابك قبل أن تتمكن من استخدام المنصة. يرجى التواصل مع إدارة النظام."
                : "إذا كنت تعتقد أن هذا خطأ، تواصل مع إدارة النظام."}
            </p>
            <Button variant="outline" onClick={signOut} className="w-full">تسجيل خروج</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center border-b bg-card/50 backdrop-blur sticky top-0 z-10">
            <SidebarTrigger className="mx-3" />
            <h1 className="font-display font-semibold text-base">منصة أداء المسوّقين</h1>
          </header>
          <main className="flex-1 p-4 md:p-6 overflow-x-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

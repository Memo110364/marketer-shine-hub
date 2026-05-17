import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/lib/auth-context";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const { session, loading } = useAuth();
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

import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, ShoppingBag, Upload, Wallet, Package,
  Truck, Settings, Megaphone, LogOut, BarChart3, RefreshCw, UserCog, Trophy,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useAuth, type AppRole } from "@/lib/auth-context";
import { ROLE_LABELS } from "@/lib/constants";
import { Button } from "@/components/ui/button";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: AppRole[];
};

const NAV: NavItem[] = [
  { to: "/dashboard", label: "لوحة التحكم", icon: LayoutDashboard, roles: ["admin", "account_manager", "marketer"] },
  { to: "/marketers", label: "المسوّقون", icon: Users, roles: ["admin", "account_manager"] },
  { to: "/orders", label: "الطلبات", icon: ShoppingBag, roles: ["admin", "account_manager", "marketer"] },
  { to: "/orders/import", label: "استيراد الطلبات", icon: Upload, roles: ["admin", "account_manager"] },
  { to: "/orders/update-status", label: "تحديث حالات الطلبات", icon: RefreshCw, roles: ["admin", "account_manager"] },
  { to: "/ad-spend", label: "الإنفاق الإعلاني", icon: Wallet, roles: ["admin", "account_manager", "marketer"] },
  { to: "/products", label: "أداء المنتجات", icon: Package, roles: ["admin", "account_manager"] },
  { to: "/shipping", label: "شركات الشحن", icon: Truck, roles: ["admin", "account_manager"] },
  { to: "/ad-accounts", label: "حسابات الإعلانات", icon: Megaphone, roles: ["admin", "account_manager"] },
  { to: "/settings/mappings", label: "إعدادات الاستيراد", icon: Settings, roles: ["admin", "account_manager"] },
  { to: "/settings/bonus-tiers", label: "إعدادات باقات البونص", icon: Trophy, roles: ["admin"] },
  { to: "/users", label: "إدارة المستخدمين", icon: UserCog, roles: ["admin"] },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { user, role, signOut } = useAuth();

  const visible = NAV.filter((i) => role && i.roles.includes(role));

  return (
    <Sidebar collapsible="icon" side="right">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="bg-primary/10 p-2 rounded-lg">
            <BarChart3 className="h-5 w-5 text-primary" />
          </div>
          {!collapsed && (
            <div>
              <div className="font-display font-bold text-sm">منصة المسوّقين</div>
              <div className="text-xs text-muted-foreground">إدارة الأداء</div>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>القائمة الرئيسية</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visible.map((item) => {
                const active = path === item.to || (item.to !== "/dashboard" && path.startsWith(item.to));
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link to={item.to} className="flex items-center gap-3">
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.label}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t">
        {!collapsed && user && (
          <div className="px-2 py-2">
            <div className="text-sm font-medium truncate">{user.email}</div>
            <div className="text-xs text-muted-foreground">{role ? ROLE_LABELS[role] : "بانتظار التعيين"}</div>
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={signOut} className="justify-start gap-2">
          <LogOut className="h-4 w-4" />
          {!collapsed && "تسجيل خروج"}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  tone?: "default" | "success" | "warning" | "destructive" | "info";
  hint?: string;
}

const toneClass = {
  default: "bg-primary/10 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning-foreground",
  destructive: "bg-destructive/15 text-destructive",
  info: "bg-info/15 text-info",
};

export function KpiCard({ label, value, icon: Icon, tone = "default", hint }: KpiCardProps) {
  return (
    <Card className="transition-all hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(16,24,40,0.05),0_16px_32px_-16px_rgba(16,24,40,0.12)]">
      <CardContent className="p-5 flex items-center gap-4">
        {Icon && (
          <div className={cn("p-3 rounded-2xl", toneClass[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-muted-foreground tracking-wide">{label}</div>
          <div className="text-2xl font-display font-bold mt-1 truncate text-foreground">{value}</div>
          {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

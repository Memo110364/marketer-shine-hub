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
    <Card className="shadow-sm">
      <CardContent className="p-4 flex items-center gap-4">
        {Icon && (
          <div className={cn("p-3 rounded-xl", toneClass[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-display font-bold mt-1 truncate">{value}</div>
          {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

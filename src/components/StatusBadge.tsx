import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS, type OrderStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

const colorClass: Record<string, string> = {
  info: "bg-info/15 text-info-foreground border-info/30 [&]:text-info",
  warning: "bg-warning/15 border-warning/30 [&]:text-warning-foreground",
  success: "bg-success/15 border-success/30 [&]:text-success",
  destructive: "bg-destructive/15 border-destructive/30 [&]:text-destructive",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const info = ORDER_STATUS[status];
  if (!info) return <Badge variant="outline">{status}</Badge>;
  return (
    <Badge variant="outline" className={cn("font-medium", colorClass[info.color])}>
      {info.label}
    </Badge>
  );
}

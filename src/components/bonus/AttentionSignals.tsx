import { attentionFlags } from "@/lib/bonus-insights";
import type { Tier } from "@/components/bonus/TierProgress";
import { AlertTriangle, TrendingDown, ArrowDownRight, Target, Wallet } from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

const ICONS: Record<string, any> = {
  profit: AlertTriangle,
  delivery: TrendingDown,
  downgrade: ArrowDownRight,
  "near-tier": Target,
  remaining: Wallet,
};

const TONE: Record<string, string> = {
  danger: "text-destructive border-destructive/30 bg-destructive/10",
  warning: "text-warning-foreground border-warning/30 bg-warning/10",
  info: "text-info border-info/30 bg-info/10",
};

/** Compact attention signals shown beside marketer rows in admin lists. */
export function AttentionSignals({
  row,
  tiers = [],
  onOpen,
}: {
  row: any;
  tiers?: Tier[];
  onOpen?: () => void;
}) {
  const flags = attentionFlags(row, tiers);
  if (flags.length === 0) return null;
  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-1">
        {flags.map((f) => {
          const Icon = ICONS[f.id] ?? AlertTriangle;
          return (
            <Tooltip key={f.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onOpen}
                  aria-label={f.label}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${TONE[f.tone]}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{f.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

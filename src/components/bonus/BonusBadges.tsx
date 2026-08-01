import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  PAYMENT_LABELS, PAYMENT_TONE, WORKFLOW_LABELS, WORKFLOW_TONE,
} from "@/lib/bonus";

export function WorkflowBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? "draft";
  return (
    <Badge variant="outline" className={cn("font-medium", WORKFLOW_TONE[s])}>
      {WORKFLOW_LABELS[s] ?? s}
    </Badge>
  );
}

export function PaymentBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? "unpaid";
  return (
    <Badge variant="outline" className={cn("font-medium", PAYMENT_TONE[s])}>
      {PAYMENT_LABELS[s] ?? s}
    </Badge>
  );
}

export function TierChip({
  name, colorHex,
}: { name: string | null | undefined; colorHex?: string | null }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  if (colorHex) {
    return (
      <span
        className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium"
        style={{
          color: colorHex,
          borderColor: colorHex,
          backgroundColor: `${colorHex}1A`,
        }}
      >
        {name}
      </span>
    );
  }
  return <Badge variant="outline" className="font-medium">{name}</Badge>;
}

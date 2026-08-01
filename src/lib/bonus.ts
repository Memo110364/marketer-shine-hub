// Shared helpers for the Monthly Marketer Bonus System (read-only display layer).
// All financial values come from the saved snapshot in monthly_marketer_bonuses.
// No formulas are recomputed on the frontend.

export const WORKFLOW_STATUSES = [
  "draft",
  "calculated",
  "under_review",
  "adjustment_proposed",
  "approved",
  "locked",
] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const PAYMENT_STATUSES = ["unpaid", "partially_paid", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const WORKFLOW_LABELS: Record<string, string> = {
  draft: "مسودة",
  calculated: "تم الاحتساب",
  under_review: "قيد المراجعة",
  adjustment_proposed: "تسوية مقترحة",
  approved: "معتمد",
  locked: "مقفول",
};

export const PAYMENT_LABELS: Record<string, string> = {
  unpaid: "لم يتم الدفع",
  partially_paid: "مدفوع جزئيًا",
  paid: "مدفوع بالكامل",
};

export const WORKFLOW_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  calculated: "bg-info/15 text-info border-info/30",
  under_review: "bg-warning/15 text-warning-foreground border-warning/30",
  adjustment_proposed: "bg-warning/15 text-warning-foreground border-warning/30",
  approved: "bg-success/15 text-success border-success/30",
  locked: "bg-primary/10 text-primary border-primary/30",
};

export const PAYMENT_TONE: Record<string, string> = {
  unpaid: "bg-destructive/15 text-destructive border-destructive/30",
  partially_paid: "bg-warning/15 text-warning-foreground border-warning/30",
  paid: "bg-success/15 text-success border-success/30",
};

/** Workflow states that still need a human review/approval step. */
export const REVIEW_STATES: WorkflowStatus[] = [
  "calculated",
  "under_review",
  "adjustment_proposed",
];

export const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

/** Most recently completed calendar month. */
export function lastCompletedMonth(now = new Date()): { year: number; month: number } {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based = previous month in 1-based terms
  if (m === 0) return { year: y - 1, month: 12 };
  return { year: y, month: m };
}

export function monthLabel(year: number, month: number) {
  return `${MONTHS_AR[month - 1] ?? month} ${year}`;
}

/** Sort key for "needs attention" ordering on the admin dashboard. */
export function attentionRank(row: {
  workflow_status: string;
  payment_status: string;
  remaining_amount: number | string | null;
}): number {
  const remaining = Number(row.remaining_amount ?? 0);
  if (row.workflow_status === "adjustment_proposed") return 1;
  if (row.workflow_status === "under_review") return 2;
  if (row.workflow_status === "calculated") return 3;
  if ((row.workflow_status === "approved" || row.workflow_status === "locked") && remaining > 0) return 4;
  if (row.payment_status === "partially_paid") return 5;
  if (row.payment_status === "unpaid") return 6;
  return 7;
}

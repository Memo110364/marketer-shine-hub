// Presentation-only insight helpers for the Monthly Bonus system (Phase 3E).
// Nothing here changes salary, bonus, tier, approval or payment values.
// All inputs are the SAVED snapshot values from monthly_marketer_bonuses
// plus the tier configuration from bonus_tiers.

import type { Tier } from "@/components/bonus/TierProgress";

const num = (v: unknown) => Number(v ?? 0);

/* -------------------------------------------------------------------------
 * Performance score (0 - 100) — non-financial, display only.
 *   Delivery quality ....... 50 points
 *     actual rate / required rate, capped at 50 (50 when requirement is met)
 *   Profitability .......... 30 points
 *     0 when net profit before bonus <= 0, otherwise 30
 *   Tier achievement ....... 20 points
 *     below training 5 / training 10 / basic 14 / diamond 17 / gold 20
 * ------------------------------------------------------------------------- */
const TIER_POINTS: Record<string, number> = {
  training: 10,
  basic: 14,
  diamond: 17,
  gold: 20,
};

export type ScoreBreakdown = {
  total: number;
  delivery: number;
  profitability: number;
  tier: number;
  stars: number;
  label: string;
};

export function performanceScore(bonus: any, earnedTier?: Tier & { tier_code?: string }): ScoreBreakdown {
  const actual = num(bonus?.delivery_rate);
  const required = num(bonus?.required_delivery_rate);
  let delivery = required > 0 ? (actual / required) * 50 : actual > 0 ? 50 : 0;
  delivery = Math.max(0, Math.min(50, delivery));

  const profitability = num(bonus?.net_profit_before_bonus) > 0 ? 30 : 0;

  const code = (earnedTier as any)?.tier_code as string | undefined;
  const tier = code && TIER_POINTS[code] != null ? TIER_POINTS[code] : 5;

  const total = Math.max(0, Math.min(100, Math.round(delivery + profitability + tier)));
  const stars = Math.max(1, Math.min(5, Math.ceil(total / 20) || 1));
  const label =
    total >= 85 ? "ممتاز" : total >= 70 ? "جيد جدًا" : total >= 55 ? "جيد" : total >= 35 ? "يحتاج تحسين" : "ضعيف";

  return { total, delivery: Math.round(delivery), profitability, tier, stars, label };
}

/* -------------------------------------------------------------------------
 * Deterministic, rule-based recommendations (no AI, no external calls).
 * Priority order:
 *   1 profitability warning, 2 delivery-rate risk, 3 near-tier opportunity,
 *   4 extra-order opportunity, 5 positive achievement.
 * ------------------------------------------------------------------------- */
export type Recommendation = {
  id: string;
  tone: "danger" | "warning" | "info" | "success";
  text: string;
  priority: number;
};

export function buildRecommendations(
  bonus: any,
  tiers: Tier[],
  earnedTier?: Tier,
): Recommendation[] {
  const out: Recommendation[] = [];
  if (!bonus) return out;

  const shipped = num(bonus.shipped_orders_count);
  const delivered = num(bonus.delivered_orders_count);
  const rate = num(bonus.delivery_rate);
  const required = num(bonus.required_delivery_rate);
  const minDelivered = num(bonus.minimum_delivered_orders);
  const net = num(bonus.net_profit_before_bonus);

  // 1. Profitability
  if (net <= 0) {
    out.push({
      id: "profit",
      tone: "danger",
      priority: 1,
      text: "الإنفاق والمصروفات أكبر من أو تساوي العمولات المحققة، لذلك بونص الأرباح الحالي يساوي صفرًا.",
    });
  }

  // 2. Delivery requirement
  if (rate < required) {
    const need = Math.max(1, Math.ceil(minDelivered - delivered));
    out.push({
      id: "delivery-gap",
      tone: "warning",
      priority: 2,
      text: `تحتاج إلى ${need.toLocaleString("ar-EG")} طلب مسلم إضافي لتحقيق الحد الأدنى المطلوب لنسبة التسليم.`,
    });
  } else if (required > 0 && rate - required <= 0.03) {
    out.push({
      id: "delivery-near",
      tone: "warning",
      priority: 2.5,
      text: "أنت قريب من الحد الأدنى للباقة الحالية، حافظ على مستوى التسليم حتى لا تنخفض الباقة.",
    });
  }

  // 3. Next volume tier
  const sorted = [...tiers]
    .filter((t) => t.is_active !== false)
    .sort((a, b) => a.min_shipped_orders - b.min_shipped_orders);
  const next = sorted.find((t) => t.min_shipped_orders > shipped);
  if (next) {
    out.push({
      id: "next-tier",
      tone: "info",
      priority: 3,
      text: `متبقي لك ${(next.min_shipped_orders - shipped).toLocaleString("ar-EG")} طلب خرج للشحن للوصول إلى باقة ${next.tier_name_ar}.`,
    });
  } else if (sorted.length > 0) {
    out.push({
      id: "top-tier",
      tone: "success",
      priority: 5,
      text: "تم الوصول إلى أعلى باقة من حيث حجم الطلبات، استمر على نفس المستوى.",
    });
  }

  // 4. Extra-order incentive
  const perExtra = num(earnedTier?.extra_delivered_order_amount);
  if (perExtra > 0) {
    out.push({
      id: "extra",
      tone: "info",
      priority: 4,
      text: `كل طلب مسلم إضافي فوق الحد الأدنى يضيف لك ${perExtra.toLocaleString("ar-EG")} ج.م.`,
    });
  }

  // 5. Locked month note
  if (bonus.is_locked || bonus.workflow_status === "locked") {
    out.push({
      id: "locked",
      tone: "info",
      priority: 4.5,
      text: "تم اعتماد وإغلاق هذا الشهر، والتوصيات المعروضة تفسيرية فقط.",
    });
  }

  return out.sort((a, b) => a.priority - b.priority).slice(0, 3);
}

/* -------------------------------------------------------------------------
 * Compact attention signals for admin/manager lists.
 * ------------------------------------------------------------------------- */
export type AttentionFlag = { id: string; label: string; tone: "danger" | "warning" | "info" };

export function attentionFlags(row: any, tiers: Tier[] = []): AttentionFlag[] {
  const flags: AttentionFlag[] = [];
  if (!row) return flags;

  if (num(row.net_profit_before_bonus) <= 0 || num(row.calculated_profit_bonus) <= 0) {
    flags.push({ id: "profit", label: "خسارة أو بونص أرباح صفر", tone: "danger" });
  }
  if (num(row.delivery_rate) < num(row.required_delivery_rate)) {
    flags.push({ id: "delivery", label: "نسبة التسليم أقل من المطلوب", tone: "warning" });
  }
  if (
    row.volume_tier_order_snapshot != null &&
    row.earned_tier_order_snapshot != null &&
    num(row.earned_tier_order_snapshot) < num(row.volume_tier_order_snapshot)
  ) {
    flags.push({ id: "downgrade", label: "تم تخفيض الباقة", tone: "warning" });
  }
  const shipped = num(row.shipped_orders_count);
  const sorted = [...tiers]
    .filter((t) => t.is_active !== false)
    .sort((a, b) => a.min_shipped_orders - b.min_shipped_orders);
  const next = sorted.find((t) => t.min_shipped_orders > shipped);
  if (next && shipped > 0 && next.min_shipped_orders - shipped <= next.min_shipped_orders * 0.1) {
    flags.push({ id: "near-tier", label: "قريب من الباقة التالية", tone: "info" });
  }
  if (num(row.remaining_amount) > 0) {
    flags.push({ id: "remaining", label: "متبقي بدون سداد", tone: "warning" });
  }
  return flags;
}

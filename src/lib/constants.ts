export const ORDER_STATUS = {
  pending: { label: "طلب جديد", color: "info" },
  cancelled: { label: "ملغي قبل الشحن", color: "destructive" },
  in_delivery: { label: "في الشحن", color: "warning" },
  delivered: { label: "تم التسليم", color: "success" },
  done: { label: "تم التحصيل", color: "success" },
  refunded: { label: "رجع المخزن", color: "destructive" },
  refund_request: { label: "مرتجع مع شركة الشحن", color: "destructive" },
} as const;

export type OrderStatus = keyof typeof ORDER_STATUS;

export const ORDER_STATUS_KEYS = Object.keys(ORDER_STATUS) as OrderStatus[];

// Map Arabic / common strings to enum values (for import)
export const STATUS_ALIASES: Record<string, OrderStatus> = {
  // pending — ONLY truly new orders (never cancelled)
  "pending": "pending", "طلب جديد": "pending", "جديد": "pending", "new": "pending",
  // cancelled before shipping
  "cancelled": "cancelled", "canceled": "cancelled",
  "canceled_automatically": "cancelled", "cancelled_automatically": "cancelled",
  "canceled automatically": "cancelled", "cancelled automatically": "cancelled",
  "ملغي": "cancelled", "ملغى": "cancelled", "ملغاة": "cancelled", "ملغي قبل الشحن": "cancelled",
  "cancel": "cancelled", "cancelled before shipping": "cancelled",
  // in_delivery
  "in delivery": "in_delivery", "in_delivery": "in_delivery", "في الشحن": "in_delivery", "شحن": "in_delivery", "shipping": "in_delivery",
  // delivered
  "delivered": "delivered", "تم التسليم": "delivered", "تسليم": "delivered",
  // done
  "done": "done", "تم التحصيل": "done", "تحصيل": "done", "collected": "done",
  // refunded
  "refunded": "refunded", "رجع المخزن": "refunded", "مرتجع": "refunded", "returned": "refunded",
  // refund request
  "refund_request": "refund_request", "refund request": "refund_request", "مرتجع مع شركة الشحن": "refund_request",
};

export function normalizeStatus(raw: unknown): OrderStatus {
  if (raw === null || raw === undefined || raw === "") return "pending";
  const trimmed = String(raw).trim();
  const lower = trimmed.toLowerCase();
  return STATUS_ALIASES[lower] ?? STATUS_ALIASES[trimmed] ?? "pending";
}

// Canonical status groups — single source of truth for analytics
export const SHIPPED_STATUSES: OrderStatus[] = ["in_delivery", "delivered", "done", "refund_request", "refunded"];
export const DELIVERED_STATUSES: OrderStatus[] = ["delivered", "done"];
export const RETURNED_STATUSES: OrderStatus[] = ["refunded", "refund_request"];
export const PENDING_STATUSES: OrderStatus[] = ["pending"];
export const CANCELLED_STATUSES: OrderStatus[] = ["cancelled"];
// Commission excluded from gross profit
export const COMMISSION_EXCLUDED_STATUSES: OrderStatus[] = ["refunded", "refund_request", "cancelled"];

export const MARKETER_STATUS = {
  active: "نشط",
  paused: "موقوف مؤقتاً",
  inactive: "غير نشط",
} as const;

export const ROLE_LABELS = {
  admin: "مدير النظام",
  account_manager: "مدير حساب",
  marketer: "مسوّق",
} as const;

export const SPEND_TYPE_LABELS = {
  meta_ads: "Meta Ads",
  tiktok_ads: "Tiktok Ads",
  easy_order: "Easy Order",
  salary: "Salary",
  other: "Other",
} as const;

export type SpendType = keyof typeof SPEND_TYPE_LABELS;

export const SYSTEM_FIELDS = [
  { key: "external_order_id", label: "رقم الطلب" },
  { key: "marketer_code", label: "كود المسوّق" },
  { key: "product_sku", label: "كود المنتج (SKU)" },
  { key: "product_name", label: "اسم المنتج" },
  { key: "shipping_company", label: "شركة الشحن" },
  { key: "customer_name", label: "اسم العميل" },
  { key: "customer_phone", label: "رقم العميل" },
  { key: "governorate", label: "المحافظة" },
  { key: "quantity", label: "الكمية" },
  { key: "price", label: "السعر" },
  { key: "commission", label: "العمولة" },
  { key: "status", label: "الحالة" },
  { key: "order_date", label: "تاريخ الطلب" },
  { key: "delivered_date", label: "تاريخ التسليم" },
] as const;

export type SystemField = (typeof SYSTEM_FIELDS)[number]["key"];

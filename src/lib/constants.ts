export const ORDER_STATUS = {
  pending: { label: "طلب جديد", color: "info" },
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
  // pending
  "pending": "pending", "طلب جديد": "pending", "جديد": "pending", "new": "pending",
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
  if (!raw) return "pending";
  const key = String(raw).trim().toLowerCase();
  return STATUS_ALIASES[key] ?? STATUS_ALIASES[String(raw).trim()] ?? "pending";
}

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

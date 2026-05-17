# خطة بناء "Marketers Performance Hub"

تطبيق ويب احترافي عربي (RTL) لإدارة أداء المسوّقين بالعمولة، مبني على TanStack Start + Lovable Cloud.

## المرحلة 1 — قاعدة البيانات والمصادقة (Migration واحد)

### Enums
- `app_role`: `admin`, `account_manager`, `marketer`
- `order_status`: `pending`, `in_delivery`, `delivered`, `done`, `refunded`, `refund_request`
- `marketer_status`: `active`, `paused`, `inactive`
- `ad_platform`: `meta`, `tiktok`, `manual`

### الجداول
- **profiles** — `id (uuid → auth.users)`, `full_name`, `email`, `phone`, `avatar_url`, timestamps
- **user_roles** — `id`, `user_id`, `role` (مفصول عن profiles لمنع privilege escalation)
- **marketers** — `id`, `marketer_code` (unique), `name`, `phone`, `whatsapp`, `email`, `facebook_profile`, `tiktok_profile`, `status`, `account_manager_id`, `user_id` (يربط بحساب login للمسوّق), `notes`, timestamps
- **products** — `id`, `sku`, `name`, `category`, `cost`, `notes`
- **shipping_companies** — `id`, `name`, `notes`
- **orders** — `id`, `external_order_id`, `marketer_id`, `product_id`, `shipping_company_id`, `customer_name`, `customer_phone`, `governorate`, `quantity`, `price`, `commission`, `status`, `order_date`, `delivered_date`, `import_batch_id`, `raw_data jsonb`, timestamps
- **ad_spend_transactions** — `marketer_id`, `ad_account_id` (nullable), `amount`, `fawry_code`, `transaction_date`, `notes`, `created_by`
- **ad_accounts** — `id`, `marketer_id`, `platform`, `ad_account_id`, `account_name`, `access_status`, `last_sync_at` (وضع مكان للتكامل المستقبلي)
- **import_batches** — `id`, `filename`, `row_count`, `success_count`, `error_count`, `mapping_used jsonb`, `status`, `created_by`, `created_at`
- **column_mappings** — `id`, `name`, `mapping jsonb` (مفتاح: حقل النظام → اسم عمود Excel), `is_default`, `created_by`

### Security Definer Functions
- `has_role(_user_id, _role)` — للتحقق من الدور
- `current_marketer_id()` — يرجع `marketers.id` المرتبط بـ `auth.uid()`

### RLS
- **Admin**: كل شيء
- **Account Manager**: قراءة الكل، إنشاء/تحديث marketers + orders + ad_spend
- **Marketer**: قراءة سجلاته فقط (orders/ad_spend/ad_accounts حيث `marketer_id = current_marketer_id()`)

### Trigger
- عند إنشاء مستخدم جديد في `auth.users` → إنشاء صف في `profiles` تلقائيًا

### Auth
- Email/Password + Google OAuth (managed)
- بعد تسجيل الدخول: توجيه حسب الدور

## المرحلة 2 — البنية والتنقل

### Layout
- `_authenticated.tsx` — guard
- Sidebar (RTL، طي/فتح، يعرض البنود حسب الدور)
- Topbar (الاسم، الدور، خروج)

### Routes
```
/login                          عام
/_authenticated/                 (لوحة حسب الدور)
  ├─ dashboard                   Admin/AM: KPIs عامة | Marketer: لوحته
  ├─ marketers                   قائمة المسوّقين
  ├─ marketers/$id               تفاصيل + أداء كامل
  ├─ orders                      جدول الطلبات + فلاتر
  ├─ orders/import               رفع Excel/CSV + Column Mapping
  ├─ ad-spend                    المحفظة + المعاملات
  ├─ products                    أداء المنتجات
  ├─ shipping                    أداء شركات الشحن
  ├─ ad-accounts                 (placeholder لـ Meta/TikTok)
  └─ settings/mappings           حفظ/تعديل قوالب الـ column mapping
```

## المرحلة 3 — الصفحات والميزات الأساسية

### Dashboard (Admin/AM)
KPI Cards: Total Orders, Pending, In Delivery, Delivered, Done, Refunded, Refund Request, Gross Profit, Ad Spend, **Net Profit**, Delivery Rate, Refund Rate.
Charts (recharts):
- Orders by status (Pie)
- Daily orders trend (Line)
- Top 5 marketers by net profit (Bar)
- Top 5 products (Bar)
فلاتر: date range, marketer, product, status, shipping company.

### Marketer Dashboard
نفس الـ KPIs لكن مفلتر لسجلاته فقط.

### Marketers Management
جدول (بحث، فرز، ترقيم صفحات)، Dialog لإضافة/تعديل، عمود حالة، زر "عرض التفاصيل".

### Marketer Details
- بيانات الملف الشخصي
- KPIs + Charts للأداء
- جدول آخر الطلبات
- جدول معاملات الـ Ad Spend
- زر "إضافة معاملة محفظة"

### Orders Import (المحور التقني)
1. رفع ملف (xlsx/csv) — `xlsx` لـ Excel, `papaparse` لـ CSV
2. عرض أول صف كرؤوس + معاينة 5 صفوف
3. UI لربط كل **حقل نظام** (marketer_code, product_sku, status, price, commission, ...) بـ **عمود من الملف** عبر `<Select>`
4. تحميل/حفظ Mapping من `column_mappings`
5. Mapping للحالات: قيم النص العربي → enum (مثال: "تم التسليم" → `delivered`)
6. زر "استيراد" — يُنشئ `import_batch`، يُدخل الصفوف، يربط/ينشئ marketers/products/shipping حسب الكود
7. تقرير: نجاح/فشل + أخطاء لكل صف

### Orders Table
DataTable: بحث، فرز كل عمود، فلاتر (تاريخ، مسوّق، حالة، شركة شحن، منتج)، تصدير CSV، badges ملوّنة للحالة بالعربي.

### Ad Spend / Wallet
- KPI: إجمالي الصرف، الرصيد (محسوب)، عدد المعاملات
- جدول معاملات + Dialog إضافة (للأدمن/AM)
- فلتر بالمسوّق والتاريخ

### Products / Shipping Performance
لكل منتج/شركة شحن: عدد الطلبات، التسليم، الإرجاع، الـ commission، delivery rate.
فلتر تاريخ + جدول قابل للفرز.

### Settings / Column Mapping
CRUD لقوالب الـ mapping المحفوظة + تعيين قالب افتراضي.

### Ad Accounts (Placeholder)
صفحة تعرض الحسابات المرتبطة مع شارة "قريبًا — تكامل Meta/TikTok"، إمكانية إضافة سجل يدوي بـ `platform`, `ad_account_id`, `access_status`.

## المرحلة 4 — التصميم

- **RTL** على مستوى `<html dir="rtl" lang="ar">`
- ثيم فاتح احترافي: خلفية رمادية فاتحة، بطاقات بيضاء، Primary أزرق هادئ (oklch)، Success أخضر، Warning كهرماني، Danger أحمر — كل الألوان tokens في `src/styles.css`
- خطوط عربية: **Cairo** للعناوين، **IBM Plex Sans Arabic** للنص (Google Fonts)
- KPI cards مع أيقونات Lucide ومؤشّر اتجاه
- Charts بألوان من الـ design tokens
- شارات حالة بألوان دلالية

## التفاصيل التقنية الرئيسية

- **Server Functions** (`createServerFn` + `requireSupabaseAuth`) لكل قراءات/كتابات الأعمال
- استخدام `attachSupabaseAuth` في `src/start.ts` (مسجَّل تلقائيًا)
- استعلامات التجميع (KPIs) عبر RPC functions في Postgres لتحسين الأداء
- React Query للتخزين المؤقت + invalidation
- معالجة الملفات: `xlsx` على client (لتقليل حجم الـ Worker)، الإرسال كـ JSON إلى server fn
- التواريخ: `date-fns` مع locale عربي
- التحقق من المدخلات: `zod`

## ما هو خارج النطاق (الآن)

- تكامل API فعلي مع Meta Ads / TikTok Ads — فقط الجداول والصفحة placeholder
- إشعارات real-time
- تطبيق موبايل
- تعدد العملات

## ترتيب التنفيذ

1. Migration + Auth (mocked test users)
2. Layout + Sidebar + Login + Auth guards
3. Marketers CRUD
4. Orders Import + Column Mapping (أهم ميزة)
5. Orders Table + الفلاتر
6. Ad Spend
7. Dashboards + Charts + KPIs (RPCs)
8. Products / Shipping Performance
9. Settings / Ad Accounts placeholder
10. تلميع التصميم والـ RTL النهائي

سيُبنى على دفعات؛ الدفعة الأولى ستوصل التطبيق إلى مرحلة "يعمل end-to-end" مع المسوّقين والطلبات، ثم نتوسّع.

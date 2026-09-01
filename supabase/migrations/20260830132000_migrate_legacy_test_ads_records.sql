-- Migrate the legacy 'test_ads' rows out of ad_spend_transactions and
-- into test_spend_entries.
--
-- Audit before migrating (2026-08-30): 7 rows, 820.00 EGP total, across
-- 3 marketer/month groups:
--   Ahmed MB Angazny  2026-07  funding 30,000.00  test   300.00
--   Amar MB Angazny   2026-08  funding  7,500.00  test   400.00
--   Moamen MB Angazny 2026-08  funding 35,450.00  test   120.00
-- None exceeds its month's funding, so every row migrates cleanly and
-- the funding-cap rule holds for all of them.
--
-- These rows were never added to ad_spend and never added to
-- other_expenses under the old logic, so they were invisible to the
-- bonus maths — moving them here is a first correction, not a double
-- correction. Provenance is kept in source_transaction_id.
--
-- Only ONE affected month has a saved bonus row (Ahmed, 2026-07,
-- workflow_status='calculated', is_locked=false). It is deliberately
-- NOT recalculated here: recalculation changes a bonus figure and is a
-- business decision, done with the existing "إعادة الاحتساب" button.

INSERT INTO public.test_spend_entries (
  marketer_id, amount, test_date, product_name, notes,
  source_transaction_id, created_by, created_at
)
SELECT
  t.marketer_id,
  t.amount,
  t.transaction_date,
  'غير محدد — سجل قديم' AS product_name,
  btrim(
    COALESCE(t.notes || E'\n', '')
    || 'مُرحّل تلقائيًا من معاملات الإنفاق الإعلاني (نوع: مصروف تيست) بتاريخ 2026-08-30.'
    || COALESCE(' كود فوري الأصلي: ' || t.fawry_code, '')
  ) AS notes,
  t.id AS source_transaction_id,
  t.created_by,
  t.created_at
FROM public.ad_spend_transactions t
WHERE t.spend_type = 'test_ads'
  AND NOT EXISTS (
    SELECT 1 FROM public.test_spend_entries e WHERE e.source_transaction_id = t.id
  );

DELETE FROM public.ad_spend_transactions t
WHERE t.spend_type = 'test_ads'
  AND EXISTS (
    SELECT 1 FROM public.test_spend_entries e WHERE e.source_transaction_id = t.id
  );

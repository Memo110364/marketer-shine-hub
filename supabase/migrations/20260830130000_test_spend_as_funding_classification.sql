-- ============================================================
-- Test Spend is a CLASSIFICATION of advertising funding, not an
-- extra expense.
--
-- Before: test spend lived in ad_spend_transactions as its own
-- spend_type ('test_ads'). It was excluded from ad_spend and from
-- other_expenses, so the bonus engine charged the marketer the FULL
-- funding and the test amount simply vanished from the maths.
--
-- After:
--   total_ad_funding    = SUM(meta_ads + tiktok_ads)   -- codes issued
--   test_spend          = SUM(test_spend_entries)      -- classification
--   performance_ad_spend = max(total_ad_funding - test_spend, 0)
--
-- and the bonus engine deducts performance_ad_spend only. Test spend
-- never increases funding and is never subtracted a second time.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.test_spend_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id uuid NOT NULL REFERENCES public.marketers(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),

  -- The month a test entry belongs to is decided by test_date; an
  -- optional end date only documents a range that was run.
  test_date date NOT NULL DEFAULT CURRENT_DATE,
  test_end_date date,

  -- Prefer the product catalogue; fall back to free text when the
  -- tested product isn't a catalogue item yet.
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text,

  result text CHECK (result IN ('successful', 'promising', 'weak', 'discontinued')),
  notes text,

  -- Optional operational detail — never required, so nobody has to
  -- invent numbers that were not measured.
  orders_generated integer CHECK (orders_generated >= 0),
  delivered_orders integer CHECK (delivered_orders >= 0),
  revenue_generated numeric(14,2) CHECK (revenue_generated >= 0),
  cost_per_order numeric(14,2) CHECK (cost_per_order >= 0),

  -- Provenance for rows migrated out of ad_spend_transactions.
  source_transaction_id uuid,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT test_spend_end_after_start
    CHECK (test_end_date IS NULL OR test_end_date >= test_date),
  CONSTRAINT test_spend_product_identified
    CHECK (product_id IS NOT NULL OR (product_name IS NOT NULL AND btrim(product_name) <> ''))
);

CREATE INDEX IF NOT EXISTS idx_test_spend_entries_marketer_date
  ON public.test_spend_entries(marketer_id, test_date);
CREATE INDEX IF NOT EXISTS idx_test_spend_entries_product_id
  ON public.test_spend_entries(product_id);
CREATE INDEX IF NOT EXISTS idx_test_spend_entries_created_by
  ON public.test_spend_entries(created_by);

-- ------------------------------------------------------------
-- Validation: per marketer/month, test spend can never exceed the
-- advertising funding it is carved out of. Multiple entries in a
-- month are fine as long as their total stays within funding.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_test_spend_within_funding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  p_start date := date_trunc('month', NEW.test_date)::date;
  p_end date := (date_trunc('month', NEW.test_date) + INTERVAL '1 month - 1 day')::date;
  funding numeric(14,2) := 0;
  other_tests numeric(14,2) := 0;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO funding
  FROM public.ad_spend_transactions
  WHERE marketer_id = NEW.marketer_id
    AND spend_type IN ('meta_ads', 'tiktok_ads')
    AND transaction_date BETWEEN p_start AND p_end;

  SELECT COALESCE(SUM(amount), 0) INTO other_tests
  FROM public.test_spend_entries
  WHERE marketer_id = NEW.marketer_id
    AND test_date BETWEEN p_start AND p_end
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF other_tests + NEW.amount > funding THEN
    RAISE EXCEPTION 'مصروف التيست لا يمكن أن يتجاوز إجمالي المصروف الإعلاني المتاح.';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_test_spend_within_funding ON public.test_spend_entries;
CREATE TRIGGER trg_test_spend_within_funding
  BEFORE INSERT OR UPDATE ON public.test_spend_entries
  FOR EACH ROW EXECUTE FUNCTION public.assert_test_spend_within_funding();

-- ------------------------------------------------------------
-- Stop new 'test_ads' rows reaching ad_spend_transactions. The enum
-- value stays (Postgres can't safely drop enum members, and old rows
-- may still reference it), but nothing may write it any more —
-- otherwise test spend would silently become funding again.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_test_ads_transactions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.spend_type = 'test_ads' THEN
    RAISE EXCEPTION 'مصروف التيست يُسجَّل في جدول مصاريف التيست وليس كمعاملة إنفاق إعلاني، لأنه جزء من التمويل الحالي وليس مبلغًا إضافيًا.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_test_ads_transactions ON public.ad_spend_transactions;
CREATE TRIGGER trg_reject_test_ads_transactions
  BEFORE INSERT OR UPDATE ON public.ad_spend_transactions
  FOR EACH ROW EXECUTE FUNCTION public.reject_test_ads_transactions();

-- ------------------------------------------------------------
-- RLS — mirrors the ad_spend_transactions policies exactly, using the
-- (select auth.uid()) form so the check runs once per query, not per row.
-- ------------------------------------------------------------
ALTER TABLE public.test_spend_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Test spend read scoped" ON public.test_spend_entries;
CREATE POLICY "Test spend read scoped" ON public.test_spend_entries
  FOR SELECT USING (
    has_role((select auth.uid()), 'admin'::app_role)
    OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id))
    OR (marketer_id = current_marketer_id())
  );

DROP POLICY IF EXISTS "Test spend insert AM" ON public.test_spend_entries;
CREATE POLICY "Test spend insert AM" ON public.test_spend_entries
  FOR INSERT WITH CHECK (
    has_role((select auth.uid()), 'admin'::app_role)
    OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id))
  );

DROP POLICY IF EXISTS "Test spend update scoped" ON public.test_spend_entries;
CREATE POLICY "Test spend update scoped" ON public.test_spend_entries
  FOR UPDATE USING (
    has_role((select auth.uid()), 'admin'::app_role)
    OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id))
  );

DROP POLICY IF EXISTS "Test spend delete admin" ON public.test_spend_entries;
CREATE POLICY "Test spend delete admin" ON public.test_spend_entries
  FOR DELETE USING (has_role((select auth.uid()), 'admin'::app_role));

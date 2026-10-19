-- Test-product opportunity board.
--
-- Lets an admin/account_manager advertise a candidate product for marketers
-- to volunteer to test, with a guideline daily budget, duration, and a
-- capacity of how many marketers can take it. This is coordination only:
-- the daily_test_budget/duration_days here are never written to
-- ad_spend_transactions or test_spend_entries and never enter the bonus or
-- profit calculations. The real test spend continues to be entered exactly
-- as before, independently, once a marketer's test actually runs.

CREATE TABLE public.test_product_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT,
  daily_test_budget NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (daily_test_budget >= 0),
  duration_days INTEGER NOT NULL DEFAULT 0 CHECK (duration_days >= 0),
  max_marketers INTEGER NOT NULL DEFAULT 1 CHECK (max_marketers > 0),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT test_product_offers_name_present CHECK (product_id IS NOT NULL OR product_name IS NOT NULL)
);

CREATE TRIGGER test_product_offers_updated_at BEFORE UPDATE ON public.test_product_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.test_product_offer_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL REFERENCES public.test_product_offers(id) ON DELETE CASCADE,
  marketer_id UUID NOT NULL REFERENCES public.marketers(id) ON DELETE CASCADE,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (offer_id, marketer_id)
);

CREATE INDEX idx_test_product_offer_claims_offer ON public.test_product_offer_claims(offer_id);
CREATE INDEX idx_test_product_offer_claims_marketer ON public.test_product_offer_claims(marketer_id);

-- Enforce capacity + open status server-side so a race or a direct API call
-- can't bypass what the UI shows.
CREATE OR REPLACE FUNCTION public.enforce_test_offer_capacity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max INTEGER;
  v_status TEXT;
  v_count INTEGER;
BEGIN
  SELECT max_marketers, status INTO v_max, v_status
  FROM public.test_product_offers WHERE id = NEW.offer_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'فرصة التيست غير موجودة';
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'فرصة التيست دي مقفولة';
  END IF;

  SELECT count(*) INTO v_count FROM public.test_product_offer_claims WHERE offer_id = NEW.offer_id;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'اكتملت كل الأماكن المتاحة لفرصة التيست دي';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_test_offer_capacity
  BEFORE INSERT ON public.test_product_offer_claims
  FOR EACH ROW EXECUTE FUNCTION public.enforce_test_offer_capacity();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.test_product_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_product_offer_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Test offers read all" ON public.test_product_offers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Test offers write admin/AM" ON public.test_product_offers
  FOR ALL TO authenticated
  USING (has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role));

CREATE POLICY "Test offer claims read all" ON public.test_product_offer_claims
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Test offer claims insert self" ON public.test_product_offer_claims
  FOR INSERT TO authenticated
  WITH CHECK (marketer_id = current_marketer_id());

CREATE POLICY "Test offer claims delete self or admin/AM" ON public.test_product_offer_claims
  FOR DELETE TO authenticated
  USING (
    marketer_id = current_marketer_id()
    OR has_role((select auth.uid()), 'admin'::app_role)
    OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id))
  );

-- Let a marketer preview their own bonus figures (read-only). Previously
-- these two functions only allowed admin / the marketer's account_manager —
-- a 'marketer' role calling them for themselves got "Not authorized". Adds
-- one extra OR-branch to each; nothing else about the calculation changes,
-- and calculate_monthly_bonus (which persists a result) is untouched, so a
-- marketer still can't trigger or alter an actual bonus record.

CREATE OR REPLACE FUNCTION public.load_bonus_month_inputs(
  _marketer_id uuid,
  _year integer,
  _month integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  p_start date := make_date(_year, _month, 1);
  p_end date := (make_date(_year, _month, 1) + INTERVAL '1 month - 1 day')::date;
  shipped integer := 0;
  delivered integer := 0;
  commission numeric(14,2) := 0;
  funding numeric(14,2) := 0;
  easy_order numeric(14,2) := 0;
  other numeric(14,2) := 0;
  test_spend numeric(14,2) := 0;
  performance_ads numeric(14,2) := 0;
BEGIN
  IF NOT (
    has_role(auth.uid(), 'admin')
    OR (has_role(auth.uid(), 'account_manager') AND is_my_marketer(_marketer_id))
    OR (has_role(auth.uid(), 'marketer') AND _marketer_id = current_marketer_id())
  ) THEN
    RAISE EXCEPTION 'Not authorized to read bonus inputs for this marketer';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status IN ('in_delivery','delivered','done','refund_request','refunded')),
    COUNT(*) FILTER (WHERE status IN ('delivered','done')),
    COALESCE(SUM(orders.commission) FILTER (WHERE status IN ('delivered','done')), 0)
  INTO shipped, delivered, commission
  FROM public.orders
  WHERE marketer_id = _marketer_id
    AND order_date BETWEEN p_start AND p_end;

  -- 'test_ads' is excluded from every bucket here: legacy rows must not
  -- inflate funding, and new ones can no longer be written at all.
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE spend_type IN ('meta_ads','tiktok_ads')), 0),
    COALESCE(SUM(amount) FILTER (WHERE spend_type = 'easy_order'), 0),
    COALESCE(SUM(amount) FILTER (WHERE spend_type NOT IN ('meta_ads','tiktok_ads','easy_order','test_ads')), 0)
  INTO funding, easy_order, other
  FROM public.ad_spend_transactions
  WHERE marketer_id = _marketer_id
    AND transaction_date BETWEEN p_start AND p_end;

  SELECT COALESCE(SUM(amount), 0) INTO test_spend
  FROM public.test_spend_entries
  WHERE marketer_id = _marketer_id
    AND test_date BETWEEN p_start AND p_end;

  performance_ads := GREATEST(funding - test_spend, 0);

  RETURN jsonb_build_object(
    'period_start', p_start,
    'period_end', p_end,
    'shipped_orders_count', shipped,
    'delivered_orders_count', delivered,
    'realized_commission', commission,
    'total_ad_funding', funding,
    'test_spend', test_spend,
    'ad_spend', performance_ads,
    'easy_order_cost', easy_order,
    'other_expenses', other,
    -- legacy alias, same value as test_spend
    'test_ads_cost', test_spend
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_monthly_bonus(
  _marketer_id uuid,
  _year integer,
  _month integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inp jsonb;
BEGIN
  IF NOT (
    has_role(auth.uid(), 'admin')
    OR (has_role(auth.uid(), 'account_manager') AND is_my_marketer(_marketer_id))
    OR (has_role(auth.uid(), 'marketer') AND _marketer_id = current_marketer_id())
  ) THEN
    RAISE EXCEPTION 'Not authorized to preview bonuses for this marketer';
  END IF;

  inp := public.load_bonus_month_inputs(_marketer_id, _year, _month);

  RETURN public.compute_bonus_figures(
    (inp->>'shipped_orders_count')::integer,
    (inp->>'delivered_orders_count')::integer,
    (inp->>'realized_commission')::numeric,
    (inp->>'ad_spend')::numeric,
    (inp->>'other_expenses')::numeric,
    (inp->>'easy_order_cost')::numeric,
    (inp->>'test_spend')::numeric,
    (inp->>'total_ad_funding')::numeric
  ) || jsonb_build_object(
    'period_start', inp->>'period_start',
    'period_end', inp->>'period_end'
  );
END;
$$;

-- These two are already revoked from PUBLIC/anon/authenticated at the grant
-- level and exposed only via the SECURITY DEFINER body's own role check
-- (see 20260812130000_lock_down_bonus_helper_functions.sql); re-asserting
-- here is a no-op but documents that this migration doesn't change that.
REVOKE EXECUTE ON FUNCTION public.load_bonus_month_inputs(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;

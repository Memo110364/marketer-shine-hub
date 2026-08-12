-- Security audit finding: load_bonus_month_inputs() is SECURITY DEFINER
-- with no auth check of its own. It's only meant to be called internally
-- by preview_monthly_bonus()/calculate_monthly_bonus() (which DO check
-- has_role/is_my_marketer before calling it) — but Postgres/PostgREST
-- exposes every public-schema function as its own RPC endpoint by
-- default, so anyone holding the public anon key (no login required)
-- could call /rest/v1/rpc/load_bonus_month_inputs directly with any
-- marketer_id and read that marketer's real commission, ad spend, and
-- other costs. Close both the endpoint and add an in-function guard as
-- defense in depth.
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
  ads numeric(14,2) := 0;
  easy_order numeric(14,2) := 0;
  other numeric(14,2) := 0;
  test_ads numeric(14,2) := 0;
BEGIN
  IF NOT (
    has_role(auth.uid(), 'admin')
    OR (has_role(auth.uid(), 'account_manager') AND is_my_marketer(_marketer_id))
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

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE spend_type IN ('meta_ads','tiktok_ads')), 0),
    COALESCE(SUM(amount) FILTER (WHERE spend_type = 'easy_order'), 0),
    COALESCE(SUM(amount) FILTER (WHERE spend_type NOT IN ('meta_ads','tiktok_ads','easy_order','test_ads')), 0),
    COALESCE(SUM(amount) FILTER (WHERE spend_type = 'test_ads'), 0)
  INTO ads, easy_order, other, test_ads
  FROM public.ad_spend_transactions
  WHERE marketer_id = _marketer_id
    AND transaction_date BETWEEN p_start AND p_end;

  RETURN jsonb_build_object(
    'period_start', p_start,
    'period_end', p_end,
    'shipped_orders_count', shipped,
    'delivered_orders_count', delivered,
    'realized_commission', commission,
    'ad_spend', ads,
    'easy_order_cost', easy_order,
    'other_expenses', other,
    'test_ads_cost', test_ads
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.load_bonus_month_inputs(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;

-- prevent_self_status_change is a trigger function (reads NEW/OLD), never
-- meant to be called directly — remove it from the RPC surface too.
REVOKE EXECUTE ON FUNCTION public.prevent_self_status_change()
  FROM PUBLIC, anon, authenticated;

-- compute_bonus_figures is a pure calculator (no table access, so no data
-- leak), but it's an internal helper, not a public endpoint. Drop the two
-- stale overloads left behind by earlier migrations (they predate
-- easy_order_cost/test_ads_cost and would silently compute the old
-- formula if ever called with exactly 5 or 6 args) and lock down the
-- current one.
DROP FUNCTION IF EXISTS public.compute_bonus_figures(integer, integer, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public.compute_bonus_figures(integer, integer, numeric, numeric, numeric, numeric);

REVOKE EXECUTE ON FUNCTION public.compute_bonus_figures(integer, integer, numeric, numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated;

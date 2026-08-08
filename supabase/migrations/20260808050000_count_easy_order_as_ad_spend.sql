-- Count 'easy_order' spend as part of ad_spend (الإنفاق الإعلاني) instead of
-- other_expenses (المصروفات الأخرى), per business request. Does not change
-- final bonus totals (both buckets are subtracted the same way in
-- compute_bonus_figures), only how the split is categorized/displayed.
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
  other numeric(14,2) := 0;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status IN ('in_delivery','delivered','done','refund_request','refunded')),
    COUNT(*) FILTER (WHERE status IN ('delivered','done')),
    COALESCE(SUM(orders.commission) FILTER (WHERE status IN ('delivered','done')), 0)
  INTO shipped, delivered, commission
  FROM public.orders
  WHERE marketer_id = _marketer_id
    AND order_date BETWEEN p_start AND p_end;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE spend_type IN ('meta_ads','tiktok_ads','easy_order')), 0),
    COALESCE(SUM(amount) FILTER (WHERE spend_type NOT IN ('meta_ads','tiktok_ads','easy_order')), 0)
  INTO ads, other
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
    'other_expenses', other
  );
END;
$$;

-- ============================================================
-- Phase 2: Monthly Bonus Calculation Engine (database only)
-- ============================================================

-- 1) Pure calculation core (no DB reads except bonus_tiers)
CREATE OR REPLACE FUNCTION public.compute_bonus_figures(
  _shipped_orders integer,
  _delivered_orders integer,
  _realized_commission numeric,
  _ad_spend numeric,
  _other_expenses numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  shipped integer := GREATEST(COALESCE(_shipped_orders, 0), 0);
  delivered integer := GREATEST(COALESCE(_delivered_orders, 0), 0);
  commission numeric(14,2) := COALESCE(_realized_commission, 0);
  ads numeric(14,2) := COALESCE(_ad_spend, 0);
  other numeric(14,2) := COALESCE(_other_expenses, 0);
  rate numeric(6,4) := 0;
  net numeric(14,2);
  training public.bonus_tiers%ROWTYPE;
  vol public.bonus_tiers%ROWTYPE;
  earned public.bonus_tiers%ROWTYPE;
  proportional boolean := false;
  salary numeric(14,2) := 0;
  profit_bonus numeric(14,2) := 0;
  extra_bonus numeric(14,2) := 0;
  min_delivered integer := 0;
  extra_orders integer := 0;
  reason text := NULL;
BEGIN
  -- STEP 4: delivery rate
  IF shipped > 0 THEN
    rate := ROUND(delivered::numeric / shipped::numeric, 4);
  END IF;

  -- STEP 7: net profit before bonus (may be negative)
  net := commission - ads - other;

  SELECT * INTO training FROM public.bonus_tiers
   WHERE is_active AND tier_code = 'training' LIMIT 1;
  IF training.id IS NULL THEN
    SELECT * INTO training FROM public.bonus_tiers
     WHERE is_active ORDER BY tier_order ASC LIMIT 1;
  END IF;
  IF training.id IS NULL THEN
    RAISE EXCEPTION 'No active bonus tiers configured';
  END IF;

  -- STEP 8: volume tier by shipped orders
  SELECT * INTO vol FROM public.bonus_tiers
   WHERE is_active AND min_shipped_orders <= shipped
   ORDER BY tier_order DESC LIMIT 1;

  IF vol.id IS NULL THEN
    -- below the lowest tier threshold -> proportional salary mode
    proportional := true;
    vol := training;
    earned := training;
    reason := 'below_minimum_volume_proportional_salary';
  ELSE
    -- STEP 9: earned tier = drop one tier at a time until delivery rate is met
    earned := vol;
    WHILE earned.tier_order > training.tier_order
      AND rate < earned.minimum_delivery_rate LOOP
      SELECT * INTO earned FROM public.bonus_tiers
       WHERE is_active AND tier_order < earned.tier_order
       ORDER BY tier_order DESC LIMIT 1;
      EXIT WHEN earned.id IS NULL;
    END LOOP;
    IF earned.id IS NULL THEN
      earned := training;
    END IF;
    IF earned.id <> vol.id THEN
      reason := 'delivery_rate_below_requirement_tier_downgraded';
    END IF;
  END IF;

  -- STEP 10: salary
  IF proportional THEN
    salary := ROUND(training.base_salary * shipped::numeric
                    / NULLIF(training.min_shipped_orders, 0)::numeric, 2);
  ELSE
    salary := earned.base_salary;
  END IF;

  -- STEP 12: profit bonus (STEP 11 always uses earned-tier percentage)
  IF net > 0 THEN
    profit_bonus := ROUND(net * earned.bonus_percentage, 2);
  END IF;

  -- STEP 13: extra delivered bonus (only for full tiers, not proportional mode)
  min_delivered := CEIL(shipped::numeric * earned.minimum_delivery_rate)::integer;
  IF NOT proportional AND delivered > min_delivered THEN
    extra_orders := delivered - min_delivered;
    extra_bonus := ROUND(extra_orders::numeric * earned.extra_delivered_order_amount, 2);
  ELSE
    extra_orders := 0;
    extra_bonus := 0;
  END IF;

  RETURN jsonb_build_object(
    'shipped_orders_count', shipped,
    'delivered_orders_count', delivered,
    'delivery_rate', rate,
    'realized_commission', commission,
    'ad_spend', ads,
    'other_expenses', other,
    'net_profit_before_bonus', net,
    'proportional_mode', proportional,
    'volume_tier_id', vol.id,
    'earned_tier_id', earned.id,
    'volume_tier_name_snapshot', vol.tier_name_ar,
    'earned_tier_name_snapshot', earned.tier_name_ar,
    'volume_tier_order_snapshot', vol.tier_order,
    'earned_tier_order_snapshot', earned.tier_order,
    'required_delivery_rate', earned.minimum_delivery_rate,
    'minimum_delivered_orders', min_delivered,
    'extra_delivered_orders', extra_orders,
    'tier_change_reason', reason,
    'calculated_salary', salary,
    'calculated_profit_bonus', profit_bonus,
    'calculated_extra_orders_bonus', extra_bonus,
    -- STEP 14
    'system_calculated_total', salary + profit_bonus + extra_bonus
  );
END;
$$;

-- 2) Load a marketer's month inputs (STEPS 1-3, 5-6)
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
    COALESCE(SUM(commission) FILTER (WHERE status IN ('delivered','done')), 0)
  INTO shipped, delivered, commission
  FROM public.orders
  WHERE marketer_id = _marketer_id
    AND order_date BETWEEN p_start AND p_end;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE spend_type IN ('meta_ads','tiktok_ads')), 0),
    COALESCE(SUM(amount) FILTER (WHERE spend_type NOT IN ('meta_ads','tiktok_ads')), 0)
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

-- 3) Preview (no writes)
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
  ) THEN
    RAISE EXCEPTION 'Not authorized to preview bonuses for this marketer';
  END IF;

  inp := public.load_bonus_month_inputs(_marketer_id, _year, _month);

  RETURN public.compute_bonus_figures(
    (inp->>'shipped_orders_count')::integer,
    (inp->>'delivered_orders_count')::integer,
    (inp->>'realized_commission')::numeric,
    (inp->>'ad_spend')::numeric,
    (inp->>'other_expenses')::numeric
  ) || jsonb_build_object(
    'period_start', inp->>'period_start',
    'period_end', inp->>'period_end'
  );
END;
$$;

-- 4) Calculate / recalculate and persist the snapshot (STEPS 16-18)
CREATE OR REPLACE FUNCTION public.calculate_monthly_bonus(
  _marketer_id uuid,
  _year integer,
  _month integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  actor uuid := auth.uid();
  inp jsonb;
  res jsonb;
  existing public.monthly_marketer_bonuses%ROWTYPE;
  bonus_id uuid;
  manual numeric(14,2) := 0;
  final_amt numeric(14,2);
  action text;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT (
    has_role(actor, 'admin')
    OR (has_role(actor, 'account_manager') AND is_my_marketer(_marketer_id))
  ) THEN
    RAISE EXCEPTION 'Not authorized to calculate bonuses for this marketer';
  END IF;
  IF _month < 1 OR _month > 12 THEN
    RAISE EXCEPTION 'Invalid month: %', _month;
  END IF;

  SELECT * INTO existing FROM public.monthly_marketer_bonuses
   WHERE marketer_id = _marketer_id AND bonus_year = _year AND bonus_month = _month
   FOR UPDATE;

  -- STEP 17: locked months cannot be recalculated
  IF existing.id IS NOT NULL AND (existing.is_locked OR existing.workflow_status = 'locked') THEN
    RAISE EXCEPTION 'Bonus for %-% is locked and cannot be recalculated', _year, _month;
  END IF;

  inp := public.load_bonus_month_inputs(_marketer_id, _year, _month);
  res := public.compute_bonus_figures(
    (inp->>'shipped_orders_count')::integer,
    (inp->>'delivered_orders_count')::integer,
    (inp->>'realized_commission')::numeric,
    (inp->>'ad_spend')::numeric,
    (inp->>'other_expenses')::numeric
  );

  manual := COALESCE(existing.manual_adjustment_amount, 0);
  final_amt := GREATEST((res->>'system_calculated_total')::numeric + manual, 0);

  IF existing.id IS NULL THEN
    action := 'calculated';
    INSERT INTO public.monthly_marketer_bonuses (
      marketer_id, bonus_year, bonus_month, period_start, period_end,
      shipped_orders_count, delivered_orders_count, delivery_rate,
      realized_commission, ad_spend, other_expenses, net_profit_before_bonus,
      volume_tier_id, earned_tier_id,
      volume_tier_name_snapshot, earned_tier_name_snapshot,
      volume_tier_order_snapshot, earned_tier_order_snapshot,
      required_delivery_rate, minimum_delivered_orders, extra_delivered_orders,
      tier_change_reason,
      calculated_salary, calculated_profit_bonus, calculated_extra_orders_bonus,
      system_calculated_total, final_approved_amount,
      workflow_status, calculated_at
    ) VALUES (
      _marketer_id, _year, _month, (inp->>'period_start')::date, (inp->>'period_end')::date,
      (res->>'shipped_orders_count')::integer, (res->>'delivered_orders_count')::integer,
      (res->>'delivery_rate')::numeric,
      (res->>'realized_commission')::numeric, (res->>'ad_spend')::numeric,
      (res->>'other_expenses')::numeric, (res->>'net_profit_before_bonus')::numeric,
      NULLIF(res->>'volume_tier_id','')::uuid, NULLIF(res->>'earned_tier_id','')::uuid,
      res->>'volume_tier_name_snapshot', res->>'earned_tier_name_snapshot',
      (res->>'volume_tier_order_snapshot')::integer, (res->>'earned_tier_order_snapshot')::integer,
      (res->>'required_delivery_rate')::numeric, (res->>'minimum_delivered_orders')::integer,
      (res->>'extra_delivered_orders')::integer,
      res->>'tier_change_reason',
      (res->>'calculated_salary')::numeric, (res->>'calculated_profit_bonus')::numeric,
      (res->>'calculated_extra_orders_bonus')::numeric,
      (res->>'system_calculated_total')::numeric, final_amt,
      'calculated', now()
    ) RETURNING id INTO bonus_id;
  ELSE
    action := 'recalculated';
    bonus_id := existing.id;
    -- replaces the calculation snapshot only: approvals, manual adjustment
    -- and payment columns are untouched
    UPDATE public.monthly_marketer_bonuses SET
      period_start = (inp->>'period_start')::date,
      period_end = (inp->>'period_end')::date,
      shipped_orders_count = (res->>'shipped_orders_count')::integer,
      delivered_orders_count = (res->>'delivered_orders_count')::integer,
      delivery_rate = (res->>'delivery_rate')::numeric,
      realized_commission = (res->>'realized_commission')::numeric,
      ad_spend = (res->>'ad_spend')::numeric,
      other_expenses = (res->>'other_expenses')::numeric,
      net_profit_before_bonus = (res->>'net_profit_before_bonus')::numeric,
      volume_tier_id = NULLIF(res->>'volume_tier_id','')::uuid,
      earned_tier_id = NULLIF(res->>'earned_tier_id','')::uuid,
      volume_tier_name_snapshot = res->>'volume_tier_name_snapshot',
      earned_tier_name_snapshot = res->>'earned_tier_name_snapshot',
      volume_tier_order_snapshot = (res->>'volume_tier_order_snapshot')::integer,
      earned_tier_order_snapshot = (res->>'earned_tier_order_snapshot')::integer,
      required_delivery_rate = (res->>'required_delivery_rate')::numeric,
      minimum_delivered_orders = (res->>'minimum_delivered_orders')::integer,
      extra_delivered_orders = (res->>'extra_delivered_orders')::integer,
      tier_change_reason = res->>'tier_change_reason',
      calculated_salary = (res->>'calculated_salary')::numeric,
      calculated_profit_bonus = (res->>'calculated_profit_bonus')::numeric,
      calculated_extra_orders_bonus = (res->>'calculated_extra_orders_bonus')::numeric,
      system_calculated_total = (res->>'system_calculated_total')::numeric,
      final_approved_amount = final_amt,
      remaining_amount = GREATEST(final_amt - COALESCE(total_paid_amount, 0), 0),
      workflow_status = CASE WHEN workflow_status = 'draft' THEN 'calculated' ELSE workflow_status END,
      recalculated_at = now()
    WHERE id = bonus_id;
  END IF;

  -- STEP 18: audit
  INSERT INTO public.bonus_audit_logs (
    monthly_bonus_id, marketer_id, action_type, field_name,
    old_value, new_value, reason, performed_by
  ) VALUES (
    bonus_id, _marketer_id, action, 'system_calculated_total',
    CASE WHEN existing.id IS NULL THEN NULL
         ELSE to_jsonb(existing.system_calculated_total) END,
    to_jsonb((res->>'system_calculated_total')::numeric),
    'Monthly bonus calculation engine', actor
  );

  RETURN res || jsonb_build_object(
    'id', bonus_id,
    'action', action,
    'manual_adjustment_amount', manual,
    'final_approved_amount', final_amt,
    'period_start', inp->>'period_start',
    'period_end', inp->>'period_end'
  );
END;
$$;

-- 5) Batch: calculate all active marketers for a month
CREATE OR REPLACE FUNCTION public.calculate_monthly_bonuses_for_month(
  _year integer,
  _month integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  m record;
  ok integer := 0;
  skipped integer := 0;
  errors jsonb := '[]'::jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can run the monthly batch calculation';
  END IF;

  FOR m IN SELECT id FROM public.marketers WHERE status = 'active' LOOP
    BEGIN
      PERFORM public.calculate_monthly_bonus(m.id, _year, _month);
      ok := ok + 1;
    EXCEPTION WHEN OTHERS THEN
      skipped := skipped + 1;
      errors := errors || jsonb_build_object('marketer_id', m.id, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('calculated', ok, 'skipped', skipped, 'errors', errors);
END;
$$;

REVOKE ALL ON FUNCTION public.compute_bonus_figures(integer,integer,numeric,numeric,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.load_bonus_month_inputs(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_monthly_bonus(uuid,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_monthly_bonus(uuid,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_monthly_bonuses_for_month(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_bonus_figures(integer,integer,numeric,numeric,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.load_bonus_month_inputs(uuid,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.preview_monthly_bonus(uuid,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.calculate_monthly_bonus(uuid,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.calculate_monthly_bonuses_for_month(integer,integer) TO service_role;
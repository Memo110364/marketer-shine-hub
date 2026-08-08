-- Delivery-rate tolerance + admin approval for near-miss tier downgrades.
-- If a marketer's actual delivery rate is within 5 percentage points of the
-- rate required for their volume tier (the tier their order count alone
-- would earn), flag the month as "قريب من التحقيق" so an admin can approve
-- bumping the tier back up in full (salary + profit % + extra-order bonus
-- all recomputed at the higher tier).

ALTER TABLE public.monthly_marketer_bonuses
  ADD COLUMN IF NOT EXISTS tier_downgrade_within_tolerance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tier_override_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tier_override_approved_by uuid,
  ADD COLUMN IF NOT EXISTS tier_override_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS tier_override_reason text;

-- 1) compute_bonus_figures: flag near-miss downgrades (5-point tolerance)
CREATE OR REPLACE FUNCTION public.compute_bonus_figures(
  _shipped_orders integer,
  _delivered_orders integer,
  _realized_commission numeric,
  _ad_spend numeric,
  _other_expenses numeric DEFAULT 0,
  _easy_order_cost numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  tolerance CONSTANT numeric(6,4) := 0.05;
  shipped integer := GREATEST(COALESCE(_shipped_orders, 0), 0);
  delivered integer := GREATEST(COALESCE(_delivered_orders, 0), 0);
  commission numeric(14,2) := COALESCE(_realized_commission, 0);
  ads numeric(14,2) := COALESCE(_ad_spend, 0);
  other numeric(14,2) := COALESCE(_other_expenses, 0);
  easy_order numeric(14,2) := COALESCE(_easy_order_cost, 0);
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
  within_tolerance boolean := false;
BEGIN
  IF shipped > 0 THEN
    rate := ROUND(delivered::numeric / shipped::numeric, 4);
  END IF;

  net := commission - ads - easy_order - other;

  SELECT * INTO training FROM public.bonus_tiers
   WHERE is_active AND tier_code = 'training' LIMIT 1;
  IF training.id IS NULL THEN
    SELECT * INTO training FROM public.bonus_tiers
     WHERE is_active ORDER BY tier_order ASC LIMIT 1;
  END IF;
  IF training.id IS NULL THEN
    RAISE EXCEPTION 'No active bonus tiers configured';
  END IF;

  SELECT * INTO vol FROM public.bonus_tiers
   WHERE is_active AND min_shipped_orders <= shipped
   ORDER BY tier_order DESC LIMIT 1;

  IF vol.id IS NULL THEN
    proportional := true;
    vol := training;
    earned := training;
    reason := 'below_minimum_volume_proportional_salary';
  ELSE
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
      IF rate >= (vol.minimum_delivery_rate - tolerance) THEN
        within_tolerance := true;
      END IF;
    END IF;
  END IF;

  IF proportional THEN
    salary := ROUND(training.base_salary * shipped::numeric
                    / NULLIF(training.min_shipped_orders, 0)::numeric, 2);
  ELSE
    salary := earned.base_salary;
  END IF;

  IF net > 0 THEN
    profit_bonus := ROUND(net * earned.bonus_percentage, 2);
  END IF;

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
    'easy_order_cost', easy_order,
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
    'tier_downgrade_within_tolerance', within_tolerance,
    'calculated_salary', salary,
    'calculated_profit_bonus', profit_bonus,
    'calculated_extra_orders_bonus', extra_bonus,
    'system_calculated_total', salary + profit_bonus + extra_bonus
  );
END;
$$;

-- 2) calculate_monthly_bonus: persist the tolerance flag, reset any prior
--    override on recalculation (a fresh calc needs a fresh admin decision)
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

  IF existing.id IS NOT NULL AND (existing.is_locked OR existing.workflow_status = 'locked') THEN
    RAISE EXCEPTION 'Bonus for %-% is locked and cannot be recalculated', _year, _month;
  END IF;

  inp := public.load_bonus_month_inputs(_marketer_id, _year, _month);
  res := public.compute_bonus_figures(
    (inp->>'shipped_orders_count')::integer,
    (inp->>'delivered_orders_count')::integer,
    (inp->>'realized_commission')::numeric,
    (inp->>'ad_spend')::numeric,
    (inp->>'other_expenses')::numeric,
    (inp->>'easy_order_cost')::numeric
  );

  manual := COALESCE(existing.manual_adjustment_amount, 0);
  final_amt := GREATEST((res->>'system_calculated_total')::numeric + manual, 0);

  IF existing.id IS NULL THEN
    action := 'calculated';
    INSERT INTO public.monthly_marketer_bonuses (
      marketer_id, bonus_year, bonus_month, period_start, period_end,
      shipped_orders_count, delivered_orders_count, delivery_rate,
      realized_commission, ad_spend, easy_order_cost, other_expenses, net_profit_before_bonus,
      volume_tier_id, earned_tier_id,
      volume_tier_name_snapshot, earned_tier_name_snapshot,
      volume_tier_order_snapshot, earned_tier_order_snapshot,
      required_delivery_rate, minimum_delivered_orders, extra_delivered_orders,
      tier_change_reason, tier_downgrade_within_tolerance,
      calculated_salary, calculated_profit_bonus, calculated_extra_orders_bonus,
      system_calculated_total, final_approved_amount,
      workflow_status, calculated_at
    ) VALUES (
      _marketer_id, _year, _month, (inp->>'period_start')::date, (inp->>'period_end')::date,
      (res->>'shipped_orders_count')::integer, (res->>'delivered_orders_count')::integer,
      (res->>'delivery_rate')::numeric,
      (res->>'realized_commission')::numeric, (res->>'ad_spend')::numeric,
      (res->>'easy_order_cost')::numeric,
      (res->>'other_expenses')::numeric, (res->>'net_profit_before_bonus')::numeric,
      NULLIF(res->>'volume_tier_id','')::uuid, NULLIF(res->>'earned_tier_id','')::uuid,
      res->>'volume_tier_name_snapshot', res->>'earned_tier_name_snapshot',
      (res->>'volume_tier_order_snapshot')::integer, (res->>'earned_tier_order_snapshot')::integer,
      (res->>'required_delivery_rate')::numeric, (res->>'minimum_delivered_orders')::integer,
      (res->>'extra_delivered_orders')::integer,
      res->>'tier_change_reason', COALESCE((res->>'tier_downgrade_within_tolerance')::boolean, false),
      (res->>'calculated_salary')::numeric, (res->>'calculated_profit_bonus')::numeric,
      (res->>'calculated_extra_orders_bonus')::numeric,
      (res->>'system_calculated_total')::numeric, final_amt,
      'calculated', now()
    ) RETURNING id INTO bonus_id;
  ELSE
    action := 'recalculated';
    bonus_id := existing.id;
    UPDATE public.monthly_marketer_bonuses SET
      period_start = (inp->>'period_start')::date,
      period_end = (inp->>'period_end')::date,
      shipped_orders_count = (res->>'shipped_orders_count')::integer,
      delivered_orders_count = (res->>'delivered_orders_count')::integer,
      delivery_rate = (res->>'delivery_rate')::numeric,
      realized_commission = (res->>'realized_commission')::numeric,
      ad_spend = (res->>'ad_spend')::numeric,
      easy_order_cost = (res->>'easy_order_cost')::numeric,
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
      tier_downgrade_within_tolerance = COALESCE((res->>'tier_downgrade_within_tolerance')::boolean, false),
      tier_override_approved = false,
      tier_override_approved_by = NULL,
      tier_override_approved_at = NULL,
      tier_override_reason = NULL,
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

-- 3) approve_bonus_tier_override: admin-only, bumps a near-miss month's
--    tier up to the full volume tier (salary + profit % + extra-order
--    bonus all recomputed at the higher tier), using the inputs already
--    stored on the snapshot (no need to re-query orders/spend).
CREATE OR REPLACE FUNCTION public.approve_bonus_tier_override(
  _bonus_id uuid,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  actor uuid := auth.uid();
  b public.monthly_marketer_bonuses%ROWTYPE;
  vol public.bonus_tiers%ROWTYPE;
  salary numeric(14,2) := 0;
  profit_bonus numeric(14,2) := 0;
  extra_bonus numeric(14,2) := 0;
  min_delivered integer := 0;
  extra_orders integer := 0;
  system_total numeric(14,2);
  final_amt numeric(14,2);
BEGIN
  IF actor IS NULL OR NOT has_role(actor, 'admin') THEN
    RAISE EXCEPTION 'Only admins can approve a tier override';
  END IF;

  SELECT * INTO b FROM public.monthly_marketer_bonuses WHERE id = _bonus_id FOR UPDATE;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'Bonus not found';
  END IF;
  IF b.is_locked OR b.workflow_status = 'locked' THEN
    RAISE EXCEPTION 'This month is locked and cannot be changed';
  END IF;
  IF NOT b.tier_downgrade_within_tolerance THEN
    RAISE EXCEPTION 'This month is not eligible for a tolerance override';
  END IF;
  IF b.tier_override_approved THEN
    RAISE EXCEPTION 'This month already has an approved override';
  END IF;

  SELECT * INTO vol FROM public.bonus_tiers WHERE id = b.volume_tier_id;
  IF vol.id IS NULL THEN
    RAISE EXCEPTION 'Volume tier no longer exists';
  END IF;

  salary := vol.base_salary;
  IF b.net_profit_before_bonus > 0 THEN
    profit_bonus := ROUND(b.net_profit_before_bonus * vol.bonus_percentage, 2);
  END IF;
  min_delivered := CEIL(b.shipped_orders_count::numeric * vol.minimum_delivery_rate)::integer;
  IF b.delivered_orders_count > min_delivered THEN
    extra_orders := b.delivered_orders_count - min_delivered;
    extra_bonus := ROUND(extra_orders::numeric * vol.extra_delivered_order_amount, 2);
  END IF;
  system_total := salary + profit_bonus + extra_bonus;
  final_amt := GREATEST(system_total + COALESCE(b.manual_adjustment_amount, 0), 0);

  UPDATE public.monthly_marketer_bonuses SET
    earned_tier_id = vol.id,
    earned_tier_name_snapshot = vol.tier_name_ar,
    earned_tier_order_snapshot = vol.tier_order,
    required_delivery_rate = vol.minimum_delivery_rate,
    minimum_delivered_orders = min_delivered,
    extra_delivered_orders = extra_orders,
    tier_change_reason = 'admin_approved_tolerance_override',
    calculated_salary = salary,
    calculated_profit_bonus = profit_bonus,
    calculated_extra_orders_bonus = extra_bonus,
    system_calculated_total = system_total,
    final_approved_amount = final_amt,
    remaining_amount = GREATEST(final_amt - COALESCE(total_paid_amount, 0), 0),
    tier_override_approved = true,
    tier_override_approved_by = actor,
    tier_override_approved_at = now(),
    tier_override_reason = _reason,
    recalculated_at = now()
  WHERE id = _bonus_id;

  INSERT INTO public.bonus_audit_logs (
    monthly_bonus_id, marketer_id, action_type, field_name,
    old_value, new_value, reason, performed_by
  ) VALUES (
    _bonus_id, b.marketer_id, 'tier_override_approved', 'earned_tier_name_snapshot',
    to_jsonb(b.earned_tier_name_snapshot), to_jsonb(vol.tier_name_ar),
    COALESCE(_reason, 'Admin approved tolerance override'), actor
  );

  RETURN jsonb_build_object(
    'id', _bonus_id,
    'earned_tier_name_snapshot', vol.tier_name_ar,
    'system_calculated_total', system_total,
    'final_approved_amount', final_amt
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_bonus_tier_override(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_bonus_tier_override(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_bonus_tier_override(uuid, text) TO service_role;

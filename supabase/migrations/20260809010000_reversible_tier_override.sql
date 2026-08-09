-- Make the delivery-rate tolerance admin override reversible, as long as no
-- money has been paid out yet for that month. Snapshot the pre-override
-- figures at approval time so a revoke can restore them exactly, and show
-- the pre-override entitlement alongside the approve button.

ALTER TABLE public.monthly_marketer_bonuses
  ADD COLUMN IF NOT EXISTS tier_override_pre_earned_tier_id uuid,
  ADD COLUMN IF NOT EXISTS tier_override_pre_earned_tier_name_snapshot text,
  ADD COLUMN IF NOT EXISTS tier_override_pre_earned_tier_order_snapshot integer,
  ADD COLUMN IF NOT EXISTS tier_override_pre_required_delivery_rate numeric(7,4),
  ADD COLUMN IF NOT EXISTS tier_override_pre_minimum_delivered_orders integer,
  ADD COLUMN IF NOT EXISTS tier_override_pre_extra_delivered_orders integer,
  ADD COLUMN IF NOT EXISTS tier_override_pre_calculated_salary numeric(14,2),
  ADD COLUMN IF NOT EXISTS tier_override_pre_calculated_profit_bonus numeric(14,2),
  ADD COLUMN IF NOT EXISTS tier_override_pre_calculated_extra_orders_bonus numeric(14,2),
  ADD COLUMN IF NOT EXISTS tier_override_pre_system_calculated_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS tier_override_pre_tier_change_reason text;

-- 1) approve_bonus_tier_override: snapshot the pre-override figures before
--    overwriting them, so a later revoke can restore this exact state.
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
    -- snapshot of the state before this approval, so it can be restored
    tier_override_pre_earned_tier_id = b.earned_tier_id,
    tier_override_pre_earned_tier_name_snapshot = b.earned_tier_name_snapshot,
    tier_override_pre_earned_tier_order_snapshot = b.earned_tier_order_snapshot,
    tier_override_pre_required_delivery_rate = b.required_delivery_rate,
    tier_override_pre_minimum_delivered_orders = b.minimum_delivered_orders,
    tier_override_pre_extra_delivered_orders = b.extra_delivered_orders,
    tier_override_pre_calculated_salary = b.calculated_salary,
    tier_override_pre_calculated_profit_bonus = b.calculated_profit_bonus,
    tier_override_pre_calculated_extra_orders_bonus = b.calculated_extra_orders_bonus,
    tier_override_pre_system_calculated_total = b.system_calculated_total,
    tier_override_pre_tier_change_reason = b.tier_change_reason,

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
    remaining_amount = GREATEST(final_amt - COALESCE(b.total_paid_amount, 0), 0),
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

-- 2) revoke_bonus_tier_override: admin-only, undoes a previously approved
--    tolerance override and restores the pre-approval figures exactly.
--    Only allowed while nothing has been paid out yet for the month.
CREATE OR REPLACE FUNCTION public.revoke_bonus_tier_override(
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
  final_amt numeric(14,2);
BEGIN
  IF actor IS NULL OR NOT has_role(actor, 'admin') THEN
    RAISE EXCEPTION 'Only admins can revoke a tier override';
  END IF;

  SELECT * INTO b FROM public.monthly_marketer_bonuses WHERE id = _bonus_id FOR UPDATE;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'Bonus not found';
  END IF;
  IF b.is_locked OR b.workflow_status = 'locked' THEN
    RAISE EXCEPTION 'This month is locked and cannot be changed';
  END IF;
  IF NOT b.tier_override_approved THEN
    RAISE EXCEPTION 'This month has no approved override to revoke';
  END IF;
  IF b.payment_status <> 'unpaid' OR COALESCE(b.total_paid_amount, 0) <> 0 THEN
    RAISE EXCEPTION 'Cannot revoke: part of this month''s payout has already been transferred';
  END IF;

  final_amt := GREATEST(
    COALESCE(b.tier_override_pre_system_calculated_total, 0) + COALESCE(b.manual_adjustment_amount, 0),
    0
  );

  UPDATE public.monthly_marketer_bonuses SET
    earned_tier_id = b.tier_override_pre_earned_tier_id,
    earned_tier_name_snapshot = b.tier_override_pre_earned_tier_name_snapshot,
    earned_tier_order_snapshot = b.tier_override_pre_earned_tier_order_snapshot,
    required_delivery_rate = b.tier_override_pre_required_delivery_rate,
    minimum_delivered_orders = b.tier_override_pre_minimum_delivered_orders,
    extra_delivered_orders = b.tier_override_pre_extra_delivered_orders,
    tier_change_reason = b.tier_override_pre_tier_change_reason,
    calculated_salary = b.tier_override_pre_calculated_salary,
    calculated_profit_bonus = b.tier_override_pre_calculated_profit_bonus,
    calculated_extra_orders_bonus = b.tier_override_pre_calculated_extra_orders_bonus,
    system_calculated_total = b.tier_override_pre_system_calculated_total,
    final_approved_amount = final_amt,
    remaining_amount = GREATEST(final_amt - COALESCE(b.total_paid_amount, 0), 0),

    tier_override_approved = false,
    tier_override_approved_by = NULL,
    tier_override_approved_at = NULL,
    tier_override_reason = NULL,
    tier_override_pre_earned_tier_id = NULL,
    tier_override_pre_earned_tier_name_snapshot = NULL,
    tier_override_pre_earned_tier_order_snapshot = NULL,
    tier_override_pre_required_delivery_rate = NULL,
    tier_override_pre_minimum_delivered_orders = NULL,
    tier_override_pre_extra_delivered_orders = NULL,
    tier_override_pre_calculated_salary = NULL,
    tier_override_pre_calculated_profit_bonus = NULL,
    tier_override_pre_calculated_extra_orders_bonus = NULL,
    tier_override_pre_system_calculated_total = NULL,
    tier_override_pre_tier_change_reason = NULL,
    recalculated_at = now()
  WHERE id = _bonus_id;

  INSERT INTO public.bonus_audit_logs (
    monthly_bonus_id, marketer_id, action_type, field_name,
    old_value, new_value, reason, performed_by
  ) VALUES (
    _bonus_id, b.marketer_id, 'tier_override_revoked', 'earned_tier_name_snapshot',
    to_jsonb(b.earned_tier_name_snapshot), to_jsonb(b.tier_override_pre_earned_tier_name_snapshot),
    COALESCE(_reason, 'Admin revoked tolerance override'), actor
  );

  RETURN jsonb_build_object(
    'id', _bonus_id,
    'earned_tier_name_snapshot', b.tier_override_pre_earned_tier_name_snapshot,
    'system_calculated_total', b.tier_override_pre_system_calculated_total,
    'final_approved_amount', final_amt
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_bonus_tier_override(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_bonus_tier_override(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_bonus_tier_override(uuid, text) TO service_role;

-- 3) calculate_monthly_bonus: also clear the pre-override snapshot on a
--    fresh recalculation (a fresh calc needs a fresh admin decision).
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
      tier_override_pre_earned_tier_id = NULL,
      tier_override_pre_earned_tier_name_snapshot = NULL,
      tier_override_pre_earned_tier_order_snapshot = NULL,
      tier_override_pre_required_delivery_rate = NULL,
      tier_override_pre_minimum_delivered_orders = NULL,
      tier_override_pre_extra_delivered_orders = NULL,
      tier_override_pre_calculated_salary = NULL,
      tier_override_pre_calculated_profit_bonus = NULL,
      tier_override_pre_calculated_extra_orders_bonus = NULL,
      tier_override_pre_system_calculated_total = NULL,
      tier_override_pre_tier_change_reason = NULL,
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

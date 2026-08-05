
-- ============ helper: authorization checks live in each function ============

-- A. submit_bonus_for_review
CREATE OR REPLACE FUNCTION public.submit_bonus_for_review(_monthly_bonus_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  actor uuid := auth.uid();
  b public.monthly_marketer_bonuses%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO b FROM public.monthly_marketer_bonuses WHERE id = _monthly_bonus_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Bonus record not found'; END IF;
  IF NOT (has_role(actor,'admin') OR (has_role(actor,'account_manager') AND is_my_marketer(b.marketer_id))) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF b.is_locked OR b.workflow_status = 'locked' THEN RAISE EXCEPTION 'Record is locked'; END IF;
  IF b.workflow_status NOT IN ('calculated','adjustment_proposed') THEN
    RAISE EXCEPTION 'Cannot start review from status %', b.workflow_status;
  END IF;

  UPDATE public.monthly_marketer_bonuses
     SET workflow_status = 'under_review', reviewed_by = actor, reviewed_at = now()
   WHERE id = _monthly_bonus_id;

  INSERT INTO public.bonus_audit_logs (monthly_bonus_id, marketer_id, action_type, field_name, old_value, new_value, reason, performed_by)
  VALUES (b.id, b.marketer_id, 'submitted_for_review', 'workflow_status',
          to_jsonb(b.workflow_status), to_jsonb('under_review'::text), NULL, actor);

  RETURN jsonb_build_object('id', b.id, 'workflow_status', 'under_review');
END; $$;

-- B. propose_bonus_adjustment
CREATE OR REPLACE FUNCTION public.propose_bonus_adjustment(
  _monthly_bonus_id uuid, _adjustment_amount numeric, _adjustment_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  actor uuid := auth.uid();
  b public.monthly_marketer_bonuses%ROWTYPE;
  amt numeric(14,2) := COALESCE(_adjustment_amount, 0);
  reason text := NULLIF(btrim(COALESCE(_adjustment_reason,'')), '');
  new_final numeric(14,2);
  new_status text;
  act text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO b FROM public.monthly_marketer_bonuses WHERE id = _monthly_bonus_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Bonus record not found'; END IF;
  IF NOT (has_role(actor,'admin') OR (has_role(actor,'account_manager') AND is_my_marketer(b.marketer_id))) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF b.is_locked OR b.workflow_status = 'locked' THEN RAISE EXCEPTION 'Record is locked'; END IF;
  IF b.workflow_status NOT IN ('calculated','under_review','adjustment_proposed') THEN
    RAISE EXCEPTION 'Cannot propose an adjustment from status %', b.workflow_status;
  END IF;
  IF amt <> 0 AND (reason IS NULL OR length(reason) < 5) THEN
    RAISE EXCEPTION 'A reason of at least 5 characters is required for a non-zero adjustment';
  END IF;

  IF amt = 0 THEN
    reason := NULL;
    new_status := 'under_review';
    act := CASE WHEN COALESCE(b.manual_adjustment_amount,0) <> 0 THEN 'adjustment_cleared' ELSE 'adjustment_proposed' END;
  ELSE
    new_status := 'adjustment_proposed';
    act := CASE WHEN COALESCE(b.manual_adjustment_amount,0) <> 0 THEN 'adjustment_changed' ELSE 'adjustment_proposed' END;
  END IF;

  new_final := GREATEST(b.system_calculated_total + amt, 0);

  UPDATE public.monthly_marketer_bonuses
     SET manual_adjustment_amount = amt,
         manual_adjustment_reason = reason,
         adjustment_proposed_by = CASE WHEN amt = 0 THEN NULL ELSE actor END,
         adjustment_proposed_at = CASE WHEN amt = 0 THEN NULL ELSE now() END,
         final_approved_amount = new_final,
         remaining_amount = GREATEST(new_final - COALESCE(total_paid_amount,0), 0),
         workflow_status = new_status
   WHERE id = _monthly_bonus_id;

  INSERT INTO public.bonus_audit_logs (monthly_bonus_id, marketer_id, action_type, field_name, old_value, new_value, reason, performed_by)
  VALUES (b.id, b.marketer_id, act, 'manual_adjustment_amount',
          jsonb_build_object('amount', b.manual_adjustment_amount, 'reason', b.manual_adjustment_reason, 'final', b.final_approved_amount),
          jsonb_build_object('amount', amt, 'reason', reason, 'final', new_final),
          reason, actor);

  RETURN jsonb_build_object('id', b.id, 'workflow_status', new_status,
                            'manual_adjustment_amount', amt, 'final_approved_amount', new_final);
END; $$;

-- C. approve_monthly_bonus
CREATE OR REPLACE FUNCTION public.approve_monthly_bonus(_monthly_bonus_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  actor uuid := auth.uid();
  b public.monthly_marketer_bonuses%ROWTYPE;
  expected numeric(14,2);
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT has_role(actor,'admin') THEN RAISE EXCEPTION 'Only admins can approve bonuses'; END IF;
  SELECT * INTO b FROM public.monthly_marketer_bonuses WHERE id = _monthly_bonus_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Bonus record not found'; END IF;
  IF b.is_locked OR b.workflow_status = 'locked' THEN RAISE EXCEPTION 'Record is locked'; END IF;
  IF b.workflow_status NOT IN ('under_review','adjustment_proposed') THEN
    RAISE EXCEPTION 'Cannot approve from status %', b.workflow_status;
  END IF;

  expected := GREATEST(b.system_calculated_total + COALESCE(b.manual_adjustment_amount,0), 0);
  IF b.final_approved_amount <> expected THEN
    RAISE EXCEPTION 'Final amount mismatch: stored % expected %', b.final_approved_amount, expected;
  END IF;

  UPDATE public.monthly_marketer_bonuses
     SET workflow_status = 'approved', approved_by = actor, approved_at = now()
   WHERE id = _monthly_bonus_id;

  INSERT INTO public.bonus_audit_logs (monthly_bonus_id, marketer_id, action_type, field_name, old_value, new_value, reason, performed_by)
  VALUES (b.id, b.marketer_id, 'approved', 'workflow_status',
          to_jsonb(b.workflow_status), to_jsonb('approved'::text), NULL, actor);

  RETURN jsonb_build_object('id', b.id, 'workflow_status', 'approved', 'final_approved_amount', expected);
END; $$;

-- D. lock_monthly_bonus
CREATE OR REPLACE FUNCTION public.lock_monthly_bonus(_monthly_bonus_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  actor uuid := auth.uid();
  b public.monthly_marketer_bonuses%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT has_role(actor,'admin') THEN RAISE EXCEPTION 'Only admins can lock a month'; END IF;
  SELECT * INTO b FROM public.monthly_marketer_bonuses WHERE id = _monthly_bonus_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Bonus record not found'; END IF;
  IF b.is_locked THEN RAISE EXCEPTION 'Record is already locked'; END IF;
  IF b.workflow_status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved records can be locked (current: %)', b.workflow_status;
  END IF;

  UPDATE public.monthly_marketer_bonuses
     SET workflow_status = 'locked', is_locked = true, locked_by = actor, locked_at = now()
   WHERE id = _monthly_bonus_id;

  INSERT INTO public.bonus_audit_logs (monthly_bonus_id, marketer_id, action_type, field_name, old_value, new_value, reason, performed_by)
  VALUES (b.id, b.marketer_id, 'locked', 'workflow_status',
          to_jsonb(b.workflow_status), to_jsonb('locked'::text), NULL, actor);

  RETURN jsonb_build_object('id', b.id, 'workflow_status', 'locked');
END; $$;

-- E. unlock_monthly_bonus
CREATE OR REPLACE FUNCTION public.unlock_monthly_bonus(_monthly_bonus_id uuid, _unlock_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  actor uuid := auth.uid();
  b public.monthly_marketer_bonuses%ROWTYPE;
  reason text := NULLIF(btrim(COALESCE(_unlock_reason,'')), '');
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT has_role(actor,'admin') THEN RAISE EXCEPTION 'Only admins can re-open a month'; END IF;
  IF reason IS NULL OR length(reason) < 5 THEN
    RAISE EXCEPTION 'An unlock reason of at least 5 characters is required';
  END IF;
  SELECT * INTO b FROM public.monthly_marketer_bonuses WHERE id = _monthly_bonus_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Bonus record not found'; END IF;
  IF NOT b.is_locked THEN RAISE EXCEPTION 'Record is not locked'; END IF;
  IF b.payment_status = 'paid' THEN
    RAISE EXCEPTION 'Cannot re-open a fully paid month';
  END IF;
  IF b.payment_status = 'partially_paid' THEN
    RAISE EXCEPTION 'Cannot re-open a partially paid month: review the recorded payments first';
  END IF;

  UPDATE public.monthly_marketer_bonuses
     SET is_locked = false, workflow_status = 'approved'
   WHERE id = _monthly_bonus_id;

  INSERT INTO public.bonus_audit_logs (monthly_bonus_id, marketer_id, action_type, field_name, old_value, new_value, reason, performed_by)
  VALUES (b.id, b.marketer_id, 'admin_unlocked', 'is_locked',
          jsonb_build_object('is_locked', true, 'workflow_status', b.workflow_status, 'locked_by', b.locked_by, 'locked_at', b.locked_at),
          jsonb_build_object('is_locked', false, 'workflow_status', 'approved'),
          reason, actor);

  RETURN jsonb_build_object('id', b.id, 'workflow_status', 'approved', 'is_locked', false);
END; $$;

-- ============ lock protection trigger ============
CREATE OR REPLACE FUNCTION public.protect_locked_bonus()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF OLD.is_locked THEN
    IF (NEW.shipped_orders_count, NEW.delivered_orders_count, NEW.delivery_rate,
        NEW.realized_commission, NEW.ad_spend, NEW.other_expenses, NEW.net_profit_before_bonus,
        NEW.volume_tier_id, NEW.earned_tier_id,
        NEW.volume_tier_name_snapshot, NEW.earned_tier_name_snapshot,
        NEW.volume_tier_order_snapshot, NEW.earned_tier_order_snapshot,
        NEW.calculated_salary, NEW.calculated_profit_bonus, NEW.calculated_extra_orders_bonus,
        NEW.system_calculated_total, NEW.manual_adjustment_amount, NEW.manual_adjustment_reason,
        NEW.final_approved_amount)
       IS DISTINCT FROM
       (OLD.shipped_orders_count, OLD.delivered_orders_count, OLD.delivery_rate,
        OLD.realized_commission, OLD.ad_spend, OLD.other_expenses, OLD.net_profit_before_bonus,
        OLD.volume_tier_id, OLD.earned_tier_id,
        OLD.volume_tier_name_snapshot, OLD.earned_tier_name_snapshot,
        OLD.volume_tier_order_snapshot, OLD.earned_tier_order_snapshot,
        OLD.calculated_salary, OLD.calculated_profit_bonus, OLD.calculated_extra_orders_bonus,
        OLD.system_calculated_total, OLD.manual_adjustment_amount, OLD.manual_adjustment_reason,
        OLD.final_approved_amount)
    THEN
      RAISE EXCEPTION 'This month is locked; re-open it before changing its figures';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS mmb_protect_locked ON public.monthly_marketer_bonuses;
CREATE TRIGGER mmb_protect_locked BEFORE UPDATE ON public.monthly_marketer_bonuses
FOR EACH ROW EXECUTE FUNCTION public.protect_locked_bonus();

-- ============ recalculation rules for approved (unlocked) records ============
CREATE OR REPLACE FUNCTION public.calculate_monthly_bonus(_marketer_id uuid, _year integer, _month integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  inp jsonb;
  res jsonb;
  existing public.monthly_marketer_bonuses%ROWTYPE;
  bonus_id uuid;
  manual numeric(14,2) := 0;
  final_amt numeric(14,2);
  action text;
  reset_approval boolean := false;
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

  IF existing.id IS NOT NULL AND existing.workflow_status = 'approved' THEN
    IF NOT has_role(actor, 'admin') THEN
      RAISE EXCEPTION 'Only admins can recalculate an approved month';
    END IF;
    reset_approval := true;
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
      approved_by = CASE WHEN reset_approval THEN NULL ELSE approved_by END,
      approved_at = CASE WHEN reset_approval THEN NULL ELSE approved_at END,
      workflow_status = CASE
        WHEN reset_approval THEN 'calculated'
        WHEN workflow_status = 'draft' THEN 'calculated'
        ELSE workflow_status END,
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
    CASE WHEN reset_approval THEN 'Recalculated after approval; approval cleared'
         ELSE 'Monthly bonus calculation engine' END,
    actor
  );

  RETURN res || jsonb_build_object(
    'id', bonus_id,
    'action', action,
    'approval_reset', reset_approval,
    'manual_adjustment_amount', manual,
    'final_approved_amount', final_amt,
    'period_start', inp->>'period_start',
    'period_end', inp->>'period_end'
  );
END;
$function$;

-- ============ grants ============
REVOKE ALL ON FUNCTION public.submit_bonus_for_review(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.propose_bonus_adjustment(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_monthly_bonus(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lock_monthly_bonus(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlock_monthly_bonus(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.submit_bonus_for_review(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.propose_bonus_adjustment(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_monthly_bonus(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lock_monthly_bonus(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unlock_monthly_bonus(uuid, text) TO authenticated, service_role;

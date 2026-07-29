-- 1. bonus_tiers
CREATE TABLE public.bonus_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_code text UNIQUE NOT NULL,
  tier_name_ar text NOT NULL,
  tier_name_en text,
  tier_order integer UNIQUE NOT NULL,
  min_shipped_orders integer NOT NULL,
  base_salary numeric(14,2) NOT NULL DEFAULT 0,
  bonus_percentage numeric(7,4) NOT NULL DEFAULT 0,
  minimum_delivery_rate numeric(7,4) NOT NULL DEFAULT 0,
  extra_delivered_order_amount numeric(14,2) NOT NULL DEFAULT 10,
  color_hex text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bonus_tiers_min_shipped_chk CHECK (min_shipped_orders >= 0),
  CONSTRAINT bonus_tiers_base_salary_chk CHECK (base_salary >= 0),
  CONSTRAINT bonus_tiers_bonus_pct_chk CHECK (bonus_percentage >= 0 AND bonus_percentage <= 1),
  CONSTRAINT bonus_tiers_min_delivery_chk CHECK (minimum_delivery_rate >= 0 AND minimum_delivery_rate <= 1),
  CONSTRAINT bonus_tiers_extra_amount_chk CHECK (extra_delivered_order_amount >= 0),
  CONSTRAINT bonus_tiers_color_chk CHECK (color_hex IS NULL OR color_hex ~* '^#[0-9a-f]{6}$')
);

GRANT SELECT ON public.bonus_tiers TO authenticated;
GRANT ALL ON public.bonus_tiers TO service_role;
ALTER TABLE public.bonus_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read active tiers"
ON public.bonus_tiers FOR SELECT TO authenticated
USING (is_active OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage tiers"
ON public.bonus_tiers FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER bonus_tiers_set_updated_at
BEFORE UPDATE ON public.bonus_tiers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.bonus_tiers
  (tier_code, tier_name_ar, tier_name_en, tier_order, min_shipped_orders, base_salary, bonus_percentage, minimum_delivery_rate, extra_delivered_order_amount, color_hex)
VALUES
  ('training', 'التدريبية', 'Training', 1, 500, 3000, 0.25, 0.50, 10, '#B98A5A'),
  ('basic', 'الأساسية', 'Basic', 2, 1000, 6000, 0.30, 0.45, 10, '#1F7A68'),
  ('diamond', 'الماس', 'Diamond', 3, 2000, 12000, 0.30, 0.45, 10, '#65A9C8'),
  ('gold', 'الجولد', 'Gold', 4, 3000, 15000, 0.40, 0.40, 10, '#C7A046')
ON CONFLICT (tier_code) DO NOTHING;

-- 2. monthly_marketer_bonuses
CREATE TABLE public.monthly_marketer_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id uuid NOT NULL REFERENCES public.marketers(id) ON DELETE CASCADE,
  bonus_year integer NOT NULL,
  bonus_month integer NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,

  shipped_orders_count integer NOT NULL DEFAULT 0,
  delivered_orders_count integer NOT NULL DEFAULT 0,
  delivery_rate numeric(7,4) NOT NULL DEFAULT 0,
  realized_commission numeric(14,2) NOT NULL DEFAULT 0,
  ad_spend numeric(14,2) NOT NULL DEFAULT 0,
  other_expenses numeric(14,2) NOT NULL DEFAULT 0,
  net_profit_before_bonus numeric(14,2) NOT NULL DEFAULT 0,

  volume_tier_id uuid REFERENCES public.bonus_tiers(id) ON DELETE SET NULL,
  earned_tier_id uuid REFERENCES public.bonus_tiers(id) ON DELETE SET NULL,
  volume_tier_name_snapshot text,
  earned_tier_name_snapshot text,
  volume_tier_order_snapshot integer,
  earned_tier_order_snapshot integer,
  required_delivery_rate numeric(7,4) NOT NULL DEFAULT 0,
  minimum_delivered_orders integer NOT NULL DEFAULT 0,
  extra_delivered_orders integer NOT NULL DEFAULT 0,
  tier_change_reason text,

  calculated_salary numeric(14,2) NOT NULL DEFAULT 0,
  calculated_profit_bonus numeric(14,2) NOT NULL DEFAULT 0,
  calculated_extra_orders_bonus numeric(14,2) NOT NULL DEFAULT 0,
  system_calculated_total numeric(14,2) NOT NULL DEFAULT 0,

  manual_adjustment_amount numeric(14,2) NOT NULL DEFAULT 0,
  manual_adjustment_reason text,
  adjustment_proposed_by uuid,
  adjustment_proposed_at timestamptz,

  final_approved_amount numeric(14,2) NOT NULL DEFAULT 0,
  reviewed_by uuid,
  reviewed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  locked_by uuid,
  locked_at timestamptz,
  is_locked boolean NOT NULL DEFAULT false,

  total_paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  remaining_amount numeric(14,2) NOT NULL DEFAULT 0,

  status text NOT NULL DEFAULT 'draft',
  calculated_at timestamptz,
  recalculated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mmb_unique_period UNIQUE (marketer_id, bonus_year, bonus_month),
  CONSTRAINT mmb_year_chk CHECK (bonus_year BETWEEN 2020 AND 2100),
  CONSTRAINT mmb_month_chk CHECK (bonus_month BETWEEN 1 AND 12),
  CONSTRAINT mmb_period_chk CHECK (period_end >= period_start),
  CONSTRAINT mmb_shipped_chk CHECK (shipped_orders_count >= 0),
  CONSTRAINT mmb_delivered_chk CHECK (delivered_orders_count >= 0),
  CONSTRAINT mmb_delivered_lte_shipped_chk CHECK (delivered_orders_count <= shipped_orders_count),
  CONSTRAINT mmb_delivery_rate_chk CHECK (delivery_rate >= 0 AND delivery_rate <= 1),
  CONSTRAINT mmb_required_rate_chk CHECK (required_delivery_rate >= 0 AND required_delivery_rate <= 1),
  CONSTRAINT mmb_min_delivered_chk CHECK (minimum_delivered_orders >= 0),
  CONSTRAINT mmb_extra_delivered_chk CHECK (extra_delivered_orders >= 0),
  CONSTRAINT mmb_commission_chk CHECK (realized_commission >= 0),
  CONSTRAINT mmb_ad_spend_chk CHECK (ad_spend >= 0),
  CONSTRAINT mmb_other_expenses_chk CHECK (other_expenses >= 0),
  CONSTRAINT mmb_salary_chk CHECK (calculated_salary >= 0),
  CONSTRAINT mmb_profit_bonus_chk CHECK (calculated_profit_bonus >= 0),
  CONSTRAINT mmb_extra_bonus_chk CHECK (calculated_extra_orders_bonus >= 0),
  CONSTRAINT mmb_system_total_chk CHECK (system_calculated_total >= 0),
  CONSTRAINT mmb_final_amount_chk CHECK (final_approved_amount >= 0),
  CONSTRAINT mmb_total_paid_chk CHECK (total_paid_amount >= 0),
  CONSTRAINT mmb_remaining_chk CHECK (remaining_amount >= 0),
  CONSTRAINT mmb_adjustment_reason_chk CHECK (
    manual_adjustment_amount = 0 OR (manual_adjustment_reason IS NOT NULL AND length(btrim(manual_adjustment_reason)) > 0)
  ),
  CONSTRAINT mmb_status_chk CHECK (status IN (
    'draft','calculated','under_review','adjustment_proposed','approved','locked','partially_paid','paid'
  ))
);

CREATE INDEX idx_mmb_marketer ON public.monthly_marketer_bonuses(marketer_id);
CREATE INDEX idx_mmb_period ON public.monthly_marketer_bonuses(bonus_year, bonus_month);
CREATE INDEX idx_mmb_status ON public.monthly_marketer_bonuses(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_marketer_bonuses TO authenticated;
GRANT ALL ON public.monthly_marketer_bonuses TO service_role;
ALTER TABLE public.monthly_marketer_bonuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to monthly bonuses"
ON public.monthly_marketer_bonuses FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Account managers read assigned monthly bonuses"
ON public.monthly_marketer_bonuses FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'account_manager') AND public.is_my_marketer(marketer_id));

CREATE POLICY "Account managers create draft monthly bonuses"
ON public.monthly_marketer_bonuses FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'account_manager')
  AND public.is_my_marketer(marketer_id)
  AND is_locked = false
  AND status IN ('draft','calculated')
);

CREATE POLICY "Account managers update unlocked assigned bonuses"
ON public.monthly_marketer_bonuses FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'account_manager')
  AND public.is_my_marketer(marketer_id)
  AND is_locked = false
  AND status IN ('draft','calculated','under_review','adjustment_proposed')
)
WITH CHECK (
  public.has_role(auth.uid(), 'account_manager')
  AND public.is_my_marketer(marketer_id)
  AND is_locked = false
  AND status IN ('draft','calculated','under_review','adjustment_proposed')
);

CREATE POLICY "Marketers read own finalized bonuses"
ON public.monthly_marketer_bonuses FOR SELECT TO authenticated
USING (
  marketer_id = public.current_marketer_id()
  AND status IN ('approved','locked','partially_paid','paid')
);

CREATE TRIGGER mmb_set_updated_at
BEFORE UPDATE ON public.monthly_marketer_bonuses
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. bonus_payments
CREATE TABLE public.bonus_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_bonus_id uuid NOT NULL REFERENCES public.monthly_marketer_bonuses(id) ON DELETE CASCADE,
  marketer_id uuid NOT NULL REFERENCES public.marketers(id) ON DELETE CASCADE,
  payment_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  payment_method text NOT NULL,
  reference_code text,
  notes text,
  proof_url text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bonus_payments_amount_chk CHECK (amount > 0),
  CONSTRAINT bonus_payments_method_chk CHECK (payment_method IN ('fawry','bank_transfer','wallet','cash','other'))
);

CREATE INDEX idx_bonus_payments_bonus ON public.bonus_payments(monthly_bonus_id);
CREATE INDEX idx_bonus_payments_marketer ON public.bonus_payments(marketer_id);
CREATE INDEX idx_bonus_payments_date ON public.bonus_payments(payment_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bonus_payments TO authenticated;
GRANT ALL ON public.bonus_payments TO service_role;
ALTER TABLE public.bonus_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to bonus payments"
ON public.bonus_payments FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Account managers read assigned bonus payments"
ON public.bonus_payments FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'account_manager') AND public.is_my_marketer(marketer_id));

CREATE POLICY "Marketers read own bonus payments"
ON public.bonus_payments FOR SELECT TO authenticated
USING (marketer_id = public.current_marketer_id());

-- 4. bonus_audit_logs
CREATE TABLE public.bonus_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_bonus_id uuid NOT NULL REFERENCES public.monthly_marketer_bonuses(id) ON DELETE CASCADE,
  marketer_id uuid NOT NULL REFERENCES public.marketers(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  field_name text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  performed_by uuid NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bonus_audit_bonus ON public.bonus_audit_logs(monthly_bonus_id);
CREATE INDEX idx_bonus_audit_marketer ON public.bonus_audit_logs(marketer_id);
CREATE INDEX idx_bonus_audit_performed_at ON public.bonus_audit_logs(performed_at);

GRANT SELECT, INSERT ON public.bonus_audit_logs TO authenticated;
GRANT ALL ON public.bonus_audit_logs TO service_role;
ALTER TABLE public.bonus_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit logs"
ON public.bonus_audit_logs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated append audit logs"
ON public.bonus_audit_logs FOR INSERT TO authenticated
WITH CHECK (performed_by = auth.uid());

-- audit logs are append-only: no UPDATE/DELETE policies exist
CREATE POLICY "No audit log updates"
ON public.bonus_audit_logs AS RESTRICTIVE FOR UPDATE TO authenticated, anon
USING (false);

CREATE POLICY "No audit log deletes"
ON public.bonus_audit_logs AS RESTRICTIVE FOR DELETE TO authenticated, anon
USING (false);

CREATE TRIGGER bonus_payments_set_updated_at
BEFORE UPDATE ON public.bonus_payments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. payment summary sync + overpayment guard
CREATE OR REPLACE FUNCTION public.sync_bonus_payment_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_id uuid;
  paid numeric(14,2);
  final_amt numeric(14,2);
  cur_status text;
  new_status text;
BEGIN
  target_id := COALESCE(NEW.monthly_bonus_id, OLD.monthly_bonus_id);

  SELECT COALESCE(SUM(amount), 0) INTO paid
  FROM public.bonus_payments WHERE monthly_bonus_id = target_id;

  SELECT final_approved_amount, status INTO final_amt, cur_status
  FROM public.monthly_marketer_bonuses WHERE id = target_id;

  IF TG_OP <> 'DELETE' AND paid > final_amt THEN
    RAISE EXCEPTION 'Total payments (%) exceed the approved bonus amount (%)', paid, final_amt;
  END IF;

  new_status := cur_status;
  IF cur_status IN ('approved','locked','partially_paid','paid') THEN
    IF paid = 0 THEN
      new_status := CASE WHEN cur_status IN ('partially_paid','paid') THEN 'approved' ELSE cur_status END;
    ELSIF paid < final_amt THEN
      new_status := 'partially_paid';
    ELSE
      new_status := 'paid';
    END IF;
  END IF;

  UPDATE public.monthly_marketer_bonuses
  SET total_paid_amount = paid,
      remaining_amount = GREATEST(final_amt - paid, 0),
      status = new_status
  WHERE id = target_id;

  RETURN NULL;
END;
$$;

CREATE TRIGGER bonus_payments_sync_totals
AFTER INSERT OR UPDATE OR DELETE ON public.bonus_payments
FOR EACH ROW EXECUTE FUNCTION public.sync_bonus_payment_totals();
-- 1. New columns
ALTER TABLE public.monthly_marketer_bonuses
  ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid';

-- 2. Migrate existing data
UPDATE public.monthly_marketer_bonuses SET
  workflow_status = CASE
    WHEN status IN ('draft','calculated','under_review','adjustment_proposed','approved','locked') THEN status
    WHEN is_locked = true OR locked_at IS NOT NULL THEN 'locked'
    WHEN approved_at IS NOT NULL THEN 'approved'
    ELSE 'approved'
  END,
  payment_status = CASE
    WHEN status = 'paid' THEN 'paid'
    WHEN status = 'partially_paid' THEN 'partially_paid'
    ELSE 'unpaid'
  END;

-- 3. Constraints
ALTER TABLE public.monthly_marketer_bonuses
  DROP CONSTRAINT IF EXISTS monthly_marketer_bonuses_workflow_status_check;
ALTER TABLE public.monthly_marketer_bonuses
  ADD CONSTRAINT monthly_marketer_bonuses_workflow_status_check
  CHECK (workflow_status IN ('draft','calculated','under_review','adjustment_proposed','approved','locked'));

ALTER TABLE public.monthly_marketer_bonuses
  DROP CONSTRAINT IF EXISTS monthly_marketer_bonuses_payment_status_check;
ALTER TABLE public.monthly_marketer_bonuses
  ADD CONSTRAINT monthly_marketer_bonuses_payment_status_check
  CHECK (payment_status IN ('unpaid','partially_paid','paid'));

COMMENT ON COLUMN public.monthly_marketer_bonuses.status IS
  'DEPRECATED - do not use. Replaced by workflow_status + payment_status.';

-- 4. Payment trigger updates payment_status only
CREATE OR REPLACE FUNCTION public.sync_bonus_payment_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  target_id uuid;
  paid numeric(14,2);
  final_amt numeric(14,2);
  new_pay_status text;
BEGIN
  target_id := COALESCE(NEW.monthly_bonus_id, OLD.monthly_bonus_id);

  SELECT COALESCE(SUM(amount), 0) INTO paid
  FROM public.bonus_payments WHERE monthly_bonus_id = target_id;

  SELECT final_approved_amount INTO final_amt
  FROM public.monthly_marketer_bonuses WHERE id = target_id;

  IF TG_OP <> 'DELETE' AND paid > final_amt THEN
    RAISE EXCEPTION 'Total payments (%) exceed the approved bonus amount (%)', paid, final_amt;
  END IF;

  IF paid = 0 THEN
    new_pay_status := 'unpaid';
  ELSIF paid < final_amt THEN
    new_pay_status := 'partially_paid';
  ELSE
    new_pay_status := 'paid';
  END IF;

  UPDATE public.monthly_marketer_bonuses
  SET total_paid_amount = paid,
      remaining_amount = GREATEST(final_amt - paid, 0),
      payment_status = new_pay_status
  WHERE id = target_id;

  RETURN NULL;
END;
$function$;

-- 5. RLS updates (bonus system tables only)
DROP POLICY IF EXISTS "Marketers read own finalized bonuses" ON public.monthly_marketer_bonuses;
CREATE POLICY "Marketers read own finalized bonuses"
ON public.monthly_marketer_bonuses FOR SELECT TO authenticated
USING (marketer_id = current_marketer_id() AND workflow_status IN ('approved','locked'));

DROP POLICY IF EXISTS "Account managers create draft monthly bonuses" ON public.monthly_marketer_bonuses;
CREATE POLICY "Account managers create draft monthly bonuses"
ON public.monthly_marketer_bonuses FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'account_manager') AND is_my_marketer(marketer_id)
  AND is_locked = false AND workflow_status IN ('draft','calculated')
);

DROP POLICY IF EXISTS "Account managers update unlocked assigned bonuses" ON public.monthly_marketer_bonuses;
CREATE POLICY "Account managers update unlocked assigned bonuses"
ON public.monthly_marketer_bonuses FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'account_manager') AND is_my_marketer(marketer_id)
  AND is_locked = false
  AND workflow_status IN ('draft','calculated','under_review','adjustment_proposed')
)
WITH CHECK (
  has_role(auth.uid(), 'account_manager') AND is_my_marketer(marketer_id)
  AND is_locked = false
  AND workflow_status IN ('draft','calculated','under_review','adjustment_proposed')
);
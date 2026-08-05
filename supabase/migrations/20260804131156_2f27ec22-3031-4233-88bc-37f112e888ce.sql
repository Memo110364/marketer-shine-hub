-- 1. Soft delete + update tracking fields
ALTER TABLE public.bonus_payments
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deletion_reason text,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS update_reason text;

CREATE INDEX IF NOT EXISTS idx_bonus_payments_active
  ON public.bonus_payments (monthly_bonus_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bonus_payments_marketer
  ON public.bonus_payments (marketer_id);

-- 2. Summary trigger ignores soft-deleted payments
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
  FROM public.bonus_payments
  WHERE monthly_bonus_id = target_id AND deleted_at IS NULL;

  SELECT final_approved_amount INTO final_amt
  FROM public.monthly_marketer_bonuses WHERE id = target_id;

  IF paid > final_amt THEN
    RAISE EXCEPTION 'مبلغ التحويل أكبر من المبلغ المتبقي.';
  END IF;

  IF final_amt <= 0 THEN
    new_pay_status := 'paid';
  ELSIF paid = 0 THEN
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

-- 3. Shared validation helper
CREATE OR REPLACE FUNCTION public.validate_bonus_payment_input(_payment_method text, _reference_code text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  ref text := NULLIF(btrim(COALESCE(_reference_code, '')), '');
BEGIN
  IF _payment_method NOT IN ('fawry','bank_transfer','wallet','cash','other') THEN
    RAISE EXCEPTION 'طريقة دفع غير صحيحة.';
  END IF;
  IF _payment_method IN ('fawry','bank_transfer','wallet') AND ref IS NULL THEN
    RAISE EXCEPTION 'الرقم المرجعي مطلوب لهذه الطريقة.';
  END IF;
  RETURN ref;
END;
$function$;

-- 4. add_bonus_payment
CREATE OR REPLACE FUNCTION public.add_bonus_payment(
  _monthly_bonus_id uuid,
  _payment_date date,
  _amount numeric,
  _payment_method text,
  _reference_code text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _proof_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  b public.monthly_marketer_bonuses%ROWTYPE;
  amt numeric(14,2) := ROUND(COALESCE(_amount, 0), 2);
  ref text;
  notes text := NULLIF(btrim(COALESCE(_notes,'')), '');
  proof text := NULLIF(btrim(COALESCE(_proof_url,'')), '');
  paid numeric(14,2);
  new_id uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT has_role(actor, 'admin') THEN RAISE EXCEPTION 'تسجيل الدفعات من صلاحيات الأدمن فقط.'; END IF;

  SELECT * INTO b FROM public.monthly_marketer_bonuses WHERE id = _monthly_bonus_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'سجل المستحقات غير موجود.'; END IF;
  IF b.workflow_status NOT IN ('approved','locked') THEN
    RAISE EXCEPTION 'لا يمكن تسجيل دفعة قبل اعتماد المستحقات.';
  END IF;
  IF b.final_approved_amount <= 0 THEN
    RAISE EXCEPTION 'لا توجد مستحقات مالية واجبة التحويل لهذا الشهر.';
  END IF;
  IF amt <= 0 THEN RAISE EXCEPTION 'مبلغ التحويل يجب أن يكون أكبر من صفر.'; END IF;
  IF _payment_date IS NULL THEN RAISE EXCEPTION 'تاريخ التحويل مطلوب.'; END IF;

  ref := public.validate_bonus_payment_input(_payment_method, _reference_code);

  SELECT COALESCE(SUM(amount),0) INTO paid FROM public.bonus_payments
   WHERE monthly_bonus_id = b.id AND deleted_at IS NULL;
  IF paid + amt > b.final_approved_amount THEN
    RAISE EXCEPTION 'مبلغ التحويل أكبر من المبلغ المتبقي.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bonus_payments
     WHERE monthly_bonus_id = b.id AND deleted_at IS NULL
       AND amount = amt AND payment_date = _payment_date
       AND COALESCE(reference_code,'') = COALESCE(ref,'')
  ) THEN
    RAISE EXCEPTION 'تم تسجيل دفعة مطابقة بالفعل.';
  END IF;

  INSERT INTO public.bonus_payments (
    monthly_bonus_id, marketer_id, payment_date, amount, payment_method,
    reference_code, notes, proof_url, created_by
  ) VALUES (
    b.id, b.marketer_id, _payment_date, amt, _payment_method, ref, notes, proof, actor
  ) RETURNING id INTO new_id;

  INSERT INTO public.bonus_audit_logs (monthly_bonus_id, marketer_id, action_type, field_name, old_value, new_value, reason, performed_by)
  VALUES (b.id, b.marketer_id, 'payment_added', 'bonus_payments',
          NULL,
          jsonb_build_object('payment_id', new_id, 'amount', amt, 'payment_date', _payment_date,
                             'payment_method', _payment_method, 'reference_code', ref),
          NULL, actor);

  SELECT COALESCE(SUM(amount),0) INTO paid FROM public.bonus_payments
   WHERE monthly_bonus_id = b.id AND deleted_at IS NULL;
  IF paid >= b.final_approved_amount THEN
    INSERT INTO public.bonus_audit_logs (monthly_bonus_id, marketer_id, action_type, field_name, old_value, new_value, reason, performed_by)
    VALUES (b.id, b.marketer_id, 'payment_completed', 'payment_status', NULL,
            jsonb_build_object('total_paid', paid), NULL, actor);
  END IF;

  RETURN jsonb_build_object('payment_id', new_id, 'total_paid', paid,
                            'remaining', GREATEST(b.final_approved_amount - paid, 0));
END;
$function$;

-- 5. update_bonus_payment
CREATE OR REPLACE FUNCTION public.update_bonus_payment(
  _payment_id uuid,
  _payment_date date,
  _amount numeric,
  _payment_method text,
  _update_reason text,
  _reference_code text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _proof_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  p public.bonus_payments%ROWTYPE;
  b public.monthly_marketer_bonuses%ROWTYPE;
  amt numeric(14,2) := ROUND(COALESCE(_amount, 0), 2);
  ref text;
  reason text := NULLIF(btrim(COALESCE(_update_reason,'')), '');
  notes text := NULLIF(btrim(COALESCE(_notes,'')), '');
  proof text := NULLIF(btrim(COALESCE(_proof_url,'')), '');
  others numeric(14,2);
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT has_role(actor, 'admin') THEN RAISE EXCEPTION 'تعديل الدفعات من صلاحيات الأدمن فقط.'; END IF;
  IF reason IS NULL OR length(reason) < 5 THEN RAISE EXCEPTION 'سبب التعديل مطلوب (5 أحرف على الأقل).'; END IF;

  SELECT * INTO p FROM public.bonus_payments WHERE id = _payment_id FOR UPDATE;
  IF p.id IS NULL OR p.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'الدفعة غير موجودة.'; END IF;

  SELECT * INTO b FROM public.monthly_marketer_bonuses WHERE id = p.monthly_bonus_id;
  IF b.workflow_status NOT IN ('approved','locked') THEN
    RAISE EXCEPTION 'لا يمكن تعديل الدفعات لهذا السجل.';
  END IF;
  IF amt <= 0 THEN RAISE EXCEPTION 'مبلغ التحويل يجب أن يكون أكبر من صفر.'; END IF;
  IF _payment_date IS NULL THEN RAISE EXCEPTION 'تاريخ التحويل مطلوب.'; END IF;

  ref := public.validate_bonus_payment_input(_payment_method, _reference_code);

  SELECT COALESCE(SUM(amount),0) INTO others FROM public.bonus_payments
   WHERE monthly_bonus_id = p.monthly_bonus_id AND deleted_at IS NULL AND id <> p.id;
  IF others + amt > b.final_approved_amount THEN
    RAISE EXCEPTION 'مبلغ التحويل أكبر من المبلغ المتبقي.';
  END IF;

  UPDATE public.bonus_payments
     SET payment_date = _payment_date, amount = amt, payment_method = _payment_method,
         reference_code = ref, notes = notes, proof_url = proof,
         updated_by = actor, update_reason = reason
   WHERE id = p.id;

  INSERT INTO public.bonus_audit_logs (monthly_bonus_id, marketer_id, action_type, field_name, old_value, new_value, reason, performed_by)
  VALUES (p.monthly_bonus_id, p.marketer_id, 'payment_updated', 'bonus_payments',
          jsonb_build_object('payment_id', p.id, 'amount', p.amount, 'payment_date', p.payment_date,
                             'payment_method', p.payment_method, 'reference_code', p.reference_code),
          jsonb_build_object('payment_id', p.id, 'amount', amt, 'payment_date', _payment_date,
                             'payment_method', _payment_method, 'reference_code', ref),
          reason, actor);

  RETURN jsonb_build_object('payment_id', p.id, 'total_paid', others + amt,
                            'remaining', GREATEST(b.final_approved_amount - (others + amt), 0));
END;
$function$;

-- 6. delete_bonus_payment (soft delete)
CREATE OR REPLACE FUNCTION public.delete_bonus_payment(
  _payment_id uuid,
  _delete_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  p public.bonus_payments%ROWTYPE;
  reason text := NULLIF(btrim(COALESCE(_delete_reason,'')), '');
  paid numeric(14,2);
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT has_role(actor, 'admin') THEN RAISE EXCEPTION 'حذف الدفعات من صلاحيات الأدمن فقط.'; END IF;
  IF reason IS NULL OR length(reason) < 5 THEN RAISE EXCEPTION 'سبب الحذف مطلوب (5 أحرف على الأقل).'; END IF;

  SELECT * INTO p FROM public.bonus_payments WHERE id = _payment_id FOR UPDATE;
  IF p.id IS NULL OR p.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'الدفعة غير موجودة.'; END IF;

  UPDATE public.bonus_payments
     SET deleted_at = now(), deleted_by = actor, deletion_reason = reason
   WHERE id = p.id;

  INSERT INTO public.bonus_audit_logs (monthly_bonus_id, marketer_id, action_type, field_name, old_value, new_value, reason, performed_by)
  VALUES (p.monthly_bonus_id, p.marketer_id, 'payment_deleted', 'bonus_payments',
          jsonb_build_object('payment_id', p.id, 'amount', p.amount, 'payment_date', p.payment_date,
                             'payment_method', p.payment_method, 'reference_code', p.reference_code),
          NULL, reason, actor);

  SELECT COALESCE(SUM(amount),0) INTO paid FROM public.bonus_payments
   WHERE monthly_bonus_id = p.monthly_bonus_id AND deleted_at IS NULL;

  RETURN jsonb_build_object('payment_id', p.id, 'total_paid', paid);
END;
$function$;

REVOKE ALL ON FUNCTION public.add_bonus_payment(uuid, date, numeric, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_bonus_payment(uuid, date, numeric, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_bonus_payment(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_bonus_payment_input(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_bonus_payment(uuid, date, numeric, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_bonus_payment(uuid, date, numeric, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_bonus_payment(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_bonus_payment_input(text, text) TO authenticated, service_role;
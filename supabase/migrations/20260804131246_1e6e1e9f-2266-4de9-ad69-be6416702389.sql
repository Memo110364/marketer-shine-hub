-- Payments are written only through the secure functions
DROP POLICY IF EXISTS "Admins full access to bonus payments" ON public.bonus_payments;
CREATE POLICY "Admins read bonus payments" ON public.bonus_payments
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));

-- Account managers can read audit history for their own marketers
DROP POLICY IF EXISTS "Account managers read assigned audit logs" ON public.bonus_audit_logs;
CREATE POLICY "Account managers read assigned audit logs" ON public.bonus_audit_logs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'account_manager') AND is_my_marketer(marketer_id));

-- Payment proof storage policies (private bucket)
DROP POLICY IF EXISTS "Admins manage payment proofs" ON storage.objects;
CREATE POLICY "Admins manage payment proofs" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'bonus-payment-proofs' AND has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'bonus-payment-proofs' AND has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Managers read assigned payment proofs" ON storage.objects;
CREATE POLICY "Managers read assigned payment proofs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'bonus-payment-proofs'
    AND has_role(auth.uid(), 'account_manager')
    AND is_my_marketer(NULLIF(split_part(name, '/', 1), '')::uuid)
  );

DROP POLICY IF EXISTS "Marketers read own payment proofs" ON storage.objects;
CREATE POLICY "Marketers read own payment proofs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'bonus-payment-proofs'
    AND NULLIF(split_part(name, '/', 1), '')::uuid = public.current_marketer_id()
  );
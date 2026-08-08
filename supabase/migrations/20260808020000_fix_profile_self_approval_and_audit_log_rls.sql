-- Security fixes found in architecture review (2026-08-08):
--
-- 1. "Users update own profile" had no WITH CHECK, so a non-admin could
--    UPDATE their own profiles.status to 'approved'/'rejected' from the
--    client and bypass the admin-approval gate entirely. RLS alone can't
--    cleanly express "this column may only change if the caller is admin",
--    so this is enforced with a BEFORE UPDATE trigger instead.
--
-- 2. "Authenticated append audit logs" on bonus_audit_logs only checked
--    performed_by = auth.uid(), so any authenticated user (not just
--    admins/account managers) could insert fabricated audit-log rows
--    against any marketer/bonus. Scoped it to the same admin/AM-for-their-
--    marketer pattern already used by every other write policy.

-- 1. Block non-admins from changing profiles.status themselves.
CREATE OR REPLACE FUNCTION public.prevent_self_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change profile status';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_self_status_change ON public.profiles;
CREATE TRIGGER profiles_prevent_self_status_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_status_change();

-- Explicit WITH CHECK for clarity/defense-in-depth (previously implied via
-- USING reuse, which only guarded row ownership, not column contents).
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 2. Scope bonus_audit_logs inserts to admins, or account managers for
--    their own marketers (same pattern as bonus_payments / other writes).
DROP POLICY IF EXISTS "Authenticated append audit logs" ON public.bonus_audit_logs;
CREATE POLICY "Admin/AM append audit logs"
ON public.bonus_audit_logs FOR INSERT TO authenticated
WITH CHECK (
  performed_by = auth.uid()
  AND (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'account_manager') AND public.is_my_marketer(marketer_id))
  )
);

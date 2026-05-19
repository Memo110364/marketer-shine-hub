-- 1. Status enum on profiles
DO $$ BEGIN
  CREATE TYPE public.user_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status public.user_status NOT NULL DEFAULT 'pending';

-- Existing users get approved (assume they were working before)
UPDATE public.profiles SET status = 'approved' WHERE status = 'pending';

-- 2. Update handle_new_user to keep status=pending by default (already default)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, status)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email, 'pending')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Ensure trigger exists on auth.users
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

-- 3. Helper: is current user an account manager for a given marketer?
CREATE OR REPLACE FUNCTION public.is_my_marketer(_marketer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.marketers
    WHERE id = _marketer_id AND account_manager_id = auth.uid()
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_my_marketer(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_my_marketer(uuid) TO authenticated;

-- 4. Update RLS so AM only sees their assigned marketers
DROP POLICY IF EXISTS "Admin/AM view all marketers" ON public.marketers;
CREATE POLICY "View marketers scoped"
  ON public.marketers FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (has_role(auth.uid(), 'account_manager'::app_role) AND account_manager_id = auth.uid())
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Admin/AM update marketers" ON public.marketers;
CREATE POLICY "Update marketers scoped"
  ON public.marketers FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (has_role(auth.uid(), 'account_manager'::app_role) AND account_manager_id = auth.uid())
  );

-- Orders: AM sees only orders of their marketers
DROP POLICY IF EXISTS "Orders read" ON public.orders;
CREATE POLICY "Orders read scoped"
  ON public.orders FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (has_role(auth.uid(), 'account_manager'::app_role) AND public.is_my_marketer(marketer_id))
    OR marketer_id = current_marketer_id()
  );

DROP POLICY IF EXISTS "Orders update AM" ON public.orders;
CREATE POLICY "Orders update scoped"
  ON public.orders FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (has_role(auth.uid(), 'account_manager'::app_role) AND public.is_my_marketer(marketer_id))
  );

-- Ad spend
DROP POLICY IF EXISTS "Ad spend read" ON public.ad_spend_transactions;
CREATE POLICY "Ad spend read scoped"
  ON public.ad_spend_transactions FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (has_role(auth.uid(), 'account_manager'::app_role) AND public.is_my_marketer(marketer_id))
    OR marketer_id = current_marketer_id()
  );

DROP POLICY IF EXISTS "Ad spend update AM" ON public.ad_spend_transactions;
CREATE POLICY "Ad spend update scoped"
  ON public.ad_spend_transactions FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (has_role(auth.uid(), 'account_manager'::app_role) AND public.is_my_marketer(marketer_id))
  );

-- Ad accounts
DROP POLICY IF EXISTS "Ad accounts read" ON public.ad_accounts;
CREATE POLICY "Ad accounts read scoped"
  ON public.ad_accounts FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (has_role(auth.uid(), 'account_manager'::app_role) AND (marketer_id IS NULL OR public.is_my_marketer(marketer_id)))
    OR (marketer_id = current_marketer_id())
  );

DROP POLICY IF EXISTS "Ad accounts write AM" ON public.ad_accounts;
CREATE POLICY "Ad accounts write scoped"
  ON public.ad_accounts FOR ALL
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (has_role(auth.uid(), 'account_manager'::app_role) AND (marketer_id IS NULL OR public.is_my_marketer(marketer_id)))
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (has_role(auth.uid(), 'account_manager'::app_role) AND (marketer_id IS NULL OR public.is_my_marketer(marketer_id)))
  );

-- 5. Admin can update profile status (already covered by "Admins manage profiles") - no change needed

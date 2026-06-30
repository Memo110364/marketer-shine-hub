
-- 1. ad_account_secrets table (admin/service-role only)
CREATE TABLE IF NOT EXISTS public.ad_account_secrets (
  ad_account_id uuid PRIMARY KEY REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.ad_account_secrets TO service_role;
-- intentionally no grants to anon/authenticated

ALTER TABLE public.ad_account_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read ad account secrets"
  ON public.ad_account_secrets FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_ad_account_secrets_updated_at
  BEFORE UPDATE ON public.ad_account_secrets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill from existing ad_accounts
INSERT INTO public.ad_account_secrets (ad_account_id, access_token, token_expires_at)
SELECT id, access_token, token_expires_at
  FROM public.ad_accounts
 WHERE access_token IS NOT NULL
ON CONFLICT (ad_account_id) DO NOTHING;

-- Drop the sensitive columns from ad_accounts
ALTER TABLE public.ad_accounts DROP COLUMN IF EXISTS access_token;
ALTER TABLE public.ad_accounts DROP COLUMN IF EXISTS token_expires_at;

-- 2. meta_oauth_sessions: explicit deny-all policies for clarity (service role bypasses RLS)
DROP POLICY IF EXISTS "Deny all access to meta_oauth_sessions" ON public.meta_oauth_sessions;
CREATE POLICY "Deny all access to meta_oauth_sessions"
  ON public.meta_oauth_sessions
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Revoke any direct grants from anon/authenticated to be safe
REVOKE ALL ON public.meta_oauth_sessions FROM anon, authenticated;
GRANT ALL ON public.meta_oauth_sessions TO service_role;

-- 3. profiles SELECT policy: account managers only see their assigned marketers' profiles
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "Users view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (
      public.has_role(auth.uid(), 'account_manager')
      AND EXISTS (
        SELECT 1 FROM public.marketers m
        WHERE m.account_manager_id = auth.uid()
          AND m.user_id = public.profiles.id
      )
    )
  );

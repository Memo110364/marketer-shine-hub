
-- Extend ad_accounts with new fields
ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS external_account_id text,
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'EGP',
  ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'not_connected',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.ad_accounts
  DROP CONSTRAINT IF EXISTS ad_accounts_connection_status_check;
ALTER TABLE public.ad_accounts
  ADD CONSTRAINT ad_accounts_connection_status_check
  CHECK (connection_status IN ('not_connected','connected','expired','error'));

DROP TRIGGER IF EXISTS trg_ad_accounts_updated_at ON public.ad_accounts;
CREATE TRIGGER trg_ad_accounts_updated_at
BEFORE UPDATE ON public.ad_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ad_spend_daily
CREATE TABLE IF NOT EXISTS public.ad_spend_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id uuid NOT NULL,
  ad_account_id uuid REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  platform public.ad_platform NOT NULL DEFAULT 'manual',
  spend_date date NOT NULL,
  spend_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EGP',
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','meta_api','tiktok_api')),
  sync_status text NOT NULL DEFAULT 'ok',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_account_id, spend_date, source)
);

ALTER TABLE public.ad_spend_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ad spend daily read scoped" ON public.ad_spend_daily
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'account_manager'::app_role) AND is_my_marketer(marketer_id))
  OR marketer_id = current_marketer_id()
);

CREATE POLICY "Ad spend daily write AM" ON public.ad_spend_daily
FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'account_manager'::app_role) AND is_my_marketer(marketer_id))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'account_manager'::app_role) AND is_my_marketer(marketer_id))
);

CREATE TRIGGER trg_ad_spend_daily_updated_at
BEFORE UPDATE ON public.ad_spend_daily
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- integration_sync_logs
CREATE TABLE IF NOT EXISTS public.integration_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform public.ad_platform NOT NULL,
  ad_account_id uuid REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  marketer_id uuid,
  sync_started_at timestamptz NOT NULL DEFAULT now(),
  sync_finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  records_created integer NOT NULL DEFAULT 0,
  records_updated integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.integration_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sync logs read scoped" ON public.integration_sync_logs
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'account_manager'::app_role) AND (marketer_id IS NULL OR is_my_marketer(marketer_id)))
  OR marketer_id = current_marketer_id()
);

CREATE POLICY "Sync logs write admin/AM" ON public.integration_sync_logs
FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'account_manager'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'account_manager'::app_role)
);

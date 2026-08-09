-- Phase 1 of ad-account integration: campaign-level tracking.
-- ad_accounts/ad_spend_daily only track the whole Meta ad account. This adds
-- a campaign layer underneath it (spend/impressions/clicks/results per
-- campaign per day, synced from the Meta Insights API), plus an optional
-- manual link from orders to a campaign for marketers whose orders come in
-- via untracked channels (phone/WhatsApp + Excel import, no pixel/CAPI).

-- ============ AD CAMPAIGNS ============
CREATE TABLE public.ad_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  marketer_id uuid REFERENCES public.marketers(id) ON DELETE SET NULL,
  platform public.ad_platform NOT NULL DEFAULT 'meta',
  external_campaign_id text NOT NULL,
  name text NOT NULL,
  objective text,
  status text,
  daily_budget numeric(14,2),
  lifetime_budget numeric(14,2),
  currency text NOT NULL DEFAULT 'EGP',
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_campaigns_unique_external UNIQUE (ad_account_id, external_campaign_id)
);

CREATE INDEX idx_ad_campaigns_account ON public.ad_campaigns(ad_account_id);
CREATE INDEX idx_ad_campaigns_marketer ON public.ad_campaigns(marketer_id);

ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ad campaigns read scoped" ON public.ad_campaigns
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'account_manager'::app_role) AND (marketer_id IS NULL OR is_my_marketer(marketer_id)))
  OR marketer_id = current_marketer_id()
);

CREATE POLICY "Ad campaigns write AM" ON public.ad_campaigns
FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'account_manager'::app_role) AND (marketer_id IS NULL OR is_my_marketer(marketer_id)))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'account_manager'::app_role) AND (marketer_id IS NULL OR is_my_marketer(marketer_id)))
);

CREATE TRIGGER trg_ad_campaigns_updated_at
BEFORE UPDATE ON public.ad_campaigns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- service role (edge function) needs full write access regardless of RLS bypass assumptions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_campaigns TO authenticated;
GRANT ALL ON public.ad_campaigns TO service_role;

-- ============ AD CAMPAIGN INSIGHTS DAILY ============
CREATE TABLE public.ad_campaign_insights_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,
  marketer_id uuid REFERENCES public.marketers(id) ON DELETE SET NULL,
  insight_date date NOT NULL,
  spend_amount numeric(14,2) NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  reach bigint NOT NULL DEFAULT 0,
  ctr numeric(9,6),
  -- generic results bucket: Meta reports different "action_type"s depending
  -- on campaign objective (leads, messaging conversations, purchases, ...).
  -- We store the raw breakdown plus a best-guess primary count/cost so the
  -- UI has something simple to show without hardcoding one objective type.
  results_breakdown jsonb,
  primary_result_type text,
  primary_result_count numeric(14,2),
  cost_per_result numeric(14,2),
  currency text NOT NULL DEFAULT 'EGP',
  source text NOT NULL DEFAULT 'meta_api' CHECK (source IN ('meta_api','tiktok_api')),
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_campaign_insights_unique UNIQUE (campaign_id, insight_date, source)
);

CREATE INDEX idx_campaign_insights_campaign ON public.ad_campaign_insights_daily(campaign_id);
CREATE INDEX idx_campaign_insights_marketer ON public.ad_campaign_insights_daily(marketer_id);
CREATE INDEX idx_campaign_insights_date ON public.ad_campaign_insights_daily(insight_date);

ALTER TABLE public.ad_campaign_insights_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Campaign insights read scoped" ON public.ad_campaign_insights_daily
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'account_manager'::app_role) AND (marketer_id IS NULL OR is_my_marketer(marketer_id)))
  OR marketer_id = current_marketer_id()
);

CREATE POLICY "Campaign insights write AM" ON public.ad_campaign_insights_daily
FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'account_manager'::app_role) AND (marketer_id IS NULL OR is_my_marketer(marketer_id)))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'account_manager'::app_role) AND (marketer_id IS NULL OR is_my_marketer(marketer_id)))
);

CREATE TRIGGER trg_campaign_insights_updated_at
BEFORE UPDATE ON public.ad_campaign_insights_daily
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_campaign_insights_daily TO authenticated;
GRANT ALL ON public.ad_campaign_insights_daily TO service_role;

-- ============ OPTIONAL ORDER → CAMPAIGN LINK ============
-- Best-effort manual attribution: account managers can tag which campaign a
-- batch of imported orders came from, when they know it. Left null when not
-- known — reporting then falls back to marketer-level totals.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.ad_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_campaign ON public.orders(campaign_id);

-- Performance audit found 106 findings, the two actionable/safe ones fixed
-- here (multiple_permissive_policies and unused_index are left for a
-- separate, lower-priority pass since consolidating overlapping policies
-- risks changing authorization semantics if done carelessly):
--
-- 1. 14 foreign key columns had no supporting index, slowing every join
--    or cascade check through them (e.g. orders.import_batch_id,
--    marketers.account_manager_id). Purely additive — no risk to
--    existing data or behavior.
--
-- 2. 54 RLS policies called auth.uid() directly in USING/WITH CHECK,
--    which Postgres re-evaluates once per row instead of once per query
--    (the "auth_rls_initplan" advisor warning). On orders (~14k rows)
--    and order_status_history (~29k rows) this means auth.uid() was
--    being called tens of thousands of times per page load. Wrapping it
--    as (select auth.uid()) lets Postgres cache the result for the
--    whole query — same authorization logic, just evaluated once.
--    Every policy below is verified byte-for-byte identical to its
--    current definition except for that wrapping (see pg_policies
--    qual/with_check captured before this migration).

CREATE INDEX IF NOT EXISTS idx_ad_spend_change_requests_requested_by ON public.ad_spend_change_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_ad_spend_change_requests_reviewed_by ON public.ad_spend_change_requests(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_ad_spend_change_requests_transaction_id ON public.ad_spend_change_requests(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ad_spend_transactions_ad_account_id ON public.ad_spend_transactions(ad_account_id);
CREATE INDEX IF NOT EXISTS idx_ad_spend_transactions_created_by ON public.ad_spend_transactions(created_by);
CREATE INDEX IF NOT EXISTS idx_column_mappings_created_by ON public.column_mappings(created_by);
CREATE INDEX IF NOT EXISTS idx_import_batches_created_by ON public.import_batches(created_by);
CREATE INDEX IF NOT EXISTS idx_integration_sync_logs_ad_account_id ON public.integration_sync_logs(ad_account_id);
CREATE INDEX IF NOT EXISTS idx_marketers_account_manager_id ON public.marketers(account_manager_id);
CREATE INDEX IF NOT EXISTS idx_meta_oauth_sessions_user_id ON public.meta_oauth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_monthly_marketer_bonuses_earned_tier_id ON public.monthly_marketer_bonuses(earned_tier_id);
CREATE INDEX IF NOT EXISTS idx_monthly_marketer_bonuses_volume_tier_id ON public.monthly_marketer_bonuses(volume_tier_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_import_batch_id ON public.order_status_history(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_orders_import_batch_id ON public.orders(import_batch_id);

ALTER POLICY "Admins can read ad account secrets" ON public.ad_account_secrets USING (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY "Ad accounts read scoped" ON public.ad_accounts USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND ((marketer_id IS NULL) OR is_my_marketer(marketer_id))) OR (marketer_id = current_marketer_id())));
ALTER POLICY "Ad accounts write scoped" ON public.ad_accounts USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND ((marketer_id IS NULL) OR is_my_marketer(marketer_id))))) WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND ((marketer_id IS NULL) OR is_my_marketer(marketer_id)))));
ALTER POLICY "Campaign insights read scoped" ON public.ad_campaign_insights_daily USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND ((marketer_id IS NULL) OR is_my_marketer(marketer_id))) OR (marketer_id = current_marketer_id())));
ALTER POLICY "Campaign insights write AM" ON public.ad_campaign_insights_daily USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND ((marketer_id IS NULL) OR is_my_marketer(marketer_id))))) WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND ((marketer_id IS NULL) OR is_my_marketer(marketer_id)))));
ALTER POLICY "Ad campaigns read scoped" ON public.ad_campaigns USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND ((marketer_id IS NULL) OR is_my_marketer(marketer_id))) OR (marketer_id = current_marketer_id())));
ALTER POLICY "Ad campaigns write AM" ON public.ad_campaigns USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND ((marketer_id IS NULL) OR is_my_marketer(marketer_id))))) WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND ((marketer_id IS NULL) OR is_my_marketer(marketer_id)))));
ALTER POLICY "Change req delete owner pending" ON public.ad_spend_change_requests USING ((has_role((select auth.uid()), 'admin'::app_role) OR ((requested_by = (select auth.uid())) AND (status = 'pending'::text))));
ALTER POLICY "Change req insert AM" ON public.ad_spend_change_requests WITH CHECK (((requested_by = (select auth.uid())) AND (has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id)))));
ALTER POLICY "Change req read scoped" ON public.ad_spend_change_requests USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id)) OR (requested_by = (select auth.uid()))));
ALTER POLICY "Change req update admin" ON public.ad_spend_change_requests USING (has_role((select auth.uid()), 'admin'::app_role)) WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY "Ad spend daily read scoped" ON public.ad_spend_daily USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id)) OR (marketer_id = current_marketer_id())));
ALTER POLICY "Ad spend daily write AM" ON public.ad_spend_daily USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id)))) WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id))));
ALTER POLICY "Ad spend delete admin" ON public.ad_spend_transactions USING (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY "Ad spend insert AM" ON public.ad_spend_transactions WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role)));
ALTER POLICY "Ad spend read scoped" ON public.ad_spend_transactions USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id)) OR (marketer_id = current_marketer_id())));
ALTER POLICY "Ad spend update scoped" ON public.ad_spend_transactions USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id))));
ALTER POLICY "Admin/AM append audit logs" ON public.bonus_audit_logs WITH CHECK (((performed_by = (select auth.uid())) AND (has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id)))));
ALTER POLICY "Admins read audit logs" ON public.bonus_audit_logs USING (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY "Account managers read assigned bonus payments" ON public.bonus_payments USING ((has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id)));
ALTER POLICY "Admins full access to bonus payments" ON public.bonus_payments USING (has_role((select auth.uid()), 'admin'::app_role)) WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY "Admins manage tiers" ON public.bonus_tiers USING (has_role((select auth.uid()), 'admin'::app_role)) WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY "Authenticated can read active tiers" ON public.bonus_tiers USING ((is_active OR has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY "Mappings read AM" ON public.column_mappings USING ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role)));
ALTER POLICY "Mappings write AM" ON public.column_mappings USING ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role))) WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role)));
ALTER POLICY "Batches read AM" ON public.import_batches USING ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role)));
ALTER POLICY "Batches write AM" ON public.import_batches USING ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role))) WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role)));
ALTER POLICY "Sync logs read scoped" ON public.integration_sync_logs USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND ((marketer_id IS NULL) OR is_my_marketer(marketer_id))) OR (marketer_id = current_marketer_id())));
ALTER POLICY "Sync logs write admin/AM" ON public.integration_sync_logs USING ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role))) WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role)));
ALTER POLICY "Admin delete marketers" ON public.marketers USING (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY "Admin/AM insert marketers" ON public.marketers WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role)));
ALTER POLICY "Update marketers scoped" ON public.marketers USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND (account_manager_id = (select auth.uid())))));
ALTER POLICY "View marketers scoped" ON public.marketers USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND (account_manager_id = (select auth.uid()))) OR (user_id = (select auth.uid()))));
ALTER POLICY "Account managers create draft monthly bonuses" ON public.monthly_marketer_bonuses WITH CHECK ((has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id) AND (is_locked = false) AND (workflow_status = ANY (ARRAY['draft'::text, 'calculated'::text]))));
ALTER POLICY "Account managers read assigned monthly bonuses" ON public.monthly_marketer_bonuses USING ((has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id)));
ALTER POLICY "Account managers update unlocked assigned bonuses" ON public.monthly_marketer_bonuses USING ((has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id) AND (is_locked = false) AND (workflow_status = ANY (ARRAY['draft'::text, 'calculated'::text, 'under_review'::text, 'adjustment_proposed'::text])))) WITH CHECK ((has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id) AND (is_locked = false) AND (workflow_status = ANY (ARRAY['draft'::text, 'calculated'::text, 'under_review'::text, 'adjustment_proposed'::text]))));
ALTER POLICY "Admins full access to monthly bonuses" ON public.monthly_marketer_bonuses USING (has_role((select auth.uid()), 'admin'::app_role)) WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY "Order items delete admin/AM" ON public.order_items USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id))));
ALTER POLICY "Order items insert AM" ON public.order_items WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role)));
ALTER POLICY "Order items read scoped" ON public.order_items USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id)) OR (marketer_id = current_marketer_id())));
ALTER POLICY "Order items update scoped" ON public.order_items USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id))));
ALTER POLICY "Order history insert AM" ON public.order_status_history WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role)));
ALTER POLICY "Order history read scoped" ON public.order_status_history USING ((has_role((select auth.uid()), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_status_history.order_id) AND ((has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(o.marketer_id)) OR (o.marketer_id = current_marketer_id())))))));
ALTER POLICY "Orders delete admin" ON public.orders USING (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY "Orders insert AM" ON public.orders WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role)));
ALTER POLICY "Orders read scoped" ON public.orders USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id)) OR (marketer_id = current_marketer_id())));
ALTER POLICY "Orders update scoped" ON public.orders USING ((has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND is_my_marketer(marketer_id))));
ALTER POLICY "Admin/AM write products" ON public.products USING ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role))) WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role)));
ALTER POLICY "Admins manage profiles" ON public.profiles USING (has_role((select auth.uid()), 'admin'::app_role)) WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY "Users update own profile" ON public.profiles USING ((id = (select auth.uid()))) WITH CHECK ((id = (select auth.uid())));
ALTER POLICY "Users view own profile" ON public.profiles USING (((id = (select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role) OR (has_role((select auth.uid()), 'account_manager'::app_role) AND (EXISTS ( SELECT 1
   FROM marketers m
  WHERE ((m.account_manager_id = (select auth.uid())) AND (m.user_id = profiles.id)))))));
ALTER POLICY "Admin/AM write shipping" ON public.shipping_companies USING ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role))) WITH CHECK ((has_role((select auth.uid()), 'admin'::app_role) OR has_role((select auth.uid()), 'account_manager'::app_role)));
ALTER POLICY "Admins manage roles" ON public.user_roles USING (has_role((select auth.uid()), 'admin'::app_role)) WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));
ALTER POLICY "Users view own roles" ON public.user_roles USING (((user_id = (select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role)));

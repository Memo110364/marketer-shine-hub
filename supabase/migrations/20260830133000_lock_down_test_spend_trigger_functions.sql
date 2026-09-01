-- Trigger functions are never meant to be called directly, but PostgREST
-- exposes every public-schema function as an RPC endpoint by default.
-- Same treatment as prevent_self_status_change (see
-- 20260812130000_lock_down_bonus_helper_functions.sql).
REVOKE EXECUTE ON FUNCTION public.assert_test_spend_within_funding()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.reject_test_ads_transactions()
  FROM PUBLIC, anon, authenticated;

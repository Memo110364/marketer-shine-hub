
REVOKE ALL ON FUNCTION public.calculate_monthly_bonus(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calculate_monthly_bonuses_for_month(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.preview_monthly_bonus(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.compute_bonus_figures(integer, integer, numeric, numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.load_bonus_month_inputs(uuid, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.calculate_monthly_bonus(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calculate_monthly_bonuses_for_month(integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_monthly_bonus(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_bonus_figures(integer, integer, numeric, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.load_bonus_month_inputs(uuid, integer, integer) TO authenticated, service_role;

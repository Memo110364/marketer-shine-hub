CREATE OR REPLACE FUNCTION public.preview_bonus_scenario(
  _marketer_id uuid,
  _year integer,
  _month integer,
  _extra_shipped integer DEFAULT 0,
  _extra_delivered integer DEFAULT 0,
  _extra_commission numeric DEFAULT 0,
  _extra_ad_spend numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.monthly_marketer_bonuses%ROWTYPE;
  add_shipped integer := COALESCE(_extra_shipped, 0);
  add_delivered integer := COALESCE(_extra_delivered, 0);
  add_commission numeric := COALESCE(_extra_commission, 0);
  add_ads numeric := COALESCE(_extra_ad_spend, 0);
  proj_shipped integer;
  proj_delivered integer;
BEGIN
  IF NOT (
    has_role(auth.uid(), 'admin')
    OR (has_role(auth.uid(), 'account_manager') AND is_my_marketer(_marketer_id))
    OR (public.current_marketer_id() = _marketer_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF add_shipped < 0 OR add_delivered < 0 OR add_commission < 0 OR add_ads < 0 THEN
    RAISE EXCEPTION 'Inputs must be zero or positive';
  END IF;

  SELECT * INTO b FROM public.monthly_marketer_bonuses
   WHERE marketer_id = _marketer_id AND bonus_year = _year AND bonus_month = _month
   LIMIT 1;

  IF b.id IS NULL THEN
    RAISE EXCEPTION 'No saved record for this month';
  END IF;

  proj_shipped := b.shipped_orders_count + add_shipped;
  proj_delivered := b.delivered_orders_count + add_delivered;
  IF proj_delivered > proj_shipped THEN
    RAISE EXCEPTION 'Delivered cannot exceed shipped';
  END IF;

  RETURN public.compute_bonus_figures(
    proj_shipped,
    proj_delivered,
    b.realized_commission + add_commission,
    b.ad_spend + add_ads,
    b.other_expenses
  ) || jsonb_build_object(
    'current_system_calculated_total', b.system_calculated_total,
    'simulation', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_bonus_scenario(uuid, integer, integer, integer, integer, numeric, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.preview_bonus_scenario(uuid, integer, integer, integer, integer, numeric, numeric) TO authenticated;
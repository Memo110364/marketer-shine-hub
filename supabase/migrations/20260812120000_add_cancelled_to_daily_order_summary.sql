-- The day cards on the orders page only showed delivered/returned/pending,
-- so "cancelled before shipping" orders counted toward the day's total but
-- had no visible bucket, making the three badges never sum to the total.
-- Cancelled orders aren't followed up with the shipping company, but the
-- confirmations team still needs to see them (call quality, drop-offs), so
-- add a fourth bucket instead of hiding them.
--
-- Also add "shipped" — orders that actually left for shipping (i.e.
-- excludes brand-new orders still sitting with confirmations, and orders
-- cancelled before ever shipping). Matches SHIPPED_STATUSES in
-- src/lib/constants.ts, used elsewhere for the same "really went out"
-- concept (e.g. bonus calc's shipped_orders_count).
DROP FUNCTION IF EXISTS public.get_daily_order_summary(date, date);

CREATE FUNCTION public.get_daily_order_summary(_from date, _to date)
RETURNS TABLE(order_date date, total bigint, delivered bigint, returned bigint, pending bigint, cancelled bigint, shipped bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    o.order_date,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE o.status IN ('delivered', 'done')) AS delivered,
    COUNT(*) FILTER (WHERE o.status = 'refunded') AS returned,
    COUNT(*) FILTER (WHERE o.status IN ('pending', 'in_delivery', 'refund_request')) AS pending,
    COUNT(*) FILTER (WHERE o.status = 'cancelled') AS cancelled,
    COUNT(*) FILTER (WHERE o.status IN ('in_delivery', 'delivered', 'done', 'refund_request', 'refunded')) AS shipped
  FROM public.orders o
  WHERE o.order_date BETWEEN _from AND _to
    AND o.order_date IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'account_manager')
      OR o.marketer_id = public.current_marketer_id()
    )
  GROUP BY o.order_date
  ORDER BY o.order_date DESC;
$$;

-- Powers the new "orders by day" view: one aggregate query per date range
-- instead of pulling every order row to the browser and counting client
-- side. "pending" here is a page-specific bucket — orders that still need
-- follow-up with the shipping company (new + in delivery + return
-- requested), distinct from the literal 'pending' order_status value used
-- elsewhere (e.g. bonus calculations).
CREATE INDEX IF NOT EXISTS idx_orders_date_status ON public.orders(order_date, status);

CREATE OR REPLACE FUNCTION public.get_daily_order_summary(_from date, _to date)
RETURNS TABLE(order_date date, total bigint, delivered bigint, returned bigint, pending bigint)
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
    COUNT(*) FILTER (WHERE o.status IN ('pending', 'in_delivery', 'refund_request')) AS pending
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

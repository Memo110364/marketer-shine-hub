UPDATE public.orders
SET status = 'cancelled'::order_status
WHERE status = 'pending'
  AND lower(coalesce(raw_data->>'Status', '')) IN ('canceled', 'cancelled', 'canceled_automatically', 'cancelled_automatically');
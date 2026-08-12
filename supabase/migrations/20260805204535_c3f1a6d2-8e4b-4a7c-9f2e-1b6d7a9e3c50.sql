-- ============================================================
-- Dashboard aggregation moved server-side (was: fetch every order/
-- ad_spend row for two periods and reduce in the browser).
--
-- These three functions replace that with SUM/COUNT done in Postgres.
-- They are intentionally NOT SECURITY DEFINER: they must run with the
-- calling user's own privileges so existing RLS on orders /
-- ad_spend_transactions keeps deciding row visibility exactly as it
-- does today for the direct .select() calls it replaces. Nothing about
-- who can see what changes — only where the SUM/COUNT happens.
--
-- Business rules mirrored 1:1 from src/routes/_authenticated/dashboard.tsx:
--   gross profit excludes refunded / refund_request / cancelled
--     (see COMMISSION_EXCLUDED_STATUSES in src/lib/constants.ts)
--   "delivered" = delivered + done
--   "refunded" (KPI) = refunded + refund_request
--   ad_spend excludes spend_type = 'test_ads' — the company absorbs that
--     cost, so it must not touch the marketer's ad-spend/profit figures
--     (matches the bonus engine, see 20260810113200_exclude_test_ads_
--     from_bonus_calc.sql)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_summary(
  _from date,
  _to date,
  _marketer_id uuid DEFAULT NULL,
  _product_id uuid DEFAULT NULL,
  _shipping_company_id uuid DEFAULT NULL,
  _status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH filtered AS (
    SELECT status, commission, quantity
    FROM public.orders
    WHERE order_date BETWEEN _from AND _to
      AND (_marketer_id IS NULL OR marketer_id = _marketer_id)
      AND (_product_id IS NULL OR product_id = _product_id)
      AND (_shipping_company_id IS NULL OR shipping_company_id = _shipping_company_id)
      AND (_status IS NULL OR status::text = _status)
  ),
  spend AS (
    SELECT COALESCE(SUM(amount), 0) AS ad_spend
    FROM public.ad_spend_transactions
    WHERE transaction_date BETWEEN _from AND _to
      AND spend_type <> 'test_ads'
      AND (_marketer_id IS NULL OR marketer_id = _marketer_id)
  )
  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*) FROM filtered),
    'total_pieces', (SELECT COALESCE(SUM(quantity), 0) FROM filtered),
    'delivered_pieces', (SELECT COALESCE(SUM(quantity), 0) FROM filtered WHERE status IN ('delivered', 'done')),
    'gross_profit', (SELECT COALESCE(SUM(commission), 0) FROM filtered WHERE status NOT IN ('refunded', 'refund_request', 'cancelled')),
    'delivered_commissions', (SELECT COALESCE(SUM(commission), 0) FROM filtered WHERE status IN ('delivered', 'done')),
    'in_delivery_commissions', (SELECT COALESCE(SUM(commission), 0) FROM filtered WHERE status = 'in_delivery'),
    'ad_spend', (SELECT ad_spend FROM spend),
    'counts', jsonb_build_object(
      'pending', (SELECT COUNT(*) FROM filtered WHERE status = 'pending'),
      'cancelled', (SELECT COUNT(*) FROM filtered WHERE status = 'cancelled'),
      'in_delivery', (SELECT COUNT(*) FROM filtered WHERE status = 'in_delivery'),
      'delivered', (SELECT COUNT(*) FROM filtered WHERE status = 'delivered'),
      'done', (SELECT COUNT(*) FROM filtered WHERE status = 'done'),
      'refunded', (SELECT COUNT(*) FROM filtered WHERE status = 'refunded'),
      'refund_request', (SELECT COUNT(*) FROM filtered WHERE status = 'refund_request')
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_daily_series(
  _from date,
  _to date,
  _marketer_id uuid DEFAULT NULL,
  _product_id uuid DEFAULT NULL,
  _shipping_company_id uuid DEFAULT NULL,
  _status text DEFAULT NULL
)
RETURNS TABLE(
  day date,
  total integer,
  delivered integer,
  refunded integer,
  commissions numeric,
  spend numeric
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH days AS (
    SELECT generate_series(_from, _to, interval '1 day')::date AS day
  ),
  ord AS (
    SELECT
      o.order_date AS day,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE o.status IN ('delivered', 'done')) AS delivered,
      COUNT(*) FILTER (WHERE o.status IN ('refunded', 'refund_request')) AS refunded,
      COALESCE(SUM(o.commission) FILTER (WHERE o.status IN ('delivered', 'done')), 0) AS commissions
    FROM public.orders o
    WHERE o.order_date BETWEEN _from AND _to
      AND (_marketer_id IS NULL OR o.marketer_id = _marketer_id)
      AND (_product_id IS NULL OR o.product_id = _product_id)
      AND (_shipping_company_id IS NULL OR o.shipping_company_id = _shipping_company_id)
      AND (_status IS NULL OR o.status::text = _status)
    GROUP BY o.order_date
  ),
  sp AS (
    SELECT s.transaction_date AS day, COALESCE(SUM(s.amount), 0) AS spend
    FROM public.ad_spend_transactions s
    WHERE s.transaction_date BETWEEN _from AND _to
      AND s.spend_type <> 'test_ads'
      AND (_marketer_id IS NULL OR s.marketer_id = _marketer_id)
    GROUP BY s.transaction_date
  )
  SELECT
    d.day,
    COALESCE(o.total, 0)::integer,
    COALESCE(o.delivered, 0)::integer,
    COALESCE(o.refunded, 0)::integer,
    COALESCE(o.commissions, 0),
    COALESCE(sp.spend, 0)
  FROM days d
  LEFT JOIN ord o ON o.day = d.day
  LEFT JOIN sp ON sp.day = d.day
  ORDER BY d.day;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_marketer_breakdown(
  _from date,
  _to date,
  _marketer_id uuid DEFAULT NULL,
  _product_id uuid DEFAULT NULL,
  _shipping_company_id uuid DEFAULT NULL,
  _status text DEFAULT NULL
)
RETURNS TABLE(
  marketer_id uuid,
  orders integer,
  delivered integer,
  refunded integer,
  gross numeric,
  spend numeric,
  commissions numeric
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH ord AS (
    SELECT
      o.marketer_id,
      COUNT(*) AS orders,
      COUNT(*) FILTER (WHERE o.status IN ('delivered', 'done')) AS delivered,
      COUNT(*) FILTER (WHERE o.status IN ('refunded', 'refund_request')) AS refunded,
      COALESCE(SUM(o.commission) FILTER (WHERE o.status NOT IN ('refunded', 'refund_request', 'cancelled')), 0) AS gross,
      COALESCE(SUM(o.commission) FILTER (WHERE o.status IN ('delivered', 'done')), 0) AS commissions
    FROM public.orders o
    WHERE o.marketer_id IS NOT NULL
      AND o.order_date BETWEEN _from AND _to
      AND (_marketer_id IS NULL OR o.marketer_id = _marketer_id)
      AND (_product_id IS NULL OR o.product_id = _product_id)
      AND (_shipping_company_id IS NULL OR o.shipping_company_id = _shipping_company_id)
      AND (_status IS NULL OR o.status::text = _status)
    GROUP BY o.marketer_id
  ),
  sp AS (
    SELECT s.marketer_id, COALESCE(SUM(s.amount), 0) AS spend
    FROM public.ad_spend_transactions s
    WHERE s.marketer_id IS NOT NULL
      AND s.transaction_date BETWEEN _from AND _to
      AND s.spend_type <> 'test_ads'
      AND (_marketer_id IS NULL OR s.marketer_id = _marketer_id)
    GROUP BY s.marketer_id
  )
  SELECT
    COALESCE(ord.marketer_id, sp.marketer_id),
    COALESCE(ord.orders, 0)::integer,
    COALESCE(ord.delivered, 0)::integer,
    COALESCE(ord.refunded, 0)::integer,
    COALESCE(ord.gross, 0),
    COALESCE(sp.spend, 0),
    COALESCE(ord.commissions, 0)
  FROM ord
  FULL OUTER JOIN sp ON sp.marketer_id = ord.marketer_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(date, date, uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_daily_series(date, date, uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_marketer_breakdown(date, date, uuid, uuid, uuid, text) TO authenticated;

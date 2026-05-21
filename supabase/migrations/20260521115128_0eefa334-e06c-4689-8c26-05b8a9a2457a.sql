
-- 1) Remove existing duplicates keeping the freshest record per external_order_id
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY external_order_id
           ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
         ) AS rn
  FROM public.orders
  WHERE external_order_id IS NOT NULL
)
DELETE FROM public.orders
USING ranked
WHERE public.orders.id = ranked.id
  AND ranked.rn > 1;

-- 2) Unique partial index on external_order_id (ignores NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS orders_external_order_id_unique
  ON public.orders (external_order_id)
  WHERE external_order_id IS NOT NULL;

-- 3) Order status history table
CREATE TABLE IF NOT EXISTS public.order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  old_status public.order_status,
  new_status public.order_status NOT NULL,
  import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_osh_order_id ON public.order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_osh_changed_at ON public.order_status_history(changed_at DESC);

ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Order history read scoped"
  ON public.order_status_history FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_status_history.order_id
        AND (
          (has_role(auth.uid(), 'account_manager'::app_role) AND is_my_marketer(o.marketer_id))
          OR o.marketer_id = current_marketer_id()
        )
    )
  );

CREATE POLICY "Order history insert AM"
  ON public.order_status_history FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'account_manager'::app_role)
  );

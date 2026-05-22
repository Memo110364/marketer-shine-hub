
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_number TEXT,
  base_product_name TEXT NOT NULL,
  product_option TEXT,
  color TEXT,
  size TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  raw_product_text TEXT,
  order_status order_status NOT NULL DEFAULT 'pending',
  marketer_id UUID,
  marketer_code TEXT,
  shipping_company TEXT,
  commission_share NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX idx_order_items_marketer_id ON public.order_items(marketer_id);
CREATE INDEX idx_order_items_base_product_name ON public.order_items(base_product_name);
CREATE INDEX idx_order_items_order_status ON public.order_items(order_status);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Order items read scoped"
ON public.order_items FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'account_manager'::app_role) AND is_my_marketer(marketer_id))
  OR (marketer_id = current_marketer_id())
);

CREATE POLICY "Order items insert AM"
ON public.order_items FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'account_manager'::app_role)
);

CREATE POLICY "Order items update scoped"
ON public.order_items FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'account_manager'::app_role) AND is_my_marketer(marketer_id))
);

CREATE POLICY "Order items delete admin/AM"
ON public.order_items FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'account_manager'::app_role) AND is_my_marketer(marketer_id))
);

CREATE TRIGGER update_order_items_updated_at
BEFORE UPDATE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

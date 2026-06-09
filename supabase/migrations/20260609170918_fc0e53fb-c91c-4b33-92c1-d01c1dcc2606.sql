
CREATE TABLE public.ad_spend_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.ad_spend_transactions(id) ON DELETE CASCADE,
  marketer_id uuid NOT NULL REFERENCES public.marketers(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('update','delete')),
  proposed_data jsonb,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_spend_change_requests TO authenticated;
GRANT ALL ON public.ad_spend_change_requests TO service_role;

ALTER TABLE public.ad_spend_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Change req read scoped" ON public.ad_spend_change_requests
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin') 
  OR (has_role(auth.uid(), 'account_manager') AND is_my_marketer(marketer_id))
  OR requested_by = auth.uid()
);

CREATE POLICY "Change req insert AM" ON public.ad_spend_change_requests
FOR INSERT TO authenticated
WITH CHECK (
  requested_by = auth.uid()
  AND (has_role(auth.uid(), 'admin') OR (has_role(auth.uid(), 'account_manager') AND is_my_marketer(marketer_id)))
);

CREATE POLICY "Change req update admin" ON public.ad_spend_change_requests
FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Change req delete owner pending" ON public.ad_spend_change_requests
FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin') OR (requested_by = auth.uid() AND status = 'pending'));

CREATE TRIGGER trg_change_req_updated
BEFORE UPDATE ON public.ad_spend_change_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_change_req_status ON public.ad_spend_change_requests(status, created_at DESC);
CREATE INDEX idx_change_req_marketer ON public.ad_spend_change_requests(marketer_id);

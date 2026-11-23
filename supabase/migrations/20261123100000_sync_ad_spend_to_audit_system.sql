-- Ad spend recorded here has to show up in the shipping-audit system
-- (audit.angazny.com), which until now was fed by exporting this data to a
-- spreadsheet and uploading it there by hand. This adds the outbox that
-- makes it automatic:
--
--   * one queue row per ad-spend transaction, so repeated edits collapse
--     into a single pending item instead of piling up,
--   * triggers that queue a transaction when it is added, edited or
--     deleted, and re-queue a marketer's whole history when their name or
--     code changes (the audit side links each line to the marketer by
--     code, and shows the name),
--   * request_ad_spend_sync(), the "طلب مزامنة" action, which re-queues
--     everything (or one marketer) so a manual run re-sends it all.
--
-- The edge function audit-ad-spend-sync drains the queue and marks each
-- row with what the audit system answered for it. Nothing here calls out;
-- queueing stays a cheap local write so saving an expense never waits on,
-- or fails because of, the other system being down.

CREATE TABLE public.ad_spend_sync_queue (
  -- The transaction's own id, which is also the code the audit system
  -- stores, so a row that is edited twice is queued once. Kept after a
  -- delete (no FK) because the deletion itself still has to be sent.
  transaction_id uuid PRIMARY KEY,
  marketer_id uuid REFERENCES public.marketers(id) ON DELETE SET NULL,
  op text NOT NULL CHECK (op IN ('upsert', 'delete')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  -- What the audit system said when it refused it, shown to the user.
  last_error text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);

CREATE INDEX idx_ad_spend_sync_queue_pending
  ON public.ad_spend_sync_queue(queued_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX idx_ad_spend_sync_queue_marketer
  ON public.ad_spend_sync_queue(marketer_id);

GRANT SELECT ON public.ad_spend_sync_queue TO authenticated;
GRANT ALL ON public.ad_spend_sync_queue TO service_role;

ALTER TABLE public.ad_spend_sync_queue ENABLE ROW LEVEL SECURITY;

-- Admins and account managers see the sync state; marketers have no
-- business with it. There is deliberately no INSERT/UPDATE policy: rows
-- are written only by the triggers below, by request_ad_spend_sync, or by
-- the edge function running as service_role.
CREATE POLICY "Ad spend sync queue readable by staff"
ON public.ad_spend_sync_queue
FOR SELECT TO authenticated
USING (
  public.has_role((SELECT auth.uid()), 'admin')
  OR public.has_role((SELECT auth.uid()), 'account_manager')
);

-- Queue a transaction. A row already waiting keeps its place in line; a
-- deletion always wins over an earlier edit of the same transaction.
CREATE OR REPLACE FUNCTION public.queue_ad_spend_sync(
  p_transaction_id uuid,
  p_marketer_id uuid,
  p_op text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.ad_spend_sync_queue (transaction_id, marketer_id, op, status, last_error, queued_at, synced_at)
  VALUES (p_transaction_id, p_marketer_id, p_op, 'pending', NULL, now(), NULL)
  ON CONFLICT (transaction_id) DO UPDATE SET
    marketer_id = COALESCE(EXCLUDED.marketer_id, ad_spend_sync_queue.marketer_id),
    op = CASE WHEN EXCLUDED.op = 'delete' THEN 'delete' ELSE EXCLUDED.op END,
    status = 'pending',
    last_error = NULL,
    queued_at = LEAST(ad_spend_sync_queue.queued_at, now()),
    synced_at = NULL;
$$;

CREATE OR REPLACE FUNCTION public.ad_spend_transactions_queue_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.queue_ad_spend_sync(OLD.id, OLD.marketer_id, 'delete');
    RETURN OLD;
  END IF;

  -- A transaction moved to another marketer is still one record over
  -- there; the upsert carries the new marketer with it.
  PERFORM public.queue_ad_spend_sync(NEW.id, NEW.marketer_id, 'upsert');
  RETURN NEW;
END;
$$;

CREATE TRIGGER ad_spend_transactions_sync
AFTER INSERT OR UPDATE OR DELETE ON public.ad_spend_transactions
FOR EACH ROW EXECUTE FUNCTION public.ad_spend_transactions_queue_sync();

-- The audit system keeps the marketer's name and code on the account it
-- posts the spend to, so a rename here has to reach it. Re-queueing the
-- marketer's transactions is enough: each one carries both.
CREATE OR REPLACE FUNCTION public.marketers_queue_ad_spend_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.marketer_code IS DISTINCT FROM OLD.marketer_code THEN
    PERFORM public.queue_ad_spend_sync(t.id, t.marketer_id, 'upsert')
    FROM public.ad_spend_transactions t
    WHERE t.marketer_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER marketers_ad_spend_sync
AFTER UPDATE ON public.marketers
FOR EACH ROW EXECUTE FUNCTION public.marketers_queue_ad_spend_sync();

-- "طلب مزامنة": re-send everything, or one marketer's spend, whether or
-- not anything changed here — for when the audit system was restored from
-- a backup, or somebody simply wants to be sure the two agree.
CREATE OR REPLACE FUNCTION public.request_ad_spend_sync(p_marketer_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queued integer;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
          OR public.has_role(auth.uid(), 'account_manager')) THEN
    RAISE EXCEPTION 'غير مسموح بطلب المزامنة';
  END IF;

  PERFORM public.queue_ad_spend_sync(t.id, t.marketer_id, 'upsert')
  FROM public.ad_spend_transactions t
  WHERE p_marketer_id IS NULL OR t.marketer_id = p_marketer_id;

  GET DIAGNOSTICS v_queued = ROW_COUNT;

  -- Deletions already waiting are not reset to 'upsert' by the above
  -- (queue_ad_spend_sync keeps a delete), so they go out with this run.
  UPDATE public.ad_spend_sync_queue q
  SET status = 'pending', last_error = NULL, synced_at = NULL
  WHERE q.op = 'delete'
    AND q.status <> 'pending'
    AND (p_marketer_id IS NULL OR q.marketer_id = p_marketer_id);

  RETURN v_queued;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_ad_spend_sync(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_ad_spend_sync(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_ad_spend_sync(uuid) TO authenticated;

-- Everything already recorded goes over on the first run.
INSERT INTO public.ad_spend_sync_queue (transaction_id, marketer_id, op)
SELECT t.id, t.marketer_id, 'upsert' FROM public.ad_spend_transactions t
ON CONFLICT (transaction_id) DO NOTHING;

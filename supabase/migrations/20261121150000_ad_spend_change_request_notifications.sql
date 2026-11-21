-- Ad-spend change requests already carry an approve/reject workflow
-- (20260609170918_*.sql), but nothing told the admin a request was waiting:
-- they had to open each marketer's expenses page to notice. This adds a
-- generic in-app notifications table plus triggers that
--   * notify every admin when a change/delete request is filed,
--   * notify the requester when the admin approves or rejects it,
--   * clear the admins' notification once the request leaves 'pending'
--     (reviewed, or cancelled by its owner),
-- so the bell badge in the app header always reflects what is actually
-- still waiting for a decision.

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  -- in-app route the badge should take the user to, e.g.
  -- '/marketers/<uuid>/expenses'
  link_path text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Recipients read, mark read, and dismiss their own notifications. There is
-- deliberately no INSERT policy: rows are only ever written by the
-- SECURITY DEFINER triggers below (or service_role), so a logged-in user
-- cannot forge a notification for someone else.
CREATE POLICY "Notifications read own" ON public.notifications
FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Notifications update own" ON public.notifications
FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Notifications delete own" ON public.notifications
FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE INDEX idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread
  ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_entity
  ON public.notifications(entity_type, entity_id);

-- The UPDATE policy above lets a recipient write any column of their own
-- row. Only read_at is theirs to change; freeze the rest so the audit
-- trail of what they were told cannot be rewritten.
CREATE OR REPLACE FUNCTION public.notifications_only_read_at_editable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  NEW.id := OLD.id;
  NEW.user_id := OLD.user_id;
  NEW.kind := OLD.kind;
  NEW.title := OLD.title;
  NEW.body := OLD.body;
  NEW.link_path := OLD.link_path;
  NEW.entity_type := OLD.entity_type;
  NEW.entity_id := OLD.entity_id;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notifications_only_read_at_editable()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notifications_freeze_content
BEFORE UPDATE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.notifications_only_read_at_editable();

-- ============ ad-spend change request notifications ============

CREATE OR REPLACE FUNCTION public.notify_ad_spend_change_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  marketer_name text;
  requester_name text;
  tx_amount numeric;
  tx_date date;
  action_label text;
  body_text text;
BEGIN
  SELECT name INTO marketer_name FROM public.marketers WHERE id = NEW.marketer_id;
  SELECT COALESCE(NULLIF(full_name, ''), email) INTO requester_name
    FROM public.profiles WHERE id = NEW.requested_by;
  SELECT amount, transaction_date INTO tx_amount, tx_date
    FROM public.ad_spend_transactions WHERE id = NEW.transaction_id;

  action_label := CASE WHEN NEW.action = 'delete' THEN 'حذف' ELSE 'تعديل' END;
  body_text := COALESCE(requester_name, 'مستخدم') || ' طلب ' || action_label
    || ' مصروف ' || COALESCE(marketer_name, 'مسوّق')
    || COALESCE(' بمبلغ ' || to_char(tx_amount, 'FM999999990.00') || ' ج.م', '')
    || COALESCE(' بتاريخ ' || to_char(tx_date, 'YYYY-MM-DD'), '')
    || COALESCE(E'\nالسبب: ' || NEW.reason, '');

  INSERT INTO public.notifications (user_id, kind, title, body, link_path, entity_type, entity_id)
  SELECT ur.user_id,
         'ad_spend_change_request',
         'طلب ' || action_label || ' مصروف إعلاني بانتظار موافقتك',
         body_text,
         '/marketers/' || NEW.marketer_id || '/expenses',
         'ad_spend_change_request',
         NEW.id
  FROM public.user_roles ur
  WHERE ur.role = 'admin' AND ur.user_id <> NEW.requested_by;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_ad_spend_change_request()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notify_change_req_created
AFTER INSERT ON public.ad_spend_change_requests
FOR EACH ROW
WHEN (NEW.status = 'pending')
EXECUTE FUNCTION public.notify_ad_spend_change_request();

CREATE OR REPLACE FUNCTION public.notify_ad_spend_change_reviewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  action_label text;
  status_label text;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- the request is no longer waiting on anyone: retire the admins' alerts
  UPDATE public.notifications
     SET read_at = now()
   WHERE entity_type = 'ad_spend_change_request'
     AND entity_id = NEW.id
     AND kind = 'ad_spend_change_request'
     AND read_at IS NULL;

  IF NEW.status NOT IN ('approved', 'rejected') THEN
    RETURN NEW;
  END IF;

  action_label := CASE WHEN NEW.action = 'delete' THEN 'حذف' ELSE 'تعديل' END;
  status_label := CASE WHEN NEW.status = 'approved' THEN 'تمت الموافقة على' ELSE 'تم رفض' END;

  INSERT INTO public.notifications (user_id, kind, title, body, link_path, entity_type, entity_id)
  VALUES (
    NEW.requested_by,
    'ad_spend_change_reviewed',
    status_label || ' طلب ' || action_label || ' المصروف الإعلاني',
    COALESCE(E'ملاحظات المراجعة: ' || NEW.review_notes, NULL),
    '/marketers/' || NEW.marketer_id || '/expenses',
    'ad_spend_change_request',
    NEW.id
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_ad_spend_change_reviewed()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notify_change_req_reviewed
AFTER UPDATE OF status ON public.ad_spend_change_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_ad_spend_change_reviewed();

-- Owner cancelled their own pending request: nothing left to approve.
CREATE OR REPLACE FUNCTION public.clear_ad_spend_change_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.notifications
     SET read_at = now()
   WHERE entity_type = 'ad_spend_change_request'
     AND entity_id = OLD.id
     AND read_at IS NULL;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clear_ad_spend_change_notifications()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_clear_change_req_notifications
BEFORE DELETE ON public.ad_spend_change_requests
FOR EACH ROW EXECUTE FUNCTION public.clear_ad_spend_change_notifications();

-- Let the app react instantly instead of polling, where realtime is enabled.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN undefined_object THEN NULL;   -- publication not present
  WHEN duplicate_object THEN NULL;   -- already published
END;
$$;

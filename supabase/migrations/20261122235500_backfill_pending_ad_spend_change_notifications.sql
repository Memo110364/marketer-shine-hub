-- The notification triggers from
-- 20261121150000_ad_spend_change_request_notifications.sql only fire on new
-- rows, so change requests that were already pending when they went live had
-- no notification behind the badges that count them. Backfill one per admin
-- per still-pending request, dated to when the request was filed, with the
-- same wording the trigger produces. Idempotent: a request that already has
-- an admin notification is skipped, so re-running adds nothing.
INSERT INTO public.notifications (user_id, kind, title, body, link_path, entity_type, entity_id, created_at)
SELECT ur.user_id,
       'ad_spend_change_request',
       'طلب ' || action_label || ' مصروف إعلاني بانتظار موافقتك',
       COALESCE(requester_name, 'مستخدم') || ' طلب ' || action_label
         || ' مصروف ' || COALESCE(marketer_name, 'مسوّق')
         || COALESCE(' بمبلغ ' || to_char(tx_amount, 'FM999999990.00') || ' ج.م', '')
         || COALESCE(' بتاريخ ' || to_char(tx_date, 'YYYY-MM-DD'), '')
         || COALESCE(E'\nالسبب: ' || reason, ''),
       '/marketers/' || marketer_id || '/expenses',
       'ad_spend_change_request',
       request_id,
       request_created_at
FROM (
  SELECT r.id AS request_id,
         r.marketer_id,
         r.requested_by,
         r.reason,
         r.created_at AS request_created_at,
         CASE WHEN r.action = 'delete' THEN 'حذف' ELSE 'تعديل' END AS action_label,
         m.name AS marketer_name,
         COALESCE(NULLIF(p.full_name, ''), p.email) AS requester_name,
         t.amount AS tx_amount,
         t.transaction_date AS tx_date
  FROM public.ad_spend_change_requests r
  LEFT JOIN public.marketers m ON m.id = r.marketer_id
  LEFT JOIN public.profiles p ON p.id = r.requested_by
  LEFT JOIN public.ad_spend_transactions t ON t.id = r.transaction_id
  WHERE r.status = 'pending'
) pending
CROSS JOIN public.user_roles ur
WHERE ur.role = 'admin'
  AND ur.user_id <> pending.requested_by
  AND NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.entity_type = 'ad_spend_change_request'
      AND n.entity_id = pending.request_id
      AND n.kind = 'ad_spend_change_request'
      AND n.user_id = ur.user_id
  );

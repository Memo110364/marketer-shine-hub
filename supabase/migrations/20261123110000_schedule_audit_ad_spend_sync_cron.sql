-- Drains the ad-spend outbox into the shipping-audit system every ten
-- minutes, so spend recorded here shows up there on its own and nobody has
-- to press "طلب مزامنة" for the ordinary case. Reuses the CRON_SECRET
-- already stored for the daily digest (edge function secrets are
-- project-wide). A run with an empty queue costs one short request.
select cron.schedule(
  'audit-ad-spend-sync-cron',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://unqegfksunohdsmmyqrb.supabase.co/functions/v1/audit-ad-spend-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_for_digest')
    ),
    body := jsonb_build_object(),
    timeout_milliseconds := 120000
  );
  $$
);

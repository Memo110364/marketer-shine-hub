-- Runs the Meta insights auto-sync every 6 hours, so every connected ad
-- account's spend/campaign numbers stay fresh without anyone pressing
-- "مزامنة الآن" — reuses the same CRON_SECRET already stored for the daily
-- marketer digest (Supabase edge function secrets are project-wide).
select cron.schedule(
  'meta-insights-sync-cron',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://unqegfksunohdsmmyqrb.supabase.co/functions/v1/meta-insights-sync-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_for_digest')
    ),
    body := jsonb_build_object(),
    timeout_milliseconds := 120000
  );
  $$
);

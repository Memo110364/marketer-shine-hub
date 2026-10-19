-- Runs the daily marketer digest every day at 06:00 UTC = 08:00 Cairo
-- (EET, UTC+2). Egypt has intermittently applied summer-time shifts in
-- recent years; if that resumes, the send may land an hour later (~9am)
-- during those months — cosmetic only, not a functional issue.
--
-- The CRON_SECRET value itself is never stored in this migration (or
-- anywhere in the repo) — it's looked up from Supabase Vault at run time,
-- where an admin stored it directly.
select cron.schedule(
  'daily-marketer-digest',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://unqegfksunohdsmmyqrb.supabase.co/functions/v1/daily-marketer-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_for_digest')
    ),
    body := jsonb_build_object('dry_run', false),
    timeout_milliseconds := 30000
  );
  $$
);

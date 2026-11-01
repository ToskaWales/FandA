-- 005_cron.sql
select vault.create_secret('<gleicher Wert wie CRON_SECRET>', 'cron_secret');

select cron.schedule('leadgen-retry', '*/10 * * * *', $$
  select net.http_post(
    url     := 'https://<PROJEKT-REF>.supabase.co/functions/v1/meta-leadgen-webhook?retry=1',
    headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body    := '{}'::jsonb);
$$);

select cron.schedule('meta-sync-daily', '15 4 * * *', $$
  select net.http_post(
    url     := 'https://<PROJEKT-REF>.supabase.co/functions/v1/sync-meta-insights',
    headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body    := '{}'::jsonb, timeout_milliseconds := 120000);
$$);

select cron.schedule('weekly-ad-report', '30 5 * * 1', $$   -- montags, nach dem Sync
  select net.http_post(
    url     := 'https://<PROJEKT-REF>.supabase.co/functions/v1/weekly-ad-report',
    headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body    := '{}'::jsonb, timeout_milliseconds := 120000);
$$);

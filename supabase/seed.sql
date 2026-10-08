-- Local development seed (runs on `supabase db reset` / `pnpm db:seed`).
-- Business data arrives with later modules. Here: Vault entries so pg_cron can reach the local
-- worker function. The secret is a local-only placeholder matching supabase/functions/.env.example;
-- staging/production set real values with vault.create_secret (see README).
do $$
begin
  delete from vault.secrets where name in ('vionx_worker_url', 'vionx_service_secret');
  perform vault.create_secret('http://supabase_kong_vionx:8000/functions/v1/worker', 'vionx_worker_url');
  perform vault.create_secret('local-dev-service-secret', 'vionx_service_secret');
end;
$$;

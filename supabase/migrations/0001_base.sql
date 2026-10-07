-- VionX M00 — base schemas, ops tables, outbox → pgmq, worker cron.
-- Migrations are never edited after merge (CONTRACT §9).

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Schemas: app (family data), library (shared content, no personal data),
-- ops (outbox, queues metadata, ai_runs, audit, rate limits).
-- ---------------------------------------------------------------------------
create schema if not exists app;
create schema if not exists library;
create schema if not exists ops;

comment on schema app is 'Family data. Every child-data table has household_id; access only via the api function with scoped(ctx).';
comment on schema library is 'Shared content library. Global, reused by all users, never contains personal data.';
comment on schema ops is 'Operational data: outbox, processed events, ai_runs, ai_task_config, audit, rate limits, analytics.';

-- Client roles get nothing: all reads/writes go through the api Edge Function (CONTRACT §3).
revoke all on schema app, library, ops from public, anon, authenticated;
alter default privileges in schema app, library, ops revoke all on tables from public, anon, authenticated;
alter default privileges in schema app, library, ops revoke all on sequences from public, anon, authenticated;
alter default privileges in schema app, library, ops revoke all on functions from public, anon, authenticated;
revoke all on schema pgmq from public, anon, authenticated;
revoke all on all tables in schema pgmq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------
create or replace function ops.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Append-only tables (ledgers, outbox, audit, ai_runs): corrections happen by new rows.
create or replace function ops.forbid_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'table %.% is append-only (% rejected)', tg_table_schema, tg_table_name, tg_op
    using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- Outbox: ops.domain_events → pgmq "events" → worker
-- ---------------------------------------------------------------------------
create table ops.domain_events (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  household_id uuid,
  aggregate_type text,
  aggregate_id uuid,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table ops.domain_events is 'Transactional outbox. Insert in the same transaction as the state change; a trigger enqueues to pgmq "events".';
create index domain_events_household_idx on ops.domain_events (household_id, occurred_at desc);
create index domain_events_type_idx on ops.domain_events (type, occurred_at desc);
-- idempotency_key unique per (household, kind) (CONTRACT §3).
create unique index domain_events_idempotency_uidx
  on ops.domain_events (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid), type, idempotency_key)
  where idempotency_key is not null;

create trigger domain_events_append_only
  before update or delete on ops.domain_events
  for each row execute function ops.forbid_mutation();

-- Consumers record each processed event_id; the primary key makes handling idempotent.
create table ops.processed_events (
  consumer text not null,
  event_id uuid not null references ops.domain_events (id),
  msg_id bigint,
  processed_at timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on table ops.processed_events is 'Idempotency record: one row per (consumer, event). The worker inserts it in the same transaction as the handler.';

select pgmq.create('events');
select pgmq.create('events_dlq');

create or replace function ops.enqueue_domain_event() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pgmq.send(
    'events',
    jsonb_build_object(
      'event_id', new.id,
      'type', new.type,
      'household_id', new.household_id,
      'occurred_at', new.occurred_at
    )
  );
  return new;
end;
$$;

create trigger domain_events_enqueue
  after insert on ops.domain_events
  for each row execute function ops.enqueue_domain_event();

-- ---------------------------------------------------------------------------
-- Audit log (parent/admin access to child data, every admin mutation)
-- ---------------------------------------------------------------------------
create table ops.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('parent', 'child', 'admin', 'system')),
  actor_id uuid,
  action text not null,
  target_type text,
  target_id uuid,
  household_id uuid,
  request_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_logs_household_idx on ops.audit_logs (household_id, created_at desc);
create index audit_logs_actor_idx on ops.audit_logs (actor_type, actor_id, created_at desc);
create trigger audit_logs_append_only
  before update or delete on ops.audit_logs
  for each row execute function ops.forbid_mutation();

-- ---------------------------------------------------------------------------
-- AI: task config (model per task, changeable without code) and run log
-- ---------------------------------------------------------------------------
create table ops.ai_task_config (
  task text primary key,
  model text not null,
  mode text not null check (mode in ('realtime', 'batch')),
  effort text check (effort in ('low', 'medium', 'high', 'xhigh', 'max')),
  max_tokens integer not null check (max_tokens > 0),
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table ops.ai_task_config is 'Model, effort and max tokens per AI task (ARCHITECTURE §4). effort is null for models that do not accept it (Haiku 4.5).';
create trigger ai_task_config_updated_at
  before update on ops.ai_task_config
  for each row execute function ops.set_updated_at();

-- Defaults from ARCHITECTURE §4 (kept in sync with packages/ai DEFAULT_TASK_CONFIG by a unit test).
insert into ops.ai_task_config (task, model, mode, effort, max_tokens, notes) values
  ('page_extraction',         'claude-haiku-4-5',  'batch',    null,     16000, 'Pages without a good text layer; every page of the image-only 2026-2027 SGK set'),
  ('page_reread',             'claude-sonnet-5-5', 'batch',    'high',   16000, 'Page re-read after failed validation'),
  ('structure_mapping',       'claude-sonnet-5-5', 'batch',    'high',   16000, 'TOC/structure, skill backbone, lesson to skill mapping'),
  ('item_generation',         'claude-sonnet-5-5', 'batch',    'high',   16000, 'Questions, templates, hints, distractor feedback'),
  ('item_verification',       'claude-haiku-4-5',  'batch',    null,      8000, 'Plus deterministic checks'),
  ('item_dispute',            'claude-opus-5-5',   'batch',    'high',   16000, 'Verifier disagrees; at most 5% of items'),
  ('tutor_t2',                'claude-haiku-4-5',  'realtime', null,      4000, 'Free-form question not in library; streaming'),
  ('tutor_t3',                'claude-sonnet-5-5', 'realtime', 'medium',  8000, 'Escalation, low confidence or third follow-up'),
  ('writing_feedback_g1_9',   'claude-haiku-4-5',  'realtime', null,      4000, 'Writing feedback grades 1-9 (realtime or nightly batch)'),
  ('writing_feedback_g10_12', 'claude-sonnet-5-5', 'realtime', 'medium',  8000, 'Writing feedback grades 10-12 (realtime or nightly batch)'),
  ('passage_generation',      'claude-sonnet-5-5', 'batch',    'medium', 16000, 'Original reading passages / dialogues for item groups'),
  ('svg_illustration',        'claude-sonnet-5-5', 'batch',    'medium', 16000, 'Simple SVG illustrations, then render check'),
  ('parent_weekly_summary',   'claude-haiku-4-5',  'batch',    null,      4000, 'Weekly batch'),
  ('ai_check',                'claude-haiku-4-5',  'realtime', null,        64, 'pnpm ai:check smoke call');

create table ops.ai_runs (
  id uuid primary key default gen_random_uuid(),
  task text not null,
  model text not null,
  prompt_version text not null,
  mode text not null check (mode in ('realtime', 'batch')),
  status text not null check (status in (
    'succeeded', 'refused', 'truncated', 'invalid_output', 'failed',
    'batch_submitted', 'batch_errored', 'batch_expired'
  )),
  stop_reason text,
  batch_id text,
  custom_id text,
  student_ref text,
  source_refs text[] not null default '{}',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_creation_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  latency_ms integer,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table ops.ai_runs is 'One row per model call or batch item (CONTRACT §6). student_ref is pseudonymous.';
create index ai_runs_task_idx on ops.ai_runs (task, created_at desc);
create index ai_runs_batch_idx on ops.ai_runs (batch_id) where batch_id is not null;
create trigger ai_runs_append_only
  before update or delete on ops.ai_runs
  for each row execute function ops.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Rate limits (fixed windows) and analytics events
-- ---------------------------------------------------------------------------
create table ops.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (bucket, window_start)
);
comment on table ops.rate_limits is 'Fixed-window counters, e.g. bucket = ''tutor:<child_id>'' or ''login:<ip>''.';
create trigger rate_limits_updated_at
  before update on ops.rate_limits
  for each row execute function ops.set_updated_at();

create table ops.analytics_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  household_id uuid,
  actor_type text check (actor_type in ('parent', 'child', 'admin', 'system', 'anonymous')),
  actor_ref text,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table ops.analytics_events is 'Product analytics. Requires EDUCATION_ANALYTICS consent for child-level events (enforced in the api from M02).';
create index analytics_events_name_idx on ops.analytics_events (name, occurred_at desc);
create index analytics_events_household_idx on ops.analytics_events (household_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- RLS on every table, no policies: deny-by-default for client roles.
-- ---------------------------------------------------------------------------
alter table ops.domain_events enable row level security;
alter table ops.processed_events enable row level security;
alter table ops.audit_logs enable row level security;
alter table ops.ai_task_config enable row level security;
alter table ops.ai_runs enable row level security;
alter table ops.rate_limits enable row level security;
alter table ops.analytics_events enable row level security;
revoke all on all tables in schema app, library, ops from public, anon, authenticated;
revoke all on all functions in schema ops from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Worker schedule: pg_cron calls the worker function every minute via pg_net.
-- URL and service secret live in Supabase Vault (names below); without them the tick is a no-op.
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/worker', 'vionx_worker_url');
--   select vault.create_secret('<VIONX_SERVICE_SECRET>', 'vionx_service_secret');
-- ---------------------------------------------------------------------------
create or replace function ops.invoke_worker() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_url text;
  service_secret text;
begin
  select decrypted_secret into worker_url from vault.decrypted_secrets where name = 'vionx_worker_url';
  select decrypted_secret into service_secret from vault.decrypted_secrets where name = 'vionx_service_secret';
  if worker_url is null or service_secret is null then
    return null;
  end if;
  return net.http_post(
    url := worker_url,
    body := jsonb_build_object('source', 'pg_cron'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-vionx-service-secret', service_secret
    ),
    timeout_milliseconds := 55000
  );
end;
$$;
revoke all on function ops.invoke_worker() from public, anon, authenticated;

select cron.schedule('vionx-worker-tick', '* * * * *', $$select ops.invoke_worker()$$);

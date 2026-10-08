-- VionX M02 — consent & privacy core: policy versions, parent policy acceptance, consent records,
-- privacy requests, export and deletion jobs, revocation job cancellation, ledger anonymisation
-- hook, 30-day hard delete. Migrations are never edited after merge.

-- ---------------------------------------------------------------------------
-- Policy versions (global, no personal data). Append-only: a change is a new version.
-- ---------------------------------------------------------------------------
create table app.policy_versions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('PRIVACY_POLICY', 'TERMS_OF_SERVICE')),
  version integer not null check (version > 0),
  locale text not null check (locale in ('vi', 'en')),
  title text not null check (char_length(title) between 1 and 200),
  content_md text not null,
  effective_at timestamptz not null,
  requires_reconsent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (type, version, locale)
);
comment on table app.policy_versions is 'Privacy policy and terms, versioned per locale. Current = highest effective version; requires_reconsent invalidates consents granted against older versions.';
create trigger policy_versions_append_only
  before update or delete on app.policy_versions
  for each row execute function ops.forbid_mutation();

-- Lowest policy version whose consents are still valid at p_at: the newest effective version that
-- requires re-consent, otherwise the first version. Mirrors @vionx/domain minimumAcceptedVersion.
create or replace function app.policy_min_accepted_version(p_type text, p_at timestamptz default now())
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    max(version) filter (where requires_reconsent and effective_at <= p_at),
    min(version),
    1
  )
  from app.policy_versions
  where type = p_type;
$$;

-- ---------------------------------------------------------------------------
-- Parent acceptance of policy versions (onboarding consent step, Privacy Center history)
-- ---------------------------------------------------------------------------
create table app.policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  policy_type text not null check (policy_type in ('PRIVACY_POLICY', 'TERMS_OF_SERVICE')),
  policy_version integer not null check (policy_version > 0),
  locale text not null check (locale in ('vi', 'en')),
  accepted_at timestamptz not null default now(),
  device_id_hash text check (device_id_hash ~ '^[0-9a-f]{64}$'),
  request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, policy_type, policy_version)
);
comment on table app.policy_acceptances is 'Which policy versions a parent accepted (parent data; exported with the household of the parent).';

-- ---------------------------------------------------------------------------
-- Consent records (Master Spec §6.1). One row per grant; never rewritten except for the status and
-- assent transitions below, so the table is the auditable consent history.
-- ---------------------------------------------------------------------------
create table app.consent_records (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households (id) on delete cascade,
  student_id uuid,
  consent_type text not null check (consent_type in (
    'CORE_SERVICE', 'EDUCATION_ANALYTICS', 'AI_PERSONALIZATION', 'MICROPHONE_SPEAKING',
    'HEALTH_CONNECT_ACTIVITY', 'COMPETITION_AREA'
  )),
  policy_type text not null default 'PRIVACY_POLICY' check (policy_type = 'PRIVACY_POLICY'),
  policy_version integer not null check (policy_version > 0),
  status text not null check (status in ('GRANTED', 'REVOKED', 'SUPERSEDED')),
  granted_by_parent_id uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_type text check (revoked_by_type in ('parent', 'system')),
  revoked_by_id uuid,
  child_assent_required boolean not null,
  child_assent_status text not null check (child_assent_status in (
    'NOT_REQUIRED', 'PENDING', 'GIVEN', 'DECLINED'
  )),
  child_assent_at timestamptz,
  device_id_hash text check (device_id_hash ~ '^[0-9a-f]{64}$'),
  request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade,
  check ((status = 'GRANTED') = (revoked_at is null)),
  check (child_assent_required or child_assent_status = 'NOT_REQUIRED'),
  check (not child_assent_required or child_assent_status <> 'NOT_REQUIRED')
);
comment on table app.consent_records is 'Versioned, revocable consents per child and type (CONTRACT §5). At most one GRANTED row per (student, type).';
create unique index consent_records_active_uidx
  on app.consent_records (household_id, coalesce(student_id, '00000000-0000-0000-0000-000000000000'::uuid), consent_type)
  where status = 'GRANTED';
create index consent_records_student_idx on app.consent_records (household_id, student_id, granted_at desc);

create or replace function app.consent_records_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.household_id <> old.household_id
     or new.student_id is distinct from old.student_id
     or new.consent_type <> old.consent_type
     or new.policy_type <> old.policy_type
     or new.policy_version <> old.policy_version
     or new.granted_at <> old.granted_at
     or new.child_assent_required <> old.child_assent_required
     or new.device_id_hash is distinct from old.device_id_hash
     or new.request_id is distinct from old.request_id
     or new.created_at <> old.created_at
     or (new.granted_by_parent_id is distinct from old.granted_by_parent_id
         and new.granted_by_parent_id is not null) then
    raise exception 'consent_records: only status, revocation and child assent may change'
      using errcode = 'P0001';
  end if;
  if old.status <> 'GRANTED' and (new.status <> old.status
     or new.revoked_at is distinct from old.revoked_at
     or new.child_assent_status <> old.child_assent_status) then
    raise exception 'consent_records: an ended consent is final' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger consent_records_guard before update on app.consent_records
  for each row execute function app.consent_records_guard();

-- ---------------------------------------------------------------------------
-- Privacy requests and jobs. privacy_requests and data_deletion_jobs keep no foreign key to the
-- household: they outlive the purge as the record that the request was fulfilled (ids only).
-- ---------------------------------------------------------------------------
create table app.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid,
  student_id uuid,
  type text not null check (type in ('EXPORT', 'DELETE_CHILD', 'DELETE_ACCOUNT')),
  status text not null check (status in ('RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'FAILED')),
  requested_by uuid not null,
  source text not null default 'app' check (source in ('app', 'web')),
  request_id text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index privacy_requests_household_idx on app.privacy_requests (household_id, created_at desc);
create index privacy_requests_user_idx on app.privacy_requests (requested_by, created_at desc);

create table app.data_export_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households (id) on delete cascade,
  privacy_request_id uuid not null references app.privacy_requests (id),
  requested_by uuid not null,
  status text not null check (status in ('QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED')),
  object_path text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'READY' or (object_path is not null and expires_at is not null))
);
comment on table app.data_export_jobs is 'Household JSON export (zip in the private bucket privacy-exports); download link valid 24 hours.';
create unique index data_export_jobs_active_uidx on app.data_export_jobs (household_id)
  where status in ('QUEUED', 'RUNNING');
create index data_export_jobs_household_idx on app.data_export_jobs (household_id, created_at desc);
create index data_export_jobs_ready_idx on app.data_export_jobs (expires_at) where status = 'READY';

create table app.data_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('CHILD', 'ACCOUNT')),
  household_id uuid,
  student_id uuid,
  user_id uuid,
  privacy_request_id uuid not null references app.privacy_requests (id),
  status text not null check (status in ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'FAILED')),
  requested_at timestamptz not null default now(),
  purge_after timestamptz not null,
  completed_at timestamptz,
  error text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scope <> 'CHILD' or (household_id is not null and student_id is not null)),
  check (scope <> 'ACCOUNT' or (user_id is not null and student_id is null))
);
comment on table app.data_deletion_jobs is 'Deletion: disabled at request time, hard-deleted by pg_cron (ops.purge_due_deletions) after purge_after (30 days).';
create unique index data_deletion_jobs_child_uidx on app.data_deletion_jobs (student_id)
  where status = 'SCHEDULED' and scope = 'CHILD';
create unique index data_deletion_jobs_account_uidx on app.data_deletion_jobs (user_id)
  where status = 'SCHEDULED' and scope = 'ACCOUNT';
create index data_deletion_jobs_due_idx on app.data_deletion_jobs (purge_after) where status = 'SCHEDULED';
create index data_deletion_jobs_household_idx on app.data_deletion_jobs (household_id, created_at desc);

alter table app.households add column deletion_requested_at timestamptz;
comment on column app.households.deletion_requested_at is 'Account deletion requested: the household is hidden from the api and purged after 30 days.';

create trigger policy_acceptances_updated_at before update on app.policy_acceptances
  for each row execute function ops.set_updated_at();
create trigger consent_records_updated_at before update on app.consent_records
  for each row execute function ops.set_updated_at();
create trigger privacy_requests_updated_at before update on app.privacy_requests
  for each row execute function ops.set_updated_at();
create trigger data_export_jobs_updated_at before update on app.data_export_jobs
  for each row execute function ops.set_updated_at();
create trigger data_deletion_jobs_updated_at before update on app.data_deletion_jobs
  for each row execute function ops.set_updated_at();

-- ---------------------------------------------------------------------------
-- Private Storage bucket for exports (service role only: no storage.objects policies).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('privacy-exports', 'privacy-exports', false, 52428800, array['application/zip'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Revocation cancels queued jobs of that scope (CONTRACT §5). Modules that queue consent-scoped
-- work register their pgmq queue here; messages carry `student_id`. The worker calls
-- ops.cancel_consent_jobs on consent.revoked. CORE_SERVICE revocation cancels every scope.
-- ---------------------------------------------------------------------------
create table ops.consent_job_queues (
  queue_name text not null,
  consent_type text not null check (consent_type in (
    'CORE_SERVICE', 'EDUCATION_ANALYTICS', 'AI_PERSONALIZATION', 'MICROPHONE_SPEAKING',
    'HEALTH_CONNECT_ACTIVITY', 'COMPETITION_AREA'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (queue_name, consent_type)
);
comment on table ops.consent_job_queues is 'pgmq queues holding consent-scoped jobs; messages must carry student_id.';

-- Personalised AI jobs (tutor follow-ups, writing feedback...). Consumer arrives with M15.
select pgmq.create('ai_jobs');
insert into ops.consent_job_queues (queue_name, consent_type) values ('ai_jobs', 'AI_PERSONALIZATION');

create or replace function ops.cancel_consent_jobs(p_student_id uuid, p_consent_type text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  q record;
  removed integer;
  total integer := 0;
begin
  for q in
    select distinct queue_name from ops.consent_job_queues
    where consent_type = p_consent_type or p_consent_type = 'CORE_SERVICE'
  loop
    execute format(
      'with d as (delete from pgmq.%I where message->>''student_id'' = $1 returning 1) select count(*)::int from d',
      'q_' || q.queue_name
    ) using p_student_id::text into removed;
    total := total + removed;
  end loop;
  return total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ledger anonymisation hook. Ledgers (M04+) are append-only and are anonymised, not deleted, when a
-- child or household is purged. A ledger table registers itself in ops.ledger_registry, must not
-- cascade-delete from app.students / app.households, and uses ops.ledger_append_only() as its
-- UPDATE/DELETE trigger instead of ops.forbid_mutation().
-- ---------------------------------------------------------------------------
create table ops.ledger_registry (
  table_name text primary key,
  student_column text not null,
  household_column text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table ops.ledger_registry is 'Append-only ledgers to anonymise on purge (student/household ids replaced by unlinkable random ids).';

create or replace function ops.ledger_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and current_setting('vionx.ledger_anonymise', true) = 'on' then
    return new;
  end if;
  raise exception 'ledger %.% is append-only (% rejected)', tg_table_schema, tg_table_name, tg_op
    using errcode = 'P0001';
end;
$$;

-- Replaces student ids (and, for a whole household, the household id) with ids derived from a
-- random salt that is discarded afterwards: totals per (anonymous) child survive, the link to the
-- person does not.
create or replace function ops.anonymise_ledgers(p_household_id uuid, p_student_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  changed integer;
  total integer := 0;
  salt text := gen_random_uuid()::text;
begin
  perform set_config('vionx.ledger_anonymise', 'on', true);
  for l in select table_name, student_column, household_column from ops.ledger_registry loop
    if p_student_id is null then
      execute format(
        'update %s set %I = md5(%I::text || $2)::uuid, %I = md5(%I::text || $2)::uuid where %I = $1',
        l.table_name, l.student_column, l.student_column, l.household_column, l.household_column,
        l.household_column
      ) using p_household_id, salt;
    else
      execute format(
        'update %s set %I = md5(%I::text || $2)::uuid where %I = $1 and %I = $3',
        l.table_name, l.student_column, l.student_column, l.household_column, l.student_column
      ) using p_household_id, salt, p_student_id;
    end if;
    get diagnostics changed = row_count;
    total := total + changed;
  end loop;
  perform set_config('vionx.ledger_anonymise', 'off', true);
  return total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hard delete after the grace period (pg_cron daily). Child: anonymise ledgers, delete the child
-- (cascades credentials, sessions, consents). Account: anonymise the household's ledgers, delete
-- the household (cascades all family data) and the member accounts left without a household.
-- ---------------------------------------------------------------------------
create or replace function ops.purge_due_deletions(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  j record;
  anonymised integer;
  members uuid[];
  deleted_users integer;
  done integer := 0;
begin
  for j in
    select * from app.data_deletion_jobs
    where status = 'SCHEDULED' and purge_after <= p_now
    order by purge_after
    for update skip locked
  loop
    deleted_users := 0;
    if j.scope = 'CHILD' then
      anonymised := ops.anonymise_ledgers(j.household_id, j.student_id);
      delete from app.students where id = j.student_id and household_id = j.household_id;
    else
      anonymised := 0;
      members := array[j.user_id];
      if j.household_id is not null then
        anonymised := ops.anonymise_ledgers(j.household_id, null);
        select members || coalesce(array_agg(m.user_id), '{}') into members
          from app.household_memberships m where m.household_id = j.household_id;
        delete from app.households where id = j.household_id;
      end if;
      delete from auth.users u
        where u.id = any(members)
          and not exists (select 1 from app.household_memberships m where m.user_id = u.id);
      get diagnostics deleted_users = row_count;
    end if;
    update app.data_deletion_jobs
      set status = 'COMPLETED', completed_at = p_now,
          result = jsonb_build_object('anonymisedLedgerRows', anonymised, 'deletedAccounts', deleted_users)
      where id = j.id;
    update app.privacy_requests set status = 'COMPLETED', completed_at = p_now
      where id = j.privacy_request_id;
    insert into ops.audit_logs (actor_type, action, target_type, target_id, household_id, details)
    values ('system', 'privacy.purged', lower(j.scope), coalesce(j.student_id, j.household_id, j.user_id),
            j.household_id, jsonb_build_object('jobId', j.id, 'anonymisedLedgerRows', anonymised,
                                               'deletedAccounts', deleted_users));
    done := done + 1;
  end loop;
  return done;
end;
$$;

select cron.schedule('vionx-privacy-purge', '37 20 * * *', $$select ops.purge_due_deletions()$$);

-- ---------------------------------------------------------------------------
-- RLS on, no client grants (CONTRACT §3)
-- ---------------------------------------------------------------------------
alter table app.policy_versions enable row level security;
alter table app.policy_acceptances enable row level security;
alter table app.consent_records enable row level security;
alter table app.privacy_requests enable row level security;
alter table app.data_export_jobs enable row level security;
alter table app.data_deletion_jobs enable row level security;
alter table ops.consent_job_queues enable row level security;
alter table ops.ledger_registry enable row level security;
revoke all on all tables in schema app, ops from public, anon, authenticated;
revoke all on all functions in schema app, ops from public, anon, authenticated;

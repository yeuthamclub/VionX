-- VionX M02 follow-up (product owner decisions 2026-10-08):
--   1. A deletion request (child or whole account) can be cancelled by the parent during the grace
--      period, now 14 days (Decree 356/2025 Art. 5(4): deletion completes within 20 days; purge_after
--      is set by the api from DELETION_GRACE_DAYS in @vionx/domain, the daily purge runs at most a
--      day later). Cancelling restores the login, marks the job CANCELLED (the purge only takes
--      SCHEDULED jobs), writes an audit log and emits `privacy.deletion_cancelled`.
--   2. Audit logs and domain events about purged data are kept for 1 year after the purge with
--      pseudonymous ids only: personal fields are scrubbed at purge time and a daily pg_cron job
--      deletes the rows 365 days after the purge.

-- ---------------------------------------------------------------------------
-- Cancellation bookkeeping on deletion jobs. restore_state records what the request changed so a
-- cancel puts back exactly that (a child the parent had disabled before stays disabled):
--   CHILD   {"studentWasDisabled": bool}
--   ACCOUNT {"disabledStudentIds": [uuid, ...]}   children already disabled before the request
-- ---------------------------------------------------------------------------
alter table app.data_deletion_jobs
  add column restore_state jsonb not null default '{}'::jsonb,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid,
  add constraint data_deletion_jobs_cancelled_check
    check ((status = 'CANCELLED') = (cancelled_at is not null));
comment on table app.data_deletion_jobs is 'Deletion: disabled at request time, cancellable by the parent until purge_after (request + 14 days, DELETION_GRACE_DAYS), then hard-deleted by pg_cron (ops.purge_due_deletions).';
comment on column app.households.deletion_requested_at is 'Account deletion requested: the household is hidden from the api and purged after the 14-day grace period unless the parent cancels.';
comment on column app.data_deletion_jobs.restore_state is 'State before the request, restored when the parent cancels during the grace period.';

-- ---------------------------------------------------------------------------
-- Retention of audit logs and domain events after a purge.
-- ---------------------------------------------------------------------------
alter table ops.audit_logs add column purged_at timestamptz;
alter table ops.domain_events add column purged_at timestamptz;
comment on column ops.audit_logs.purged_at is 'Set when the subject was purged: the row is scrubbed of personal fields and deleted 365 days later.';
comment on column ops.domain_events.purged_at is 'Set when the subject was purged: the row is scrubbed of personal fields and deleted 365 days later.';
create index audit_logs_purged_idx on ops.audit_logs (purged_at) where purged_at is not null;
create index domain_events_purged_idx on ops.domain_events (purged_at) where purged_at is not null;
create index domain_events_aggregate_idx on ops.domain_events (aggregate_id) where aggregate_id is not null;
create index audit_logs_target_idx on ops.audit_logs (target_id) where target_id is not null;

-- Audit logs and events stay append-only for everyone except the privacy scrub/retention
-- functions below, which switch `vionx.privacy_scrub` on for their own transaction. Even then an
-- UPDATE may change only details/payload, purged_at and updated_at.
create or replace function ops.retained_log_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('vionx.privacy_scrub', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    if (to_jsonb(new) - 'details' - 'payload' - 'purged_at' - 'updated_at')
       is distinct from (to_jsonb(old) - 'details' - 'payload' - 'purged_at' - 'updated_at') then
      raise exception 'table %.%: the privacy scrub may only change details/payload and purged_at',
        tg_table_schema, tg_table_name using errcode = 'P0001';
    end if;
    return new;
  end if;
  raise exception 'table %.% is append-only (% rejected)', tg_table_schema, tg_table_name, tg_op
    using errcode = 'P0001';
end;
$$;

drop trigger audit_logs_append_only on ops.audit_logs;
create trigger audit_logs_append_only
  before update or delete on ops.audit_logs
  for each row execute function ops.retained_log_guard();
drop trigger domain_events_append_only on ops.domain_events;
create trigger domain_events_append_only
  before update or delete on ops.domain_events
  for each row execute function ops.retained_log_guard();

-- Removes personal fields (names, phone, email, address, birth date, login id, raw device id, IP...)
-- from a jsonb value at any depth; ids and counters stay. Keys are compared lower-cased without
-- separators, so displayName, display_name and DISPLAY-NAME all match. Mirrors
-- PERSONAL_DATA_KEYS in @vionx/domain (a unit test keeps the two lists in sync).
create or replace function ops.strip_personal_fields(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  personal constant text[] := array[
    'name', 'displayname', 'fullname', 'firstname', 'lastname', 'nickname', 'householdname',
    'phone', 'phonenumber', 'email', 'emailaddress', 'address', 'birthyear', 'birthdate',
    'dateofbirth', 'childloginid', 'loginid', 'deviceid', 'ip', 'ipaddress', 'useragent'
  ];
begin
  if p is null then
    return null;
  end if;
  case jsonb_typeof(p)
    when 'object' then
      return coalesce((
        select jsonb_object_agg(e.key, ops.strip_personal_fields(e.value))
        from jsonb_each(p) as e
        where not (lower(regexp_replace(e.key, '[^A-Za-z0-9]', '', 'g')) = any(personal))
      ), '{}'::jsonb);
    when 'array' then
      return coalesce((
        select jsonb_agg(ops.strip_personal_fields(a.value) order by a.ordinality)
        from jsonb_array_elements(p) with ordinality as a
      ), '[]'::jsonb);
    else
      return p;
  end case;
end;
$$;

-- Scrubs and marks for retention every audit log and domain event about a purged subject:
-- rows of the household (whole-household purge), or rows whose actor/target/aggregate or
-- studentId/userId field is one of p_subject_ids. Returns the number of rows marked.
create or replace function ops.scrub_purged_logs(
  p_household_id uuid,
  p_whole_household boolean,
  p_subject_ids uuid[],
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ids text[] := coalesce(p_subject_ids::text[], '{}');
  audits integer;
  events integer;
begin
  perform set_config('vionx.privacy_scrub', 'on', true);
  update ops.audit_logs a
    set details = ops.strip_personal_fields(a.details),
        purged_at = coalesce(a.purged_at, p_now),
        updated_at = now()
    where (p_whole_household and p_household_id is not null and a.household_id = p_household_id)
       or a.target_id = any(p_subject_ids)
       or a.actor_id = any(p_subject_ids)
       or a.details->>'studentId' = any(ids)
       or a.details->>'userId' = any(ids);
  get diagnostics audits = row_count;
  update ops.domain_events e
    set payload = ops.strip_personal_fields(e.payload),
        purged_at = coalesce(e.purged_at, p_now),
        updated_at = now()
    where (p_whole_household and p_household_id is not null and e.household_id = p_household_id)
       or e.aggregate_id = any(p_subject_ids)
       or e.payload->>'studentId' = any(ids)
       or e.payload->>'userId' = any(ids);
  get diagnostics events = row_count;
  perform set_config('vionx.privacy_scrub', 'off', true);
  return audits + events;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hard delete after the grace period (replaces the 0003 version): as before, plus the scrub of
-- retained audit logs / events. Cancelled jobs are never taken (status SCHEDULED only).
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
  deleted_ids uuid[];
  deleted_users integer;
  scrubbed integer;
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
      scrubbed := ops.scrub_purged_logs(j.household_id, false, array[j.student_id], p_now);
    else
      anonymised := 0;
      members := array[j.user_id];
      if j.household_id is not null then
        anonymised := ops.anonymise_ledgers(j.household_id, null);
        select members || coalesce(array_agg(m.user_id), '{}') into members
          from app.household_memberships m where m.household_id = j.household_id;
        delete from app.households where id = j.household_id;
      end if;
      with d as (
        delete from auth.users u
          where u.id = any(members)
            and not exists (select 1 from app.household_memberships m where m.user_id = u.id)
          returning u.id
      )
      select coalesce(array_agg(d.id), '{}') into deleted_ids from d;
      deleted_users := cardinality(deleted_ids);
      scrubbed := ops.scrub_purged_logs(j.household_id, true, deleted_ids, p_now);
    end if;
    update app.data_deletion_jobs
      set status = 'COMPLETED', completed_at = p_now,
          result = jsonb_build_object('anonymisedLedgerRows', anonymised, 'deletedAccounts', deleted_users,
                                      'scrubbedLogRows', scrubbed)
      where id = j.id;
    update app.privacy_requests set status = 'COMPLETED', completed_at = p_now
      where id = j.privacy_request_id;
    insert into ops.audit_logs (actor_type, action, target_type, target_id, household_id, details, purged_at)
    values ('system', 'privacy.purged', lower(j.scope), coalesce(j.student_id, j.household_id, j.user_id),
            j.household_id, jsonb_build_object('jobId', j.id, 'anonymisedLedgerRows', anonymised,
                                               'deletedAccounts', deleted_users,
                                               'scrubbedLogRows', scrubbed),
            p_now);
    done := done + 1;
  end loop;
  return done;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention: audit logs and domain events of purged subjects are deleted 365 days after the purge
-- (pg_cron daily). Mirrors PURGED_LOG_RETENTION_DAYS in @vionx/domain.
-- ---------------------------------------------------------------------------
create or replace function ops.delete_expired_purged_logs(
  p_now timestamptz default now(),
  p_retention interval default interval '365 days'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := p_now - p_retention;
  audits integer;
  events integer;
begin
  perform set_config('vionx.privacy_scrub', 'on', true);
  delete from ops.processed_events p
    using ops.domain_events e
    where p.event_id = e.id and e.purged_at <= cutoff;
  delete from ops.domain_events where purged_at <= cutoff;
  get diagnostics events = row_count;
  delete from ops.audit_logs where purged_at <= cutoff;
  get diagnostics audits = row_count;
  perform set_config('vionx.privacy_scrub', 'off', true);
  return audits + events;
end;
$$;

select cron.schedule('vionx-purged-log-retention', '47 20 * * *', $$select ops.delete_expired_purged_logs()$$);

revoke all on all functions in schema app, ops from public, anon, authenticated;

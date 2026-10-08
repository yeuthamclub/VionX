-- VionX M02 follow-up (legal review 2026-10-08): a separate consent for cross-border transfer.
-- Storing data with Supabase in Singapore (and sending AI requests to Anthropic in the United
-- States) is a transfer of personal data abroad. Law 91/2025 Art. 9(4) requires a consent per
-- purpose, so it is no longer bundled into accepting the privacy policy: the parent grants
-- CROSS_BORDER_TRANSFER per child as its own step. It is required with CORE_SERVICE before a child
-- can sign in, and AI_PERSONALIZATION additionally requires it (rules in @vionx/domain).

alter table app.consent_records drop constraint consent_records_consent_type_check;
alter table app.consent_records add constraint consent_records_consent_type_check
  check (consent_type in (
    'CORE_SERVICE', 'CROSS_BORDER_TRANSFER', 'EDUCATION_ANALYTICS', 'AI_PERSONALIZATION',
    'MICROPHONE_SPEAKING', 'HEALTH_CONNECT_ACTIVITY', 'COMPETITION_AREA'
  ));

alter table ops.consent_job_queues drop constraint consent_job_queues_consent_type_check;
alter table ops.consent_job_queues add constraint consent_job_queues_consent_type_check
  check (consent_type in (
    'CORE_SERVICE', 'CROSS_BORDER_TRANSFER', 'EDUCATION_ANALYTICS', 'AI_PERSONALIZATION',
    'MICROPHONE_SPEAKING', 'HEALTH_CONNECT_ACTIVITY', 'COMPETITION_AREA'
  ));

-- Revoking CROSS_BORDER_TRANSFER, like CORE_SERVICE, ends the service: every scope is cancelled.
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
    where consent_type = p_consent_type
       or p_consent_type in ('CORE_SERVICE', 'CROSS_BORDER_TRANSFER')
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

revoke all on all functions in schema app, ops from public, anon, authenticated;

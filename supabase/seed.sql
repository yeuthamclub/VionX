-- Local development seed (runs on `supabase db reset` / `pnpm db:seed`; idempotent).
-- Vault entries so pg_cron can reach the local worker function. The secret is a local-only placeholder matching supabase/functions/.env.example;
-- staging/production set real values with vault.create_secret (see README).
do $$
begin
  delete from vault.secrets where name in ('vionx_worker_url', 'vionx_service_secret');
  perform vault.create_secret('http://supabase_kong_vionx:8000/functions/v1/worker', 'vionx_worker_url');
  perform vault.create_secret('local-dev-service-secret', 'vionx_service_secret');
end;
$$;

-- ---------------------------------------------------------------------------
-- M01 identity seed (LOCAL ONLY; all values below are public development fixtures).
--   SUPER_ADMIN   admin@vionx.local / vionx-admin-local   (email + password, admin SPA)
--   Demo parent   +84900000001, OTP 123456 (config.toml [auth.sms.test_otp])
--   Children      vx-demy22 (grade 2), vx-demy66 (grade 6), vx-demy99 (grade 9), PIN 2468
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, phone,
  phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-00000000ad01',
   'authenticated', 'authenticated', 'admin@vionx.local',
   extensions.crypt('vionx-admin-local', extensions.gen_salt('bf')), now(), null, null,
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-00000000de01',
   'authenticated', 'authenticated', null, null, null, '84900000001', now(),
   '{"provider":"phone","providers":["phone"]}', '{}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
values
  ('00000000-0000-4000-a000-00000000ad01', '00000000-0000-4000-a000-00000000ad01',
   '{"sub":"00000000-0000-4000-a000-00000000ad01","email":"admin@vionx.local","email_verified":true}',
   'email', now(), now()),
  ('00000000-0000-4000-a000-00000000de01', '00000000-0000-4000-a000-00000000de01',
   '{"sub":"00000000-0000-4000-a000-00000000de01","phone":"84900000001","phone_verified":true}',
   'phone', now(), now())
on conflict (provider_id, provider) do nothing;

insert into ops.admin_permissions (user_id, permission)
values ('00000000-0000-4000-a000-00000000ad01', 'SUPER_ADMIN')
on conflict do nothing;

insert into app.profiles (user_id, display_name) values
  ('00000000-0000-4000-a000-00000000ad01', 'VionX Admin'),
  ('00000000-0000-4000-a000-00000000de01', 'Phụ huynh Demo')
on conflict do nothing;

insert into app.households (id, name, timezone, created_by)
values ('00000000-0000-4000-b000-00000000de01', 'Gia đình Demo', 'Asia/Ho_Chi_Minh',
        '00000000-0000-4000-a000-00000000de01')
on conflict do nothing;

insert into app.household_memberships (household_id, user_id, role)
values ('00000000-0000-4000-b000-00000000de01', '00000000-0000-4000-a000-00000000de01', 'OWNER')
on conflict do nothing;

insert into app.students (id, household_id, display_name, birth_year, grade, avatar) values
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-00000000de01', 'Bé An', 2019, 2, 'rabbit'),
  ('00000000-0000-4000-c000-000000000006', '00000000-0000-4000-b000-00000000de01', 'Minh', 2014, 6, 'fox'),
  ('00000000-0000-4000-c000-000000000009', '00000000-0000-4000-b000-00000000de01', 'Lan', 2011, 9, 'owl')
on conflict do nothing;

-- argon2id (m=19456 KiB, t=2, p=1) hashes of PIN 2468, one salt each.
insert into app.child_credentials (student_id, household_id, child_login_id, pin_hash) values
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-00000000de01', 'vx-demy22',
   '$argon2id$v=19$m=19456,t=2,p=1$sBcWJ0LecPZ5cGaZuwz2RA$ZSiDTAWENAP2m9EuMqW/s8wF/iqW7+wG2kyiczbbF4g'),
  ('00000000-0000-4000-c000-000000000006', '00000000-0000-4000-b000-00000000de01', 'vx-demy66',
   '$argon2id$v=19$m=19456,t=2,p=1$GiVGvCKRWePrBgsGRYO7yA$uzcfaUl7VbhYoI1N75TyHmneVFoQHzFQ6QP9aDbwU3Q'),
  ('00000000-0000-4000-c000-000000000009', '00000000-0000-4000-b000-00000000de01', 'vx-demy99',
   '$argon2id$v=19$m=19456,t=2,p=1$P8EO8FrOJ4gPf3CHRFFcfg$i8sFSm3d4SYmcV1JoN12DDHJ8GT+BHCXBGZMPJYSxjo')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- M02 consent seed (LOCAL ONLY): the demo parent accepted policy version 1 and granted
-- CORE_SERVICE and CROSS_BORDER_TRANSFER to the three demo children, so the demo logins keep working.
-- ---------------------------------------------------------------------------
insert into app.policy_acceptances (user_id, policy_type, policy_version, locale) values
  ('00000000-0000-4000-a000-00000000de01', 'PRIVACY_POLICY', 1, 'vi'),
  ('00000000-0000-4000-a000-00000000de01', 'TERMS_OF_SERVICE', 1, 'vi')
on conflict do nothing;

insert into app.consent_records (
  household_id, student_id, consent_type, policy_version, status, granted_by_parent_id,
  child_assent_required, child_assent_status
)
select '00000000-0000-4000-b000-00000000de01', s.id, t.consent_type, 1, 'GRANTED',
       '00000000-0000-4000-a000-00000000de01', false, 'NOT_REQUIRED'
from app.students s
cross join (values ('CORE_SERVICE'), ('CROSS_BORDER_TRANSFER')) as t (consent_type)
where s.household_id = '00000000-0000-4000-b000-00000000de01'
  and not exists (
    select 1 from app.consent_records c
    where c.student_id = s.id and c.consent_type = t.consent_type and c.status = 'GRANTED'
  );

-- ---------------------------------------------------------------------------
-- M03 calendar & task seed (LOCAL ONLY): Minh (grade 6) has a Mon-Fri timetable, a weekday
-- homework task that needs the parent's approval and a one-off photo task today; Bé An (grade 2)
-- reads every day (self-check). Days are materialised for the next 14 days here; afterwards the
-- daily job (vionx-task-materialise) keeps them filled.
-- ---------------------------------------------------------------------------
insert into app.school_timetable_entries (id, household_id, student_id, weekday, start_time, end_time, subject_code, room)
select ('00000000-0000-4000-d000-0000000006' || lpad((w * 10 + p)::text, 2, '0'))::uuid,
       '00000000-0000-4000-b000-00000000de01', '00000000-0000-4000-c000-000000000006', w,
       (time '07:00' + (p - 1) * interval '50 minutes'),
       (time '07:45' + (p - 1) * interval '50 minutes'),
       (array['TOAN', 'NGU_VAN', 'TIENG_ANH', 'KHTN'])[1 + (w + p) % 4], '6A1'
from generate_series(1, 5) as w, generate_series(1, 4) as p
on conflict do nothing;

insert into app.task_assignments (id, household_id, assigned_student_id, created_by, type, title, description,
                                  subject_code, starts_on, window_start, window_end, duration_minutes, rrule,
                                  priority, required, reward_xp, verification_mode) values
  ('00000000-0000-4000-e000-000000000601', '00000000-0000-4000-b000-00000000de01',
   '00000000-0000-4000-c000-000000000006', '00000000-0000-4000-a000-00000000de01', 'HOMEWORK',
   'Làm bài tập về nhà', 'Hoàn thành bài tập cô giao hôm nay.', 'TOAN', current_date, '19:30', '20:30', 45,
   'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'HIGH', true, 20, 'PARENT_APPROVAL'),
  ('00000000-0000-4000-e000-000000000602', '00000000-0000-4000-b000-00000000de01',
   '00000000-0000-4000-c000-000000000006', '00000000-0000-4000-a000-00000000de01', 'HOUSEHOLD',
   'Dọn góc học tập', 'Chụp ảnh góc học tập sau khi dọn.', null, current_date, null, null, 15,
   null, 'NORMAL', false, 10, 'PHOTO_PROOF'),
  ('00000000-0000-4000-e000-000000000201', '00000000-0000-4000-b000-00000000de01',
   '00000000-0000-4000-c000-000000000002', '00000000-0000-4000-a000-00000000de01', 'READING',
   'Đọc sách 20 phút', null, 'TIENG_VIET', current_date, '20:00', '20:20', 20,
   'FREQ=DAILY', 'NORMAL', true, 10, 'SELF_CHECK')
on conflict do nothing;

insert into app.task_occurrences (household_id, student_id, assignment_id, occurs_on)
select a.household_id, a.assigned_student_id, a.id, d::date
from app.task_assignments a
cross join generate_series(current_date, current_date + 13, interval '1 day') as d
where a.id in ('00000000-0000-4000-e000-000000000601', '00000000-0000-4000-e000-000000000602',
               '00000000-0000-4000-e000-000000000201')
  and d::date >= a.starts_on
  and (a.rrule = 'FREQ=DAILY'
       or (a.rrule like 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' and extract(isodow from d) between 1 and 5)
       or (a.rrule is null and d::date = a.starts_on))
on conflict do nothing;

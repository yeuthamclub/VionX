-- VionX M03 — calendar, school timetable & tasks (TASK_PACKS/M03.md, Master Spec §13).
-- School subjects (GDPT 2018), weekly timetable, calendar events (§13.1 types), task templates,
-- tasks with a repeat rule (§13.2 fields), materialised daily occurrences (14 days ahead, daily
-- pg_cron request handled by the worker), completions idempotent by client UUID, photo proofs in a
-- private bucket. Rules live in @vionx/domain (calendar/). Migrations are never edited after merge.

-- ---------------------------------------------------------------------------
-- School subjects: the GDPT 2018 list (global reference data, no personal data)
-- ---------------------------------------------------------------------------
create table app.school_subjects (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name_vi text not null,
  name_en text not null,
  grade_from integer not null check (grade_from between 1 and 12),
  grade_to integer not null check (grade_to between 1 and 12),
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (grade_from <= grade_to)
);
comment on table app.school_subjects is 'GDPT 2018 subjects and educational activities with the grades they are taught in. Mirrors SCHOOL_SUBJECTS in @vionx/domain.';

insert into app.school_subjects (code, name_vi, name_en, grade_from, grade_to, sort_order) values
  ('TOAN', 'Toán', 'Mathematics', 1, 12, 10),
  ('TIENG_VIET', 'Tiếng Việt', 'Vietnamese', 1, 5, 20),
  ('NGU_VAN', 'Ngữ văn', 'Literature', 6, 12, 30),
  ('TIENG_ANH', 'Tiếng Anh', 'English', 1, 12, 40),
  ('DAO_DUC', 'Đạo đức', 'Ethics', 1, 5, 50),
  ('TNXH', 'Tự nhiên và Xã hội', 'Nature and Society', 1, 3, 60),
  ('KHOA_HOC', 'Khoa học', 'Science', 4, 5, 70),
  ('LICH_SU_DIA_LY', 'Lịch sử và Địa lí', 'History and Geography', 4, 9, 80),
  ('TIN_HOC_CONG_NGHE', 'Tin học và Công nghệ', 'Informatics and Technology', 3, 5, 90),
  ('KHTN', 'Khoa học tự nhiên', 'Natural Sciences', 6, 9, 100),
  ('GDCD', 'Giáo dục công dân', 'Civic Education', 6, 9, 110),
  ('TIN_HOC', 'Tin học', 'Informatics', 6, 12, 120),
  ('CONG_NGHE', 'Công nghệ', 'Technology', 6, 12, 130),
  ('LICH_SU', 'Lịch sử', 'History', 10, 12, 140),
  ('DIA_LI', 'Địa lí', 'Geography', 10, 12, 150),
  ('GDKT_PL', 'Giáo dục kinh tế và pháp luật', 'Economics and Law', 10, 12, 160),
  ('VAT_LI', 'Vật lí', 'Physics', 10, 12, 170),
  ('HOA_HOC', 'Hoá học', 'Chemistry', 10, 12, 180),
  ('SINH_HOC', 'Sinh học', 'Biology', 10, 12, 190),
  ('GDTC', 'Giáo dục thể chất', 'Physical Education', 1, 12, 200),
  ('AM_NHAC', 'Âm nhạc', 'Music', 1, 12, 210),
  ('MI_THUAT', 'Mĩ thuật', 'Fine Arts', 1, 12, 220),
  ('HDTN', 'Hoạt động trải nghiệm, hướng nghiệp', 'Experiential and Career Activities', 1, 12, 230),
  ('GDQP_AN', 'Giáo dục quốc phòng và an ninh', 'Defence and Security Education', 10, 12, 240),
  ('GDDP', 'Nội dung giáo dục địa phương', 'Local Education', 1, 12, 250),
  ('KHAC', 'Khác', 'Other', 1, 12, 990);

-- ---------------------------------------------------------------------------
-- Weekly school timetable (expanded into the calendar on read)
-- ---------------------------------------------------------------------------
create table app.school_timetable_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  student_id uuid not null,
  weekday integer not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  subject_code text not null references app.school_subjects (code),
  room text check (room is null or char_length(room) between 1 and 40),
  note text check (note is null or char_length(note) <= 200),
  valid_from date,
  valid_to date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade,
  check (start_time < end_time),
  check (valid_from is null or valid_to is null or valid_from <= valid_to)
);
comment on table app.school_timetable_entries is 'Weekly school periods per child (ISO weekday 1 = Monday, household-local times).';
create index school_timetable_student_idx
  on app.school_timetable_entries (household_id, student_id, weekday, start_time);

-- ---------------------------------------------------------------------------
-- Calendar events (Master Spec §13.1 types)
-- ---------------------------------------------------------------------------
create table app.calendar_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  student_id uuid not null,
  type text not null check (type in (
    'SCHOOL_CLASS', 'TUTORING', 'EXAM', 'LEARNING_BLOCK', 'ENGLISH', 'READING', 'SPORT',
    'HOUSEHOLD_TASK', 'CREATIVE', 'FAMILY_EVENT', 'CUSTOM'
  )),
  title text not null check (char_length(title) between 1 and 80),
  note text check (note is null or char_length(note) <= 500),
  location text check (location is null or char_length(location) <= 80),
  subject_code text references app.school_subjects (code),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade,
  check (starts_at < ends_at)
);
create index calendar_events_student_idx on app.calendar_events (household_id, student_id, starts_at);

-- ---------------------------------------------------------------------------
-- Task templates: built-in starters (household_id null; generic, no personal data) and the
-- household's own templates (saved from the task form).
-- ---------------------------------------------------------------------------
create table app.task_templates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references app.households (id) on delete cascade,
  type text not null check (type in (
    'HOMEWORK', 'LEARNING', 'READING', 'ENGLISH', 'SPORT', 'HOUSEHOLD', 'CREATIVE', 'CUSTOM'
  )),
  title text not null check (char_length(title) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 600),
  priority text not null default 'NORMAL' check (priority in ('LOW', 'NORMAL', 'HIGH')),
  verification_mode text not null check (verification_mode in (
    'SELF_CHECK', 'PHOTO_PROOF', 'PARENT_APPROVAL', 'SYSTEM_VERIFIED'
  )),
  reward_xp integer not null default 0 check (reward_xp between 0 and 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index task_templates_household_idx on app.task_templates (household_id, created_at);

insert into app.task_templates (type, title, description, duration_minutes, priority, verification_mode, reward_xp) values
  ('HOMEWORK', 'Làm bài tập về nhà', 'Hoàn thành bài tập cô giao hôm nay.', 45, 'HIGH', 'PARENT_APPROVAL', 20),
  ('READING', 'Đọc sách 20 phút', null, 20, 'NORMAL', 'SELF_CHECK', 10),
  ('ENGLISH', 'Luyện tiếng Anh 15 phút', null, 15, 'NORMAL', 'SELF_CHECK', 10),
  ('HOUSEHOLD', 'Dọn góc học tập', 'Chụp ảnh góc học tập sau khi dọn.', 15, 'NORMAL', 'PHOTO_PROOF', 10),
  ('SPORT', 'Vận động 30 phút', null, 30, 'NORMAL', 'SELF_CHECK', 10),
  ('HOUSEHOLD', 'Giúp bố mẹ việc nhà', null, 20, 'NORMAL', 'PARENT_APPROVAL', 10);

-- ---------------------------------------------------------------------------
-- Tasks (Master Spec §13.2). rrule: RFC 5545 subset FREQ=DAILY|WEEKLY;INTERVAL;BYDAY;COUNT;UNTIL
-- (validated by @vionx/domain parseRRule). Without rrule the task happens once, on starts_on.
-- ---------------------------------------------------------------------------
create table app.task_assignments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  assigned_student_id uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  template_id uuid references app.task_templates (id) on delete set null,
  type text not null check (type in (
    'HOMEWORK', 'LEARNING', 'READING', 'ENGLISH', 'SPORT', 'HOUSEHOLD', 'CREATIVE', 'CUSTOM'
  )),
  title text not null check (char_length(title) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  subject_code text references app.school_subjects (code),
  starts_on date not null,
  window_start time,
  window_end time,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 600),
  rrule text check (rrule is null or char_length(rrule) <= 200),
  priority text not null default 'NORMAL' check (priority in ('LOW', 'NORMAL', 'HIGH')),
  required boolean not null default true,
  reward_xp integer not null default 0 check (reward_xp between 0 and 1000),
  verification_mode text not null check (verification_mode in (
    'SELF_CHECK', 'PHOTO_PROOF', 'PARENT_APPROVAL', 'SYSTEM_VERIFIED'
  )),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (assigned_student_id, household_id) references app.students (id, household_id) on delete cascade,
  check (window_start is null or window_end is null or window_start < window_end),
  check ((status = 'ARCHIVED') = (archived_at is not null))
);
comment on table app.task_assignments is 'Parent-assigned tasks (§13.2). Children only complete occurrences; they never edit tasks.';
create index task_assignments_student_idx
  on app.task_assignments (household_id, assigned_student_id, status);
create index task_assignments_recurring_idx on app.task_assignments (status) where rrule is not null;

-- One row per task and household-local day.
create table app.task_occurrences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  student_id uuid not null,
  assignment_id uuid not null,
  occurs_on date not null,
  status text not null default 'ASSIGNED' check (status in (
    'ASSIGNED', 'PENDING_APPROVAL', 'COMPLETED', 'REJECTED'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, occurs_on),
  unique (id, household_id),
  foreign key (assignment_id, household_id) references app.task_assignments (id, household_id) on delete cascade,
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade
);
comment on table app.task_occurrences is 'Materialised task days: one-off tasks at creation, recurring tasks 14 days ahead (daily job, idempotent).';
create index task_occurrences_student_idx on app.task_occurrences (household_id, student_id, occurs_on);
create index task_occurrences_pending_idx on app.task_occurrences (household_id)
  where status = 'PENDING_APPROVAL';

-- Completions: idempotent by the client's UUID (offline queue, Master Spec §26).
create table app.task_completions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  student_id uuid not null,
  assignment_id uuid not null,
  occurrence_id uuid not null,
  client_uuid uuid not null unique,
  status text not null check (status in ('PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
  completed_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_type text check (decided_by_type in ('parent', 'system')),
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (occurrence_id, household_id) references app.task_occurrences (id, household_id) on delete cascade,
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade,
  check ((status = 'PENDING_APPROVAL') = (decided_at is null))
);
comment on table app.task_completions is 'A child completing one task occurrence. client_uuid makes completion idempotent; a rejected completion can be followed by a new one.';
create unique index task_completions_live_uidx on app.task_completions (occurrence_id)
  where status in ('PENDING_APPROVAL', 'APPROVED');
create index task_completions_household_idx on app.task_completions (household_id, status, completed_at desc);

-- Photo proofs (private bucket task-proofs, path <household>/<student>/<task>/<uuid>.<ext>).
create table app.task_proofs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  student_id uuid not null,
  completion_id uuid not null,
  storage_path text not null unique check (char_length(storage_path) <= 300),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (completion_id, household_id) references app.task_completions (id, household_id) on delete cascade,
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade,
  check (storage_path like household_id::text || '/' || student_id::text || '/%')
);
create index task_proofs_completion_idx on app.task_proofs (completion_id);

create trigger school_subjects_updated_at before update on app.school_subjects
  for each row execute function ops.set_updated_at();
create trigger school_timetable_entries_updated_at before update on app.school_timetable_entries
  for each row execute function ops.set_updated_at();
create trigger calendar_events_updated_at before update on app.calendar_events
  for each row execute function ops.set_updated_at();
create trigger task_templates_updated_at before update on app.task_templates
  for each row execute function ops.set_updated_at();
create trigger task_assignments_updated_at before update on app.task_assignments
  for each row execute function ops.set_updated_at();
create trigger task_occurrences_updated_at before update on app.task_occurrences
  for each row execute function ops.set_updated_at();
create trigger task_completions_updated_at before update on app.task_completions
  for each row execute function ops.set_updated_at();
create trigger task_proofs_updated_at before update on app.task_proofs
  for each row execute function ops.set_updated_at();

-- ---------------------------------------------------------------------------
-- Private Storage bucket for proof photos (service role only: no storage.objects policies;
-- the app uploads through a signed upload URL from POST /v1/uploads/sign).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-proofs', 'task-proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Daily materialisation (TASK_PACKS/M03): pg_cron writes one outbox event per day; the worker
-- handler `task.materialise_requested` inserts the next 14 household-local days of every active
-- recurring task (insert … on conflict do nothing, so repeats are harmless). The repeat-rule logic
-- stays in one place (@vionx/domain).
-- ---------------------------------------------------------------------------
create or replace function ops.request_task_materialisation(p_now timestamptz default now())
returns void
language sql
security definer
set search_path = ''
as $$
  insert into ops.domain_events (type, aggregate_type, payload, idempotency_key)
  values ('task.materialise_requested', 'system',
          jsonb_build_object('requestedAt', p_now),
          'materialise:' || to_char(p_now at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD'))
  on conflict do nothing;
$$;

-- 00:05 Asia/Ho_Chi_Minh (pg_cron runs in UTC).
select cron.schedule('vionx-task-materialise', '5 17 * * *', $$select ops.request_task_materialisation()$$);

-- ---------------------------------------------------------------------------
-- RLS on, no client grants (CONTRACT §3)
-- ---------------------------------------------------------------------------
alter table app.school_subjects enable row level security;
alter table app.school_timetable_entries enable row level security;
alter table app.calendar_events enable row level security;
alter table app.task_templates enable row level security;
alter table app.task_assignments enable row level security;
alter table app.task_occurrences enable row level security;
alter table app.task_completions enable row level security;
alter table app.task_proofs enable row level security;
revoke all on all tables in schema app, ops from public, anon, authenticated;
revoke all on all functions in schema app, ops from public, anon, authenticated;

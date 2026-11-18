-- VionX M08 — parent dashboard & school gradebook (TASK_PACKS/M08.md, Master Spec §7, §12).
-- Family data in schema `app`: household_id + index, RLS on, no client grants (CONTRACT §3).
-- Rules live in @vionx/domain (dashboard/). 0011 is taken by the Toán 5 profile branch.

-- ---------------------------------------------------------------------------
-- Dashboard config: versioned JSON, the highest version is in force. Mirrors
-- DEFAULT_DASHBOARD_CONFIG in @vionx/domain (an integration test keeps them equal).
-- ---------------------------------------------------------------------------
create table app.dashboard_config (
  version integer primary key check (version >= 1),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table app.dashboard_config is 'Data sufficiency thresholds and the rules behind the dashboard widgets. Global, no personal data. A change inserts the next version.';

insert into app.dashboard_config (version, config) values (1, '{
  "sufficiency": {
    "skillAttempts": { "low": 3, "ok": 8 },
    "subjectAttempts": { "low": 10, "ok": 30 },
    "grades": { "low": 2, "ok": 4 },
    "activeDays": { "low": 3, "ok": 7 }
  },
  "ranges": { "7d": 7, "30d": 30, "90d": 90 },
  "trendMinDeltaPercent": 5,
  "improvingMargin": 0.1,
  "atRiskMargin": 0.15,
  "atRiskForgetting": 0.6,
  "skillListLimit": 5,
  "examHorizonDays": 14
}'::jsonb);

-- ---------------------------------------------------------------------------
-- School gradebook (Master Spec §12): entered by a parent, never merged with app mastery.
-- ---------------------------------------------------------------------------
create table app.school_assessments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  student_id uuid not null,
  subject_code text not null references app.school_subjects (code),
  assessed_on date not null,
  type text not null check (type in (
    'ORAL', 'SHORT_QUIZ', 'HOMEWORK', 'PERIODIC_TEST', 'MIDTERM', 'FINAL', 'MOCK', 'CUSTOM'
  )),
  score numeric(6, 2) not null check (score >= 0),
  max_score numeric(6, 2) not null default 10 check (max_score > 0),
  school_year text not null check (school_year ~ '^\d{4}-\d{4}$'),
  semester text not null check (semester in ('HK1', 'HK2', 'SUMMER')),
  topic_tags text[] not null default '{}' check (cardinality(topic_tags) <= 10),
  note text check (note is null or char_length(note) <= 500),
  teacher_comment text check (teacher_comment is null or char_length(teacher_comment) <= 500),
  attachment_path text unique check (attachment_path is null or char_length(attachment_path) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade,
  check (score <= max_score),
  check (attachment_path is null
         or attachment_path like household_id::text || '/' || student_id::text || '/%')
);
comment on table app.school_assessments is 'School grades a parent entered (§12). Shown beside app mastery, never combined with it.';
create index school_assessments_student_idx
  on app.school_assessments (household_id, student_id, assessed_on desc);

create table app.school_assessment_skill_mappings (
  assessment_id uuid not null,
  skill_id uuid not null references library.curriculum_nodes (id),
  household_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (assessment_id, skill_id),
  foreign key (assessment_id, household_id)
    references app.school_assessments (id, household_id) on delete cascade
);
comment on table app.school_assessment_skill_mappings is 'Curriculum skills one school assessment covered (several per assessment).';
create index school_assessment_skill_mappings_household_idx
  on app.school_assessment_skill_mappings (household_id);

-- ---------------------------------------------------------------------------
-- One row per child and household-local day: what the dashboard needs about that day, so a
-- 90-day view does not re-read tasks, sessions and ledgers. Written by
-- refreshDaySummary (worker on task/session/settlement events, api on read for today).
-- ---------------------------------------------------------------------------
create table app.student_day_summaries (
  student_id uuid not null,
  local_day date not null,
  household_id uuid not null,
  tasks_total integer not null default 0 check (tasks_total >= 0),
  tasks_done integer not null default 0 check (tasks_done between 0 and tasks_total),
  required_total integer not null default 0 check (required_total >= 0),
  required_done integer not null default 0 check (required_done between 0 and required_total),
  sessions integer not null default 0 check (sessions >= 0),
  learning_minutes integer not null default 0 check (learning_minutes >= 0),
  answers integer not null default 0 check (answers >= 0),
  correct integer not null default 0 check (correct between 0 and answers),
  xp_earned integer not null default 0,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, local_day),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade
);
comment on table app.student_day_summaries is 'Daily totals per child (tasks, practice, XP). Derived; rebuilt from the source rows at any time.';
create index student_day_summaries_household_idx
  on app.student_day_summaries (household_id, student_id, local_day desc);

create trigger dashboard_config_immutable before update on app.dashboard_config
  for each row execute function ops.forbid_mutation();
create trigger school_assessments_updated_at before update on app.school_assessments
  for each row execute function ops.set_updated_at();
create trigger school_assessment_skill_mappings_updated_at
  before update on app.school_assessment_skill_mappings
  for each row execute function ops.set_updated_at();
create trigger student_day_summaries_updated_at before update on app.student_day_summaries
  for each row execute function ops.set_updated_at();

-- Private bucket for photos or PDFs of school tests (service role only; signed URLs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assessment-files', 'assessment-files', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS on, no client grants (CONTRACT §3)
-- ---------------------------------------------------------------------------
alter table app.dashboard_config enable row level security;
alter table app.school_assessments enable row level security;
alter table app.school_assessment_skill_mappings enable row level security;
alter table app.student_day_summaries enable row level security;
revoke all on all tables in schema app, ops from public, anon, authenticated;
revoke all on all functions in schema app, ops from public, anon, authenticated;

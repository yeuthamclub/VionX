-- VionX M07 — Today planner (TASK_PACKS/M07.md, Master Spec §11).
-- Family data in schema `app`: household_id + index, RLS on, no client grants (CONTRACT §3).
-- Rules live in @vionx/domain (planner/). 0011 is taken by the Toán 5 profile branch.

-- ---------------------------------------------------------------------------
-- Planner config: versioned JSON, the highest version is in force. Mirrors
-- DEFAULT_PLANNER_CONFIG in @vionx/domain (an integration test keeps them equal).
-- ---------------------------------------------------------------------------
create table app.planner_config (
  version integer primary key check (version >= 1),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table app.planner_config is 'Weights of the §11 priority formula, session lengths by grade, daily budget defaults. Global, no personal data. A change inserts the next version.';

insert into app.planner_config (version, config) values (1, '{
  "weights": {
    "urgency": 30,
    "prerequisiteGap": 20,
    "forgettingRisk": 20,
    "curriculumImportance": 10,
    "examRelevance": 40,
    "parentPriority": 20,
    "recentWorkloadPenalty": 15
  },
  "sessionMinutes": [
    { "maxGrade": 3, "minutes": 15 },
    { "maxGrade": 6, "minutes": 25 },
    { "maxGrade": 9, "minutes": 35 },
    { "maxGrade": 12, "minutes": 45 }
  ],
  "defaultBudgetSessions": 3,
  "dayWindow": { "start": "06:00", "end": "21:30" },
  "examHorizonDays": 14,
  "examSkillsWithoutList": 2,
  "optionalTaskUrgency": 0.4,
  "defaultTaskMinutes": 15,
  "maxLearningItems": 6,
  "maxAgeMinutes": 15
}'::jsonb);

-- Parent setting per child: minutes a day for Today (null = the default of the grade).
create table app.planner_settings (
  student_id uuid primary key,
  household_id uuid not null,
  daily_minutes integer check (daily_minutes is null or daily_minutes between 10 and 480),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade
);
create index planner_settings_household_idx on app.planner_settings (household_id);

-- Skills an exam covers (library ids, no personal data in the library). Empty = the planner
-- picks the weakest skills of the exam's subject.
alter table app.calendar_events
  add column skill_ids uuid[] not null default '{}' check (cardinality(skill_ids) <= 50);

-- ---------------------------------------------------------------------------
-- One plan per child and household-local day; regenerated in place (version counts the changes).
-- ---------------------------------------------------------------------------
create table app.today_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  student_id uuid not null,
  local_date date not null,
  version integer not null default 1 check (version >= 1),
  budget_minutes integer not null check (budget_minutes >= 0),
  free_minutes integer not null check (free_minutes >= 0),
  session_minutes integer not null check (session_minutes > 0),
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, local_date),
  unique (id, household_id),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade
);
comment on table app.today_plans is 'Today plan of a child (Master Spec §11). Derived from tasks, exams, mastery and reviews; pins, removals and skips of the day are kept across regenerations.';
create index today_plans_household_idx on app.today_plans (household_id, student_id, local_date desc);

create table app.today_plan_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  student_id uuid not null,
  plan_id uuid not null,
  kind text not null check (kind in (
    'PARENT_TASK', 'HOMEWORK', 'EXAM_PREP', 'WEAK_PREREQUISITE', 'DUE_REVIEW', 'READING_GOAL',
    'ACTIVITY_GOAL', 'NEXT_SKILL'
  )),
  -- Stable identity inside a plan: `<kind>:<occurrence id | skill id | subject>`.
  ref_key text not null check (char_length(ref_key) between 1 and 120),
  ref_id uuid,
  title text not null check (char_length(title) <= 300),
  subject text,
  minutes integer not null check (minutes between 1 and 600),
  priority numeric(7, 2) not null,
  reasons jsonb not null check (jsonb_typeof(reasons) = 'array' and jsonb_array_length(reasons) > 0),
  status text not null default 'PLANNED' check (status in (
    'PLANNED', 'STARTED', 'PENDING_APPROVAL', 'DONE', 'SKIPPED', 'REMOVED'
  )),
  pinned boolean not null default false,
  required boolean not null default false,
  in_budget boolean not null default true,
  reward_xp integer not null default 0 check (reward_xp >= 0),
  position integer not null check (position >= 0),
  -- {type: 'TASK', taskId, occurrenceId, verificationMode} | {type: 'SESSION', mode, skillIds, subject}
  link jsonb not null check (jsonb_typeof(link) = 'object'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, ref_key),
  foreign key (plan_id, household_id) references app.today_plans (id, household_id) on delete cascade,
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade
);
comment on table app.today_plan_items is 'Items of a Today plan with priority and reasons[] (§11). Task items mirror the task occurrence; learning items complete when a session covers them (SYSTEM_VERIFIED).';
create index today_plan_items_plan_idx on app.today_plan_items (household_id, plan_id, position);

create trigger planner_config_immutable before update on app.planner_config
  for each row execute function ops.forbid_mutation();
create trigger planner_settings_updated_at before update on app.planner_settings
  for each row execute function ops.set_updated_at();
create trigger today_plans_updated_at before update on app.today_plans
  for each row execute function ops.set_updated_at();
create trigger today_plan_items_updated_at before update on app.today_plan_items
  for each row execute function ops.set_updated_at();

-- ---------------------------------------------------------------------------
-- Day start: hourly request; the worker handler `planner.day_start_requested` writes the plan of
-- every child whose household-local day has no plan yet, so each timezone gets its plans within
-- the hour after its midnight (Asia/Ho_Chi_Minh: 00:10 local). Idempotent per hour.
-- ---------------------------------------------------------------------------
create or replace function ops.request_today_plans(p_now timestamptz default now())
returns void
language sql
security definer
set search_path = ''
as $$
  insert into ops.domain_events (type, aggregate_type, payload, idempotency_key)
  values ('planner.day_start_requested', 'system',
          jsonb_build_object('requestedAt', p_now),
          'today:' || to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24'))
  on conflict do nothing;
$$;

select cron.schedule('vionx-today-plans', '10 * * * *', $$select ops.request_today_plans()$$);

-- ---------------------------------------------------------------------------
-- RLS on, no client grants (CONTRACT §3)
-- ---------------------------------------------------------------------------
alter table app.planner_config enable row level security;
alter table app.planner_settings enable row level security;
alter table app.today_plans enable row level security;
alter table app.today_plan_items enable row level security;
revoke all on all tables in schema app, ops from public, anon, authenticated;
revoke all on all functions in schema app, ops from public, anon, authenticated;

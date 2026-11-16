-- VionX M06 — practice sessions, mastery, spaced review (TASK_PACKS/M06.md, Master Spec §10).
-- Family data in schema `app`: every table has household_id + index, RLS on, no client grants
-- (CONTRACT §3). Rules live in @vionx/domain (mastery/). 0011 is taken by the Toán 5 profile branch.

-- ---------------------------------------------------------------------------
-- Mastery config: versioned JSON, the highest version is in force. Mirrors
-- DEFAULT_MASTERY_CONFIG in @vionx/domain (an integration test keeps them equal).
-- ---------------------------------------------------------------------------
create table app.mastery_config (
  version integer primary key check (version >= 1),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table app.mastery_config is 'Weights and thresholds of the mastery strategy, review intervals, session sizes and practice XP caps. Global, no personal data. A change inserts the next version.';

insert into app.mastery_config (version, config) values (1, '{
  "gainCorrect": 8,
  "lossIncorrect": 4,
  "difficultyWeights": [0.6, 0.8, 1, 1.2, 1.4],
  "hintPenalty": 0.2,
  "minIndependence": 0.2,
  "minIntervalSec": 20,
  "recencyFloor": 0.25,
  "thresholds": { "learning": 25, "proficient": 60, "mastered": 85 },
  "retentionMinDays": 7,
  "recentAlpha": 0.3,
  "confidenceHalf": 5,
  "startDifficulty": 2,
  "reviewShare": 0.3,
  "diagnostic": { "minItems": 8, "maxItems": 12, "defaultItems": 10, "placementCeiling": 80, "untestedFactor": 0.75 },
  "review": { "firstIntervalsDays": [1, 3], "startEase": 2.5, "minEase": 1.3 },
  "session": { "itemsYoung": 10, "items": 15, "minutesYoung": 15, "minutes": 25, "youngMaxGrade": 3 },
  "xp": { "perCorrect": 5, "maxPerSession": 100, "maxSessionGrantsPerDay": 10 }
}'::jsonb);

-- ---------------------------------------------------------------------------
-- Sessions. `current_item` is the item being served ({itemId, skillId, seed, slot, hintsUsed,
-- servedAt}); the answer is judged against that stored seed. `served` ([{itemId, skillId}]),
-- `wrong_items` and `diagnostic_answers` are working state of an ACTIVE session, emptied at finish.
-- `analytics` records whether EDUCATION_ANALYTICS was in force when the session started.
-- ---------------------------------------------------------------------------
create table app.learning_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  student_id uuid not null,
  client_uuid uuid not null unique,
  mode text not null check (mode in ('PRACTICE', 'REVIEW', 'DIAGNOSTIC')),
  skill_ids uuid[] not null check (cardinality(skill_ids) > 0),
  topic_node_id uuid references library.curriculum_nodes (id),
  grade smallint not null check (grade between 1 and 12),
  subject text not null check (subject ~ '^[a-z]+$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'FINISHED')),
  analytics boolean not null,
  target_items integer not null check (target_items between 1 and 50),
  max_minutes integer not null check (max_minutes between 1 and 120),
  answered_count integer not null default 0 check (answered_count >= 0),
  correct_count integer not null default 0 check (correct_count between 0 and answered_count),
  hints_count integer not null default 0 check (hints_count >= 0),
  current_item jsonb,
  last_answer jsonb,
  served jsonb not null default '[]'::jsonb,
  wrong_items jsonb not null default '[]'::jsonb,
  diagnostic_answers jsonb not null default '[]'::jsonb,
  summary jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade,
  check ((status = 'FINISHED') = (finished_at is not null))
);
comment on table app.learning_sessions is 'Practice, review and diagnostic sessions of a child. Idempotent by client_uuid. Counters are aggregates; per-answer rows are in app.answer_attempts (only with EDUCATION_ANALYTICS).';
create index learning_sessions_student_idx on app.learning_sessions (household_id, student_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Per-answer rows: written only when the session has `analytics`.
-- ---------------------------------------------------------------------------
create table app.answer_attempts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  student_id uuid not null,
  session_id uuid not null,
  item_id uuid not null references library.items (id),
  skill_id uuid not null references library.curriculum_nodes (id),
  variant_seed bigint,
  response jsonb not null,
  is_correct boolean not null,
  hints_used smallint not null default 0 check (hints_used between 0 and 4),
  response_ms integer check (response_ms >= 0),
  difficulty smallint not null check (difficulty between 1 and 5),
  mastery_delta numeric(6, 2) not null default 0,
  client_uuid uuid not null unique,
  answered_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (session_id, household_id) references app.learning_sessions (id, household_id) on delete cascade,
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade
);
comment on table app.answer_attempts is 'One row per answered item (response, seed of the variant, hints, time). Feeds library.item_stats through ops.learning_nightly() as aggregates only.';
create index answer_attempts_student_idx on app.answer_attempts (household_id, student_id, answered_at desc);
create index answer_attempts_item_idx on app.answer_attempts (item_id);

-- ---------------------------------------------------------------------------
-- Skill state (Master Spec §10.1). The display state (§10.2) is derived by @vionx/domain.
-- ---------------------------------------------------------------------------
create table app.student_skill_states (
  student_id uuid not null,
  skill_id uuid not null references library.curriculum_nodes (id),
  household_id uuid not null,
  mastery_score numeric(5, 2) not null default 0 check (mastery_score between 0 and 100),
  confidence_score numeric(4, 3) not null default 0 check (confidence_score between 0 and 1),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  correct_count integer not null default 0 check (correct_count between 0 and attempt_count),
  recent_accuracy numeric(4, 3) not null default 0 check (recent_accuracy between 0 and 1),
  avg_response_ms integer check (avg_response_ms >= 0),
  current_difficulty smallint not null default 2 check (current_difficulty between 1 and 5),
  last_attempt_at timestamptz,
  last_mastered_at timestamptz,
  retained_at timestamptz,
  next_review_at timestamptz,
  forgetting_risk numeric(4, 3) not null default 0 check (forgetting_risk between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, skill_id),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade
);
comment on table app.student_skill_states is 'Mastery of one skill by one child (§10.1). XP is not mastery.';
create index student_skill_states_household_idx on app.student_skill_states (household_id, student_id);

create table app.review_schedule (
  student_id uuid not null,
  skill_id uuid not null references library.curriculum_nodes (id),
  household_id uuid not null,
  repetitions integer not null default 0 check (repetitions >= 0),
  interval_days numeric(7, 2) not null check (interval_days > 0),
  ease numeric(4, 2) not null check (ease >= 1),
  due_at timestamptz not null,
  last_reviewed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, skill_id),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade
);
comment on table app.review_schedule is 'Spaced review per skill (SM-2-like; intervals from app.mastery_config).';
create index review_schedule_due_idx on app.review_schedule (household_id, student_id, due_at);

-- Written only with EDUCATION_ANALYTICS.
create table app.mistake_patterns (
  student_id uuid not null,
  skill_id uuid not null references library.curriculum_nodes (id),
  misconception text not null check (char_length(misconception) between 1 and 80),
  household_id uuid not null,
  occurrences integer not null default 1 check (occurrences > 0),
  last_item_id uuid references library.items (id),
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, skill_id, misconception),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade
);
comment on table app.mistake_patterns is 'How often a child chose a wrong option tied to a misconception tag, per skill.';
create index mistake_patterns_household_idx on app.mistake_patterns (household_id, student_id);

-- Written only with EDUCATION_ANALYTICS.
create table app.student_item_history (
  student_id uuid not null,
  item_id uuid not null references library.items (id),
  household_id uuid not null,
  seen_count integer not null default 1 check (seen_count > 0),
  -- Most recent variant seeds of a TEMPLATE item (newest last, at most 20).
  seeds bigint[] not null default '{}',
  last_correct boolean,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, item_id),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade
);
comment on table app.student_item_history is 'Items and template seeds a child has seen, so sessions prefer unseen items and new seeds.';
create index student_item_history_household_idx on app.student_item_history (household_id, student_id);

create trigger mastery_config_immutable before update on app.mastery_config
  for each row execute function ops.forbid_mutation();
create trigger learning_sessions_updated_at before update on app.learning_sessions
  for each row execute function ops.set_updated_at();
create trigger student_skill_states_updated_at before update on app.student_skill_states
  for each row execute function ops.set_updated_at();
create trigger review_schedule_updated_at before update on app.review_schedule
  for each row execute function ops.set_updated_at();
create trigger mistake_patterns_updated_at before update on app.mistake_patterns
  for each row execute function ops.set_updated_at();
create trigger student_item_history_updated_at before update on app.student_item_history
  for each row execute function ops.set_updated_at();

-- ---------------------------------------------------------------------------
-- Nightly aggregate (ARCHITECTURE §3 quality loop): attempts → library.item_stats as counts and
-- rates only (no student or household id leaves schema app), report counts, and a refresh of
-- forgetting_risk = 1 − 0.5^(days since last attempt / review interval).
-- ---------------------------------------------------------------------------
create or replace function ops.learning_nightly(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  touched integer;
begin
  insert into library.item_stats (item_id, attempts, p_correct, median_ms, hint_rate, report_count, last_computed_at)
  select i.id,
         coalesce(a.attempts, 0),
         a.p_correct,
         a.median_ms,
         a.hint_rate,
         coalesce(r.reports, 0),
         p_now
  from library.items i
  left join (
    select item_id,
           count(*)::int as attempts,
           round(avg(is_correct::int), 4) as p_correct,
           (percentile_cont(0.5) within group (order by response_ms))::int as median_ms,
           round(avg((hints_used > 0)::int), 4) as hint_rate
    from app.answer_attempts group by item_id
  ) a on a.item_id = i.id
  left join (
    select item_id, count(*)::int as reports from library.item_reports group by item_id
  ) r on r.item_id = i.id
  where a.item_id is not null or r.item_id is not null
  on conflict (item_id) do update set
    attempts = excluded.attempts,
    p_correct = excluded.p_correct,
    median_ms = excluded.median_ms,
    hint_rate = excluded.hint_rate,
    report_count = excluded.report_count,
    last_computed_at = excluded.last_computed_at,
    updated_at = p_now;
  get diagnostics touched = row_count;

  update app.student_skill_states s
  set forgetting_risk = round((1 - power(0.5::numeric,
        (greatest(extract(epoch from p_now - s.last_attempt_at), 0) / 86400.0)::numeric
        / r.interval_days))::numeric, 3)
  from app.review_schedule r
  where r.student_id = s.student_id and r.skill_id = s.skill_id and s.last_attempt_at is not null;

  return touched;
end;
$$;

-- 18:30 UTC = 01:30 in Ho Chi Minh City.
select cron.schedule('vionx-learning-nightly', '30 18 * * *', $$select ops.learning_nightly()$$);

-- ---------------------------------------------------------------------------
-- RLS on, no client grants (CONTRACT §3)
-- ---------------------------------------------------------------------------
alter table app.mastery_config enable row level security;
alter table app.learning_sessions enable row level security;
alter table app.answer_attempts enable row level security;
alter table app.student_skill_states enable row level security;
alter table app.review_schedule enable row level security;
alter table app.mistake_patterns enable row level security;
alter table app.student_item_history enable row level security;
revoke all on all tables in schema app, ops from public, anon, authenticated;
revoke all on all functions in schema app, ops from public, anon, authenticated;

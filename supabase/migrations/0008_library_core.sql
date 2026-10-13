-- VionX M05 — curriculum & shared content library core (TASK_PACKS/M05.md).
-- Schema `library` is global and reused by every user: no household_id, no personal data.
-- Clients get no table access (CONTRACT §3); the api function reads and writes as postgres.
-- Package entities carry a stable `code` and a `content_hash` so re-importing a package is a no-op;
-- entities missing from a newer package are ARCHIVED, never deleted.

-- ---------------------------------------------------------------------------
-- Curriculum (Master Spec §8)
-- ---------------------------------------------------------------------------
create table library.curriculum_versions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9_-]*$'),
  title text not null,
  academic_year text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table library.curriculum_versions is 'Curriculum versions (GDPT 2018 = gdpt2018). Never overwritten destructively once progress references them.';

create table library.curriculum_nodes (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references library.curriculum_versions (id),
  parent_id uuid references library.curriculum_nodes (id),
  level text not null check (level in (
    'GRADE', 'SUBJECT', 'DOMAIN', 'TOPIC', 'LESSON', 'OBJECTIVE', 'CONCEPT', 'SKILL'
  )),
  code text not null,
  grade smallint not null check (grade between 1 and 12),
  -- null only for GRADE nodes, which several subject packages share.
  subject text check (subject ~ '^[a-z]+$'),
  title_vi text not null,
  description text,
  gdpt_requirement_ref text,
  weight numeric(6, 3) not null default 1 check (weight >= 0),
  sort_order integer not null default 0,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (version_id, code),
  check ((level = 'GRADE') = (subject is null)),
  check ((level = 'GRADE') = (parent_id is null))
);
comment on table library.curriculum_nodes is 'GDPT 2018 skill backbone (CONTRACT D5). Items attach to SKILL nodes. A skill is active only with >= 2 approved items (library.skill_item_counts).';
create index curriculum_nodes_parent_idx on library.curriculum_nodes (parent_id);
create index curriculum_nodes_scope_idx on library.curriculum_nodes (version_id, grade, subject, level);

create table library.knowledge_edges (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references library.curriculum_versions (id),
  from_node_id uuid not null references library.curriculum_nodes (id),
  to_node_id uuid not null references library.curriculum_nodes (id),
  type text not null check (type in (
    'PREREQUISITE_OF', 'PART_OF', 'RELATED_TO', 'NEXT_RECOMMENDED', 'EQUIVALENT_OR_OVERLAP'
  )),
  reason text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_node_id, to_node_id, type),
  check (from_node_id <> to_node_id)
);
create index knowledge_edges_to_idx on library.knowledge_edges (to_node_id);

create table library.book_series (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  publisher text,
  grade smallint not null check (grade between 1 and 12),
  subject text not null check (subject ~ '^[a-z]+$'),
  academic_year text,
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table library.book_series is 'Textbook series. Books map onto the curriculum; they are not the hierarchy (§8.1).';

create table library.book_lesson_mappings (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references library.book_series (id),
  lesson_ref text not null,
  title text,
  page_start integer check (page_start > 0),
  page_end integer check (page_end >= page_start),
  node_id uuid not null references library.curriculum_nodes (id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, lesson_ref, node_id)
);
create index book_lesson_mappings_node_idx on library.book_lesson_mappings (node_id);

-- ---------------------------------------------------------------------------
-- Subject profiles (CONTENT_PLAN_vi.md §3)
-- ---------------------------------------------------------------------------
create table library.subject_profiles (
  grade smallint not null check (grade between 1 and 12),
  subject text not null check (subject ~ '^[a-z]+$'),
  title_vi text not null,
  template_share numeric(4, 3) not null check (template_share between 0 and 1),
  group_share numeric(4, 3) not null check (group_share between 0 and 1),
  written_share numeric(4, 3) not null check (written_share between 0 and 1),
  read_aloud_default boolean not null,
  tts_lang text not null check (tts_lang in ('vi', 'en')),
  image_level text not null check (image_level in ('LOW', 'MEDIUM', 'HIGH')),
  item_type_mix jsonb not null default '{}'::jsonb,
  target_items integer not null default 500 check (target_items > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (grade, subject)
);
comment on table library.subject_profiles is 'Per grade-subject generator and planner defaults for the 8 launch libraries (CONTENT_PLAN_vi.md §3).';

insert into library.subject_profiles
  (grade, subject, title_vi, template_share, group_share, written_share, read_aloud_default, tts_lang, image_level, item_type_mix)
values
  (6, 'math',   'Toán 6',             0.40, 0.00, 0.00, false, 'vi', 'LOW',
   '{"single_choice":0.35,"numeric":0.35,"fill_blank":0.10,"multi_choice":0.05,"true_false":0.05,"ordering":0.05,"matching":0.05}'),
  (2, 'math',   'Toán 2',             0.50, 0.00, 0.00, true,  'vi', 'HIGH',
   '{"single_choice":0.30,"numeric":0.30,"picture_choice":0.20,"true_false":0.05,"ordering":0.10,"matching":0.05}'),
  (2, 'viet',   'Tiếng Việt 2',       0.10, 0.40, 0.05, true,  'vi', 'MEDIUM',
   '{"single_choice":0.30,"spelling_choice":0.15,"picture_choice":0.15,"word_bank":0.10,"fill_blank":0.10,"ordering":0.05,"matching":0.05,"true_false":0.05,"written":0.05}'),
  (6, 'lit',    'Ngữ văn 6',          0.00, 0.60, 0.10, false, 'vi', 'LOW',
   '{"single_choice":0.50,"multi_choice":0.10,"true_false":0.10,"matching":0.05,"ordering":0.05,"fill_blank":0.10,"written":0.10}'),
  (2, 'eng',    'Tiếng Anh 2',        0.10, 0.20, 0.00, true,  'en', 'HIGH',
   '{"picture_choice":0.40,"single_choice":0.25,"matching":0.15,"word_bank":0.10,"true_false":0.10}'),
  (6, 'eng',    'Tiếng Anh 6',        0.10, 0.35, 0.05, false, 'en', 'MEDIUM',
   '{"single_choice":0.40,"fill_blank":0.15,"word_bank":0.10,"matching":0.10,"ordering":0.10,"true_false":0.10,"written":0.05}'),
  (6, 'sci',    'Khoa học tự nhiên 6', 0.25, 0.15, 0.00, false, 'vi', 'MEDIUM',
   '{"single_choice":0.45,"numeric":0.20,"multi_choice":0.10,"true_false":0.10,"matching":0.10,"ordering":0.05}'),
  (2, 'natsoc', 'Tự nhiên và Xã hội 2', 0.00, 0.15, 0.00, true,  'vi', 'HIGH',
   '{"picture_choice":0.35,"single_choice":0.30,"true_false":0.15,"matching":0.10,"ordering":0.10}');

-- ---------------------------------------------------------------------------
-- Media, groups, items, templates
-- ---------------------------------------------------------------------------
create table library.media_assets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null check (kind in ('ICON', 'SVG', 'IMAGE')),
  storage_path text,
  inline_svg text,
  alt_vi text not null,
  license text not null,
  attribution text,
  review_status text not null default 'NEEDS_REVIEW' check (review_status in ('NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED')),
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((storage_path is null) <> (inline_svg is null)),
  check (kind <> 'SVG' or inline_svg is not null)
);
comment on column library.media_assets.inline_svg is 'Sanitised on import: no scripts, event handlers, external references or foreignObject.';

create table library.item_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  grade smallint not null check (grade between 1 and 12),
  subject text not null check (subject ~ '^[a-z]+$'),
  stimulus_kind text not null check (stimulus_kind in ('PASSAGE', 'POEM', 'DIALOGUE', 'PICTURE_SCENE', 'EXPERIMENT')),
  title text not null,
  body_md text not null,
  tts_text text,
  tts_lang text check (tts_lang in ('vi', 'en')),
  media_ids uuid[] not null default '{}',
  word_count integer check (word_count >= 0),
  genre text,
  source_kind text not null check (source_kind in ('ORIGINAL_AI', 'PUBLIC_DOMAIN', 'LICENSED')),
  source_note text,
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'AI_GENERATED', 'VALIDATING', 'NEEDS_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'ARCHIVED'
  )),
  version integer not null default 1 check (version > 0),
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_kind = 'ORIGINAL_AI' or coalesce(btrim(source_note), '') <> '')
);
create index item_groups_scope_idx on library.item_groups (grade, subject, status);

create table library.items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  grade smallint not null check (grade between 1 and 12),
  subject text not null check (subject ~ '^[a-z]+$'),
  kind text not null check (kind in ('STATIC', 'TEMPLATE')),
  skill_ids uuid[] not null check (cardinality(skill_ids) > 0),
  difficulty smallint not null check (difficulty between 1 and 5),
  cognitive_level text not null check (cognitive_level in ('L1', 'L2', 'L3', 'L4', 'L5')),
  type text not null check (type in (
    'single_choice', 'multi_choice', 'numeric', 'fill_blank', 'word_bank', 'picture_choice',
    'ordering', 'matching', 'true_false', 'spelling_choice', 'written'
  )),
  stem_md text not null,
  -- Pictures shown with the stem (counting, diagrams); options carry their own media.
  media_ids uuid[] not null default '{}',
  options jsonb not null default '[]'::jsonb,
  answer jsonb,
  explanation_md text not null default '',
  hints jsonb not null default '[]'::jsonb check (jsonb_typeof(hints) = 'array'),
  worked_solution_md text not null default '',
  distractor_feedback jsonb not null default '{}'::jsonb,
  misconception_tags text[] not null default '{}',
  rubric jsonb,
  tts_text text,
  tts_lang text check (tts_lang in ('vi', 'en')),
  group_id uuid references library.item_groups (id),
  group_order integer,
  source_refs jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'AI_GENERATED', 'VALIDATING', 'NEEDS_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'ARCHIVED'
  )),
  version integer not null default 1 check (version > 0),
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((type = 'written') = (rubric is not null)),
  check (type = 'written' or kind = 'TEMPLATE' or answer is not null),
  check ((group_id is null) = (group_order is null))
);
comment on table library.items is 'Global question library (CONTRACT D6). Child endpoints (M06) may only read APPROVED or PUBLISHED items.';
create index items_skill_ids_idx on library.items using gin (skill_ids);
create index items_scope_idx on library.items (grade, subject, status, kind, type, cognitive_level);
create index items_group_idx on library.items (group_id, group_order) where group_id is not null;

create table library.item_templates (
  item_id uuid primary key references library.items (id),
  params jsonb not null check (jsonb_typeof(params) = 'array'),
  constraints jsonb not null default '[]'::jsonb check (jsonb_typeof(constraints) = 'array'),
  answer_expr text not null,
  render jsonb not null,
  distractor_exprs jsonb not null default '[]'::jsonb check (jsonb_typeof(distractor_exprs) = 'array'),
  -- Set when renderVariant could not satisfy the constraints within 50 tries.
  flagged_at timestamptz,
  flag_reason text,
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table library.item_templates is 'TEMPLATE items (1:1): params spec, math.js constraints, answer and distractor expressions, render placeholders. Variants come from renderVariant(template, seed).';

-- Only TEMPLATE items may have a template row.
create or replace function library.item_template_kind_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from library.items where id = new.item_id and kind = 'TEMPLATE') then
    raise exception 'item % is not a TEMPLATE item', new.item_id using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger item_templates_kind_guard
  before insert or update on library.item_templates
  for each row execute function library.item_template_kind_guard();

create table library.item_stats (
  item_id uuid primary key references library.items (id),
  attempts integer not null default 0 check (attempts >= 0),
  p_correct numeric(5, 4),
  median_ms integer,
  hint_rate numeric(5, 4),
  report_count integer not null default 0 check (report_count >= 0),
  calibrated_difficulty numeric(4, 2),
  last_computed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table library.item_stats is 'Aggregates only (no per-child rows). Recomputed nightly once attempts exist (M06).';

create table library.item_reports (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references library.items (id),
  reason text not null check (reason in ('WRONG_ANSWER', 'UNCLEAR', 'TYPO', 'BAD_MEDIA', 'BAD_AUDIO', 'TOO_HARD', 'OTHER')),
  variant_seed bigint,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED', 'DISMISSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table library.item_reports is 'Error reports on items. Never stores who reported or any free text tied to a child.';
create index item_reports_item_idx on library.item_reports (item_id, status);

create table library.tutor_answers (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid references library.curriculum_nodes (id),
  question_text text not null,
  answer_md text not null,
  status text not null default 'NEEDS_REVIEW' check (status in ('NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table library.tutor_answers is 'Anonymised, admin-approved tutor answers reused by T1. Filled by M15.';

-- ---------------------------------------------------------------------------
-- Import runs (admin audit of package imports)
-- ---------------------------------------------------------------------------
create table library.import_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('DRY_RUN', 'APPLY')),
  curriculum_version text not null,
  grade smallint not null check (grade between 1 and 12),
  subject text not null,
  package_sha256 text not null,
  manifest jsonb not null,
  valid boolean not null,
  errors jsonb not null default '[]'::jsonb,
  diff jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index import_runs_scope_idx on library.import_runs (curriculum_version, grade, subject, created_at desc);

-- ---------------------------------------------------------------------------
-- Skill activity: a SKILL node is active only with >= 2 approved (or published) items.
-- ---------------------------------------------------------------------------
create view library.skill_item_counts
with (security_invoker = true)
as
select
  n.id as skill_id,
  n.version_id,
  n.code,
  n.grade,
  n.subject,
  count(i.id) filter (where i.status in ('APPROVED', 'PUBLISHED')) as approved_items,
  count(i.id) filter (where i.status <> 'ARCHIVED') as total_items,
  n.status = 'ACTIVE' and count(i.id) filter (where i.status in ('APPROVED', 'PUBLISHED')) >= 2 as is_active
from library.curriculum_nodes n
left join library.items i on n.id = any (i.skill_ids)
where n.level = 'SKILL'
group by n.id;

-- ---------------------------------------------------------------------------
-- updated_at, RLS, grants
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'curriculum_versions', 'curriculum_nodes', 'knowledge_edges', 'book_series',
    'book_lesson_mappings', 'subject_profiles', 'media_assets', 'item_groups', 'items',
    'item_templates', 'item_stats', 'item_reports', 'tutor_answers', 'import_runs'
  ] loop
    execute format(
      'create trigger %I before update on library.%I for each row execute function ops.set_updated_at()',
      t || '_updated_at', t);
    execute format('alter table library.%I enable row level security', t);
  end loop;
end;
$$;

revoke all on all tables in schema library from public, anon, authenticated;
revoke all on all functions in schema library from public, anon, authenticated;

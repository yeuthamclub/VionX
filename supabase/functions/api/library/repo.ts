// Library reads and admin edits (schema `library`: no personal data, so no household scope).
import type { Sql, TxSql } from '../../_shared/db.ts';

type Db = Sql | TxSql;

export interface NodeRow {
  id: string;
  parent_id: string | null;
  level: string;
  code: string;
  title_vi: string;
  description: string | null;
  gdpt_requirement_ref: string | null;
  weight: string;
  sort_order: number;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  items: number;
  approved_items: number;
}

export async function versionId(db: Db, code: string): Promise<string | null> {
  const rows = await db<
    { id: string }[]
  >`select id from library.curriculum_versions where code = ${code}`;
  return rows[0]?.id ?? null;
}

/** The grade-subject's nodes plus the shared GRADE node, with per-skill item counts. */
export function curriculumNodes(db: Db, version: string, grade: number, subject: string) {
  return db<NodeRow[]>`
    select n.id, n.parent_id, n.level, n.code, n.title_vi, n.description, n.gdpt_requirement_ref,
           n.weight, n.sort_order, n.status,
           coalesce(c.total_items, 0)::int as items, coalesce(c.approved_items, 0)::int as approved_items
    from library.curriculum_nodes n
    left join library.skill_item_counts c on c.skill_id = n.id
    where n.version_id = ${version} and n.grade = ${grade} and (n.subject = ${subject} or n.level = 'GRADE')
    order by array_position(array['GRADE','SUBJECT','DOMAIN','TOPIC','LESSON','OBJECTIVE','CONCEPT','SKILL'], n.level),
             n.sort_order, n.code`;
}

export function curriculumEdges(db: Db, version: string, grade: number, subject: string) {
  return db<
    { id: string; from_node_id: string; to_node_id: string; type: string; reason: string | null }[]
  >`
    select e.id, e.from_node_id, e.to_node_id, e.type, e.reason
    from library.knowledge_edges e
    join library.curriculum_nodes f on f.id = e.from_node_id
    where e.version_id = ${version} and e.status = 'ACTIVE' and f.grade = ${grade} and f.subject = ${subject}
    order by e.type, e.id`;
}

export interface ProfileRow {
  grade: number;
  subject: string;
  title_vi: string;
  template_share: string;
  group_share: string;
  written_share: string;
  read_aloud_default: boolean;
  tts_lang: 'vi' | 'en';
  image_level: 'LOW' | 'MEDIUM' | 'HIGH';
  item_type_mix: Record<string, number>;
  target_items: number;
}

export const profiles = (db: Db) =>
  db<ProfileRow[]>`select * from library.subject_profiles order by grade, subject`;

export async function profile(db: Db, grade: number, subject: string): Promise<ProfileRow | null> {
  const rows = await db<ProfileRow[]>`
    select * from library.subject_profiles where grade = ${grade} and subject = ${subject}`;
  return rows[0] ?? null;
}

export function versions(db: Db) {
  return db<
    {
      id: string;
      code: string;
      title: string;
      academic_year: string | null;
      status: 'ACTIVE' | 'INACTIVE';
    }[]
  >`
    select id, code, title, academic_year, status from library.curriculum_versions order by code`;
}

export function libraries(db: Db) {
  return db<
    {
      curriculum_version: string;
      grade: number;
      subject: string;
      title_vi: string | null;
      skills: number;
      active_skills: number;
      items: number;
      approved_items: number;
      last_import_at: Date | null;
    }[]
  >`
    with scopes as (
      select distinct v.code as curriculum_version, n.version_id, n.grade, n.subject
      from library.curriculum_nodes n join library.curriculum_versions v on v.id = n.version_id
      where n.level = 'SUBJECT' and n.status <> 'ARCHIVED'
    )
    select s.curriculum_version, s.grade, s.subject, p.title_vi,
      (select count(*)::int from library.skill_item_counts c
        where c.version_id = s.version_id and c.grade = s.grade and c.subject = s.subject) as skills,
      (select count(*)::int from library.skill_item_counts c
        where c.version_id = s.version_id and c.grade = s.grade and c.subject = s.subject and c.is_active) as active_skills,
      (select count(*)::int from library.items i
        where i.grade = s.grade and i.subject = s.subject and i.status <> 'ARCHIVED') as items,
      (select count(*)::int from library.items i
        where i.grade = s.grade and i.subject = s.subject and i.status in ('APPROVED', 'PUBLISHED')) as approved_items,
      (select max(r.created_at) from library.import_runs r
        where r.mode = 'APPLY' and r.valid and r.curriculum_version = s.curriculum_version
          and r.grade = s.grade and r.subject = s.subject) as last_import_at
    from scopes s
    left join library.subject_profiles p on p.grade = s.grade and p.subject = s.subject
    order by s.grade, s.subject`;
}

/** Items for the coverage report (non-archived, any status). */
export function coverageItems(db: Db, grade: number, subject: string) {
  return db<
    {
      skill_codes: string[];
      kind: 'STATIC' | 'TEMPLATE';
      type: string;
      cognitive_level: string;
      status: string;
      in_group: boolean;
      has_tts: boolean;
    }[]
  >`
    select array(select n.code from library.curriculum_nodes n where n.id = any(i.skill_ids)) as skill_codes,
           i.kind, i.type, i.cognitive_level, i.status, i.group_id is not null as in_group,
           coalesce(btrim(i.tts_text), '') <> '' as has_tts
    from library.items i
    where i.grade = ${grade} and i.subject = ${subject} and i.status <> 'ARCHIVED'`;
}

// --- Items ----------------------------------------------------------------------------------------

export interface ItemRow {
  id: string;
  code: string;
  grade: number;
  subject: string;
  kind: 'STATIC' | 'TEMPLATE';
  type: string;
  cognitive_level: string;
  difficulty: number;
  status: string;
  stem_md: string;
  skill_ids: string[];
  skills: { id: string; code: string; title: string }[];
  group_id: string | null;
  group_order: number | null;
  version: number;
  template_flagged: boolean;
  updated_at: Date;
}

export interface ItemDetailRow extends ItemRow {
  media_ids: string[];
  options: unknown[];
  answer: unknown;
  explanation_md: string;
  hints: unknown[];
  worked_solution_md: string;
  distractor_feedback: Record<string, unknown>;
  misconception_tags: string[];
  rubric: unknown;
  tts_text: string | null;
  tts_lang: 'vi' | 'en' | null;
  source_refs: unknown;
  provenance: unknown;
  content_hash: string;
}

const ITEM_SUMMARY_COLUMNS = (db: Db) => db`
  i.id, i.code, i.grade, i.subject, i.kind, i.type, i.cognitive_level, i.difficulty, i.status, i.stem_md,
  i.skill_ids, i.group_id, i.group_order, i.version, i.updated_at,
  coalesce((select t.flagged_at is not null from library.item_templates t where t.item_id = i.id), false) as template_flagged,
  coalesce((select json_agg(json_build_object('id', n.id, 'code', n.code, 'title', n.title_vi) order by n.code)
            from library.curriculum_nodes n where n.id = any(i.skill_ids)), '[]'::json) as skills`;

export interface ItemFilter {
  grade?: number | undefined;
  subject?: string | undefined;
  skillId?: string | undefined;
  status?: string | undefined;
  kind?: string | undefined;
  type?: string | undefined;
  level?: string | undefined;
  groupId?: string | undefined;
  q?: string | undefined;
  after?: string | undefined;
  limit: number;
}

export function listItems(db: Db, f: ItemFilter) {
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return db<ItemRow[]>`
    select ${ITEM_SUMMARY_COLUMNS(db)}
    from library.items i
    where true
      ${f.grade === undefined ? db`` : db`and i.grade = ${f.grade}`}
      ${f.subject === undefined ? db`` : db`and i.subject = ${f.subject}`}
      ${f.skillId === undefined ? db`` : db`and ${f.skillId}::uuid = any(i.skill_ids)`}
      ${f.status === undefined ? db`` : db`and i.status = ${f.status}`}
      ${f.kind === undefined ? db`` : db`and i.kind = ${f.kind}`}
      ${f.type === undefined ? db`` : db`and i.type = ${f.type}`}
      ${f.level === undefined ? db`` : db`and i.cognitive_level = ${f.level}`}
      ${f.groupId === undefined ? db`` : db`and i.group_id = ${f.groupId}`}
      ${like === null ? db`` : db`and (i.code ilike ${like} or i.stem_md ilike ${like})`}
      ${f.after === undefined ? db`` : db`and i.code > ${f.after}`}
    order by i.code
    limit ${f.limit + 1}`;
}

export async function itemDetail(db: Db, id: string): Promise<ItemDetailRow | null> {
  const rows = await db<ItemDetailRow[]>`
    select ${ITEM_SUMMARY_COLUMNS(db)}, i.media_ids, i.options, i.answer, i.explanation_md, i.hints,
           i.worked_solution_md, i.distractor_feedback, i.misconception_tags, i.rubric, i.tts_text, i.tts_lang,
           i.source_refs, i.provenance, i.content_hash
    from library.items i where i.id = ${id}`;
  return rows[0] ?? null;
}

export async function skillByCode(db: Db, version: string, code: string): Promise<string | null> {
  const rows = await db<{ id: string }[]>`
    select id from library.curriculum_nodes where version_id = ${version} and code = ${code} and level = 'SKILL'`;
  return rows[0]?.id ?? null;
}

export interface TemplateRow {
  item_id: string;
  params: unknown[];
  constraints: string[];
  answer_expr: string;
  render: Record<string, unknown>;
  distractor_exprs: string[];
  flagged_at: Date | null;
  flag_reason: string | null;
}

export async function template(db: Db, itemId: string): Promise<TemplateRow | null> {
  const rows = await db<
    TemplateRow[]
  >`select * from library.item_templates where item_id = ${itemId}`;
  return rows[0] ?? null;
}

export interface MediaRow {
  id: string;
  code: string;
  kind: 'ICON' | 'SVG' | 'IMAGE';
  inline_svg: string | null;
  storage_path: string | null;
  alt_vi: string;
  license: string;
  attribution: string | null;
  review_status: 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED' | 'ARCHIVED';
}

export function mediaByIdsOrCodes(db: Db, ids: string[], codes: string[]) {
  return db<MediaRow[]>`
    select id, code, kind, inline_svg, storage_path, alt_vi, license, attribution, review_status
    from library.media_assets where id = any(${ids}::uuid[]) or code = any(${codes}::text[])
    order by code`;
}

// --- Groups ---------------------------------------------------------------------------------------

export interface GroupRow {
  id: string;
  code: string;
  grade: number;
  subject: string;
  stimulus_kind: string;
  title: string;
  body_md: string;
  tts_text: string | null;
  tts_lang: 'vi' | 'en' | null;
  media_ids: string[];
  word_count: number | null;
  genre: string | null;
  source_kind: string;
  source_note: string | null;
  status: string;
  version: number;
  item_count: number;
  updated_at: Date;
}

export function listGroups(
  db: Db,
  f: {
    grade?: number | undefined;
    subject?: string | undefined;
    status?: string | undefined;
    id?: string;
  },
) {
  return db<GroupRow[]>`
    select g.*, (select count(*)::int from library.items i where i.group_id = g.id and i.status <> 'ARCHIVED') as item_count
    from library.item_groups g
    where true
      ${f.id === undefined ? db`` : db`and g.id = ${f.id}`}
      ${f.grade === undefined ? db`` : db`and g.grade = ${f.grade}`}
      ${f.subject === undefined ? db`` : db`and g.subject = ${f.subject}`}
      ${f.status === undefined ? db`` : db`and g.status = ${f.status}`}
    order by g.code
    limit 500`;
}

// --- Import runs ----------------------------------------------------------------------------------

export async function insertImportRun(
  db: Db,
  run: {
    mode: 'DRY_RUN' | 'APPLY';
    curriculumVersion: string;
    grade: number;
    subject: string;
    sha256: string;
    manifest: unknown;
    valid: boolean;
    errors: unknown;
    diff: unknown;
    createdBy: string;
  },
): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into library.import_runs (mode, curriculum_version, grade, subject, package_sha256, manifest, valid, errors, diff, created_by)
    values (${run.mode}, ${run.curriculumVersion}, ${run.grade}, ${run.subject}, ${run.sha256},
            ${db.json(run.manifest as never)}, ${run.valid}, ${db.json(run.errors as never)},
            ${db.json(run.diff as never)}, ${run.createdBy})
    returning id`;
  return row!.id;
}

export function importRuns(db: Db, limit: number) {
  return db<
    {
      id: string;
      mode: 'DRY_RUN' | 'APPLY';
      curriculum_version: string;
      grade: number;
      subject: string;
      package_sha256: string;
      manifest: { title?: string };
      valid: boolean;
      errors: unknown[];
      diff: unknown;
      created_by: string;
      created_at: Date;
    }[]
  >`select * from library.import_runs order by created_at desc limit ${limit}`;
}

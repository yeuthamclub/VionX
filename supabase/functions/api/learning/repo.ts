// M06 learning queries. Child data (app.*) is always filtered by `scope.where()`; library rows are
// global and carry no personal data.
import {
  masteryConfigFrom,
  SERVABLE_STATUSES,
  type MasteryConfig,
  type ReviewEntry,
  type SessionMode,
  type SkillState,
} from '@vionx/domain';
import type { Sql, TxSql } from '../../_shared/db.ts';
import type { Scope } from '../../_shared/scope.ts';

type Db = Sql | TxSql;
const SERVABLE = [...SERVABLE_STATUSES];

// --- Student & config -----------------------------------------------------------------------------

export interface StudentRow {
  id: string;
  household_id: string;
  display_name: string;
  grade: number;
  timezone: string;
}

export async function learningStudent(db: Db, scope: Scope, id: string) {
  const rows = await db<StudentRow[]>`
    select s.id, s.household_id, s.display_name, s.grade, h.timezone
    from app.students s join app.households h on h.id = s.household_id
    where s.id = ${id} and ${scope.where('s.household_id')}`;
  return rows[0] ?? null;
}

export async function loadConfig(db: Db): Promise<MasteryConfig> {
  const rows = await db<{ config: unknown }[]>`
    select config from app.mastery_config order by version desc limit 1`;
  return masteryConfigFrom(rows[0]?.config);
}

/** Serialises learning writes of one child until the transaction ends. */
export async function lockStudent(tx: TxSql, lockClass: number, studentId: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(${lockClass}::int, hashtext(${studentId}::text))`;
}

// --- Sessions -------------------------------------------------------------------------------------

export interface CurrentItem {
  itemId: string;
  skillId: string;
  seed: number | null;
  slot: number;
  slotKind: 'CURRENT' | 'REVIEW';
  hintsUsed: number;
  servedAt: string;
}

export interface SessionRow {
  id: string;
  household_id: string;
  student_id: string;
  client_uuid: string;
  mode: SessionMode;
  skill_ids: string[];
  topic_node_id: string | null;
  grade: number;
  subject: string;
  status: 'ACTIVE' | 'FINISHED';
  analytics: boolean;
  target_items: number;
  max_minutes: number;
  answered_count: number;
  correct_count: number;
  hints_count: number;
  current_item: CurrentItem | null;
  last_answer: { clientUuid: string; result: Record<string, unknown> } | null;
  served: { itemId: string; skillId: string }[];
  wrong_items: { itemId: string; seed: number | null }[];
  diagnostic_answers: {
    skillId: string;
    correct: boolean;
    difficulty: number;
    hintsUsed: number;
    recency: number;
  }[];
  summary: Record<string, unknown> | null;
  started_at: Date;
  finished_at: Date | null;
}

export async function sessionById(db: Db, scope: Scope, id: string, lock = false) {
  const rows = await db<SessionRow[]>`
    select * from app.learning_sessions where id = ${id} and ${scope.where()}
    ${lock ? db`for update` : db``}`;
  return rows[0] ?? null;
}

export async function sessionByClientUuid(db: Db, scope: Scope, clientUuid: string) {
  const rows = await db<SessionRow[]>`
    select * from app.learning_sessions where client_uuid = ${clientUuid} and ${scope.where()}`;
  return rows[0] ?? null;
}

export async function insertSession(
  tx: TxSql,
  s: {
    householdId: string;
    studentId: string;
    clientUuid: string;
    mode: SessionMode;
    skillIds: string[];
    nodeId: string | null;
    grade: number;
    subject: string;
    analytics: boolean;
    targetItems: number;
    maxMinutes: number;
    startedAt: Date;
  },
): Promise<SessionRow | null> {
  const rows = await tx<SessionRow[]>`
    insert into app.learning_sessions (household_id, student_id, client_uuid, mode, skill_ids,
      topic_node_id, grade, subject, analytics, target_items, max_minutes, started_at)
    values (${s.householdId}, ${s.studentId}, ${s.clientUuid}, ${s.mode}, ${s.skillIds}::uuid[],
      ${s.nodeId}, ${s.grade}, ${s.subject}, ${s.analytics}, ${s.targetItems}, ${s.maxMinutes},
      ${s.startedAt})
    on conflict (client_uuid) do nothing
    returning *`;
  return rows[0] ?? null;
}

// --- Curriculum -----------------------------------------------------------------------------------

export interface SkillRow {
  id: string;
  parent_id: string | null;
  title_vi: string;
  grade: number;
  subject: string;
}

const practicable = (db: Db) => db`
  exists (select 1 from library.items i
          where i.skill_ids @> array[n.id] and i.status = any(${SERVABLE}::text[]) and i.type <> 'written')`;

/** Practicable SKILL nodes at or under the given nodes, in curriculum order. */
export function skillsUnder(db: Db, nodeIds: string[], grade: number) {
  return db<SkillRow[]>`
    with recursive tree as (
      select id from library.curriculum_nodes where id = any(${nodeIds}::uuid[]) and status = 'ACTIVE'
      union all
      select n.id from library.curriculum_nodes n join tree t on n.parent_id = t.id
      where n.status = 'ACTIVE'
    )
    select n.id, n.parent_id, n.title_vi, n.grade, n.subject
    from library.curriculum_nodes n
    where n.id in (select id from tree) and n.level = 'SKILL' and n.grade = ${grade}
      and n.subject is not null and ${practicable(db)}
    order by n.sort_order, n.code`;
}

export interface TreeRow {
  id: string;
  parent_id: string | null;
  level: string;
  title_vi: string;
  sort_order: number;
  subject: string;
  practicable: boolean;
}

/** Active curriculum nodes of a grade (GRADE nodes excluded), parents before children. */
export function curriculumTree(db: Db, grade: number, subject?: string) {
  return db<TreeRow[]>`
    select n.id, n.parent_id, n.level, n.title_vi, n.sort_order, n.subject,
           (n.level = 'SKILL' and ${practicable(db)}) as practicable
    from library.curriculum_nodes n
    join library.curriculum_versions v on v.id = n.version_id and v.status = 'ACTIVE'
    where n.grade = ${grade} and n.status = 'ACTIVE' and n.level <> 'GRADE'
      ${subject === undefined ? db`` : db`and n.subject = ${subject}`}
    order by n.sort_order, n.code`;
}

export function prerequisiteEdges(db: Db, skillIds: string[]) {
  return db<{ from_node_id: string; to_node_id: string }[]>`
    select from_node_id, to_node_id from library.knowledge_edges
    where type = 'PREREQUISITE_OF' and status = 'ACTIVE' and to_node_id = any(${skillIds}::uuid[])`;
}

export async function nodeTitles(db: Db, ids: string[]): Promise<Map<string, string>> {
  const rows = await db<{ id: string; title_vi: string }[]>`
    select id, title_vi from library.curriculum_nodes where id = any(${ids}::uuid[])`;
  return new Map(rows.map((r) => [r.id, r.title_vi]));
}

// --- Skill states & review schedule ---------------------------------------------------------------

export interface StateRow {
  skill_id: string;
  mastery_score: string;
  confidence_score: string;
  attempt_count: number;
  correct_count: number;
  recent_accuracy: string;
  avg_response_ms: number | null;
  current_difficulty: number;
  last_attempt_at: Date | null;
  last_mastered_at: Date | null;
  retained_at: Date | null;
  repetitions: number | null;
  interval_days: string | null;
  ease: string | null;
  due_at: Date | null;
  last_reviewed_at: Date | null;
}

/** States (with their review schedule) of a child, optionally only some skills. */
export function states(db: Db, scope: Scope, studentId: string, skillIds?: string[]) {
  return db<StateRow[]>`
    select s.skill_id, s.mastery_score, s.confidence_score, s.attempt_count, s.correct_count,
           s.recent_accuracy, s.avg_response_ms, s.current_difficulty, s.last_attempt_at,
           s.last_mastered_at, s.retained_at, r.repetitions, r.interval_days, r.ease, r.due_at,
           r.last_reviewed_at
    from app.student_skill_states s
    left join app.review_schedule r on r.student_id = s.student_id and r.skill_id = s.skill_id
    where s.student_id = ${studentId} and ${scope.where('s.household_id')}
      ${skillIds === undefined ? db`` : db`and s.skill_id = any(${skillIds}::uuid[])`}`;
}

const ms = (d: Date | null) => (d ? new Date(d).getTime() : null);
const date = (t: number | null) => (t === null ? null : new Date(t));

export const toState = (r: StateRow): SkillState => ({
  masteryScore: Number(r.mastery_score),
  confidenceScore: Number(r.confidence_score),
  attemptCount: r.attempt_count,
  correctCount: r.correct_count,
  recentAccuracy: Number(r.recent_accuracy),
  avgResponseMs: r.avg_response_ms,
  currentDifficulty: r.current_difficulty,
  lastAttemptAt: ms(r.last_attempt_at),
  lastMasteredAt: ms(r.last_mastered_at),
  retainedAt: ms(r.retained_at),
});

export const toReview = (r: StateRow): ReviewEntry | null =>
  r.due_at === null
    ? null
    : {
        repetitions: r.repetitions!,
        intervalDays: Number(r.interval_days),
        ease: Number(r.ease),
        dueAt: ms(r.due_at)!,
        lastReviewedAt: ms(r.last_reviewed_at)!,
      };

export async function upsertState(
  tx: TxSql,
  key: { householdId: string; studentId: string; skillId: string },
  s: SkillState,
  review: ReviewEntry | null,
): Promise<void> {
  await tx`
    insert into app.student_skill_states (student_id, skill_id, household_id, mastery_score,
      confidence_score, attempt_count, correct_count, recent_accuracy, avg_response_ms,
      current_difficulty, last_attempt_at, last_mastered_at, retained_at, next_review_at,
      forgetting_risk)
    values (${key.studentId}, ${key.skillId}, ${key.householdId}, ${s.masteryScore},
      ${s.confidenceScore}, ${s.attemptCount}, ${s.correctCount}, ${s.recentAccuracy},
      ${s.avgResponseMs}, ${s.currentDifficulty}, ${date(s.lastAttemptAt)},
      ${date(s.lastMasteredAt)}, ${date(s.retainedAt)}, ${date(review?.dueAt ?? null)}, 0)
    on conflict (student_id, skill_id) do update set
      mastery_score = excluded.mastery_score,
      confidence_score = excluded.confidence_score,
      attempt_count = excluded.attempt_count,
      correct_count = excluded.correct_count,
      recent_accuracy = excluded.recent_accuracy,
      avg_response_ms = excluded.avg_response_ms,
      current_difficulty = excluded.current_difficulty,
      last_attempt_at = excluded.last_attempt_at,
      last_mastered_at = excluded.last_mastered_at,
      retained_at = excluded.retained_at,
      next_review_at = excluded.next_review_at,
      forgetting_risk = excluded.forgetting_risk`;
  if (review) {
    await tx`
      insert into app.review_schedule (student_id, skill_id, household_id, repetitions,
        interval_days, ease, due_at, last_reviewed_at)
      values (${key.studentId}, ${key.skillId}, ${key.householdId}, ${review.repetitions},
        ${review.intervalDays}, ${review.ease}, ${new Date(review.dueAt)},
        ${new Date(review.lastReviewedAt)})
      on conflict (student_id, skill_id) do update set
        repetitions = excluded.repetitions,
        interval_days = excluded.interval_days,
        ease = excluded.ease,
        due_at = excluded.due_at,
        last_reviewed_at = excluded.last_reviewed_at`;
  }
}

/** Skills of one subject whose review is due, most overdue first. */
export async function dueSkills(
  db: Db,
  scope: Scope,
  studentId: string,
  grade: number,
  subject: string | undefined,
  now: Date,
): Promise<{ skill_id: string; subject: string }[]> {
  return db<{ skill_id: string; subject: string }[]>`
    select r.skill_id, n.subject
    from app.review_schedule r
    join library.curriculum_nodes n on n.id = r.skill_id
    where r.student_id = ${studentId} and ${scope.where('r.household_id')} and r.due_at <= ${now}
      and n.grade = ${grade} and n.status = 'ACTIVE' and ${practicable(db)}
      ${subject === undefined ? db`` : db`and n.subject = ${subject}`}
    order by r.due_at, r.skill_id`;
}

// --- Items ----------------------------------------------------------------------------------------

export interface CandidateRow {
  id: string;
  kind: 'STATIC' | 'TEMPLATE';
  difficulty: number;
  seen_count: number;
  last_seen_at: Date | null;
  seeds: string[];
}

/** Servable items of a skill with the child's history (empty without EDUCATION_ANALYTICS). */
export function candidates(db: Db, scope: Scope, studentId: string, skillId: string) {
  return db<CandidateRow[]>`
    select i.id, i.kind, i.difficulty, coalesce(h.seen_count, 0)::int as seen_count,
           h.last_seen_at, coalesce(h.seeds, '{}') as seeds
    from library.items i
    left join library.item_templates t on t.item_id = i.id
    left join app.student_item_history h
      on h.item_id = i.id and h.student_id = ${studentId} and ${scope.where('h.household_id')}
    where i.skill_ids @> array[${skillId}]::uuid[] and i.status = any(${SERVABLE}::text[])
      and i.type <> 'written'
      and (i.kind = 'STATIC' or (t.item_id is not null and t.flagged_at is null))
    order by i.code`;
}

export interface FullItemRow {
  id: string;
  kind: 'STATIC' | 'TEMPLATE';
  type: string;
  status: string;
  difficulty: number;
  skill_ids: string[];
  stem_md: string;
  media_ids: string[];
  options: { id: string; text?: string; media?: string; ttsText?: string; side?: string }[];
  answer: Record<string, unknown> | null;
  explanation_md: string;
  hints: { md: string; ttsText?: string }[];
  worked_solution_md: string;
  distractor_feedback: Record<string, { md: string; misconception?: string }>;
  tts_text: string | null;
  tts_lang: 'vi' | 'en' | null;
  group_id: string | null;
  group_order: number | null;
  template: {
    params: unknown[];
    constraints: string[];
    answer_expr: string;
    render: Record<string, unknown>;
    distractor_exprs: string[];
  } | null;
}

export async function fullItem(db: Db, id: string): Promise<FullItemRow | null> {
  const rows = await db<FullItemRow[]>`
    select i.id, i.kind, i.type, i.status, i.difficulty, i.skill_ids, i.stem_md, i.media_ids,
           i.options, i.answer, i.explanation_md, i.hints, i.worked_solution_md,
           i.distractor_feedback, i.tts_text, i.tts_lang, i.group_id, i.group_order,
           (select row_to_json(t) from library.item_templates t where t.item_id = i.id) as template
    from library.items i where i.id = ${id}`;
  return rows[0] ?? null;
}

/** The next servable item of the group `afterItemId` belongs to that the session has not served. */
export async function nextInGroup(db: Db, afterItemId: string, servedIds: string[]) {
  const rows = await db<{ id: string; skill_ids: string[] }[]>`
    select i.id, i.skill_ids
    from library.items i
    where i.group_id = (select group_id from library.items where id = ${afterItemId})
      and i.status = any(${SERVABLE}::text[]) and i.type <> 'written' and i.kind = 'STATIC'
      and not (i.id = any(${servedIds}::uuid[]))
    order by i.group_order limit 1`;
  return rows[0] ?? null;
}

export interface GroupRow {
  id: string;
  stimulus_kind: string;
  title: string;
  body_md: string;
  tts_text: string | null;
  tts_lang: 'vi' | 'en' | null;
  media_ids: string[];
  position: number;
  total: number;
}

/** A group with the place of `itemId` among its servable items. */
export async function groupFor(db: Db, groupId: string, itemId: string) {
  const rows = await db<GroupRow[]>`
    with members as (
      select id, row_number() over (order by group_order)::int as position,
             (count(*) over ())::int as total
      from library.items
      where group_id = ${groupId} and status = any(${SERVABLE}::text[]) and type <> 'written'
    )
    select g.id, g.stimulus_kind, g.title, g.body_md, g.tts_text, g.tts_lang, g.media_ids,
           m.position, m.total
    from library.item_groups g join members m on m.id = ${itemId}
    where g.id = ${groupId}`;
  return rows[0] ?? null;
}

// --- Per-answer rows (EDUCATION_ANALYTICS only) ---------------------------------------------------

export async function recordAttempt(
  tx: TxSql,
  a: {
    householdId: string;
    studentId: string;
    sessionId: string;
    itemId: string;
    skillId: string;
    seed: number | null;
    response: unknown;
    isCorrect: boolean;
    hintsUsed: number;
    responseMs: number | null;
    difficulty: number;
    masteryDelta: number;
    clientUuid: string;
    at: Date;
    misconception: string | null;
  },
): Promise<void> {
  await tx`
    insert into app.answer_attempts (household_id, student_id, session_id, item_id, skill_id,
      variant_seed, response, is_correct, hints_used, response_ms, difficulty, mastery_delta,
      client_uuid, answered_at)
    values (${a.householdId}, ${a.studentId}, ${a.sessionId}, ${a.itemId}, ${a.skillId}, ${a.seed},
      ${tx.json(a.response as never)}, ${a.isCorrect}, ${a.hintsUsed}, ${a.responseMs},
      ${a.difficulty}, ${a.masteryDelta}, ${a.clientUuid}, ${a.at})`;
  await tx`
    insert into app.student_item_history (student_id, item_id, household_id, seeds, last_correct,
      last_seen_at)
    values (${a.studentId}, ${a.itemId}, ${a.householdId},
      ${a.seed === null ? tx`'{}'::bigint[]` : tx`array[${a.seed}]::bigint[]`}, ${a.isCorrect}, ${a.at})
    on conflict (student_id, item_id) do update set
      seen_count = app.student_item_history.seen_count + 1,
      seeds = (app.student_item_history.seeds || excluded.seeds)[
        greatest(1, cardinality(app.student_item_history.seeds || excluded.seeds) - 19):],
      last_correct = excluded.last_correct,
      last_seen_at = excluded.last_seen_at`;
  if (a.misconception) {
    await tx`
      insert into app.mistake_patterns (student_id, skill_id, misconception, household_id,
        last_item_id, last_seen_at)
      values (${a.studentId}, ${a.skillId}, ${a.misconception.slice(0, 80)}, ${a.householdId},
        ${a.itemId}, ${a.at})
      on conflict (student_id, skill_id, misconception) do update set
        occurrences = app.mistake_patterns.occurrences + 1,
        last_item_id = excluded.last_item_id,
        last_seen_at = excluded.last_seen_at`;
  }
}

export async function insertItemReport(
  db: Db,
  itemId: string,
  reason: string,
  seed: number | null,
): Promise<boolean> {
  const rows = await db`
    insert into library.item_reports (item_id, reason, variant_seed)
    select id, ${reason}, ${seed} from library.items
    where id = ${itemId} and status = any(${SERVABLE}::text[])
    returning id`;
  return rows.length > 0;
}

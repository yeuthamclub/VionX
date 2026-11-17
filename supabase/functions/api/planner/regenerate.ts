// M07: the one place that writes a Today plan. Used by the api (read when stale, recalculate, item
// actions) and by the worker (day start, task and session events). It reads the facts of one child,
// runs the pure rules of @vionx/domain (planner/) and stores the result in place.
import {
  addDays,
  daysBetween,
  displayState,
  forgettingRisk,
  householdToday,
  isoWeekday,
  LIBRARY_SUBJECT_OF,
  masteryConfigFrom,
  newSkillState,
  freeMinutesOf,
  PLANNER_LOCK_CLASS,
  plannerConfigFrom,
  planToday,
  sessionShape,
  sessionXp,
  timeToMinutes,
  toHHMM,
  zonedDayStart,
  type PlanItem,
  type PlannerConfig,
  type PlannerSkill,
} from '@vionx/domain';
import type { Sql, TxSql } from '../../_shared/db.ts';
import { scoped } from '../../_shared/scope.ts';
import * as calendar from '../calendar/repo.ts';
import * as learning from '../learning/repo.ts';

type Db = Sql | TxSql;

export interface PlanRow {
  id: string;
  household_id: string;
  student_id: string;
  local_date: string;
  version: number;
  budget_minutes: number;
  free_minutes: number;
  session_minutes: number;
  generated_at: Date;
  daily_minutes: number | null;
}

export interface ItemRow {
  id: string;
  household_id: string;
  student_id: string;
  plan_id: string;
  kind: PlanItem['kind'];
  ref_key: string;
  ref_id: string | null;
  title: string;
  subject: string | null;
  minutes: number;
  priority: string;
  reasons: PlanItem['reasons'];
  status: PlanItem['status'];
  pinned: boolean;
  required: boolean;
  in_budget: boolean;
  reward_xp: number;
  position: number;
  link: PlanItem['link'];
  detail: PlanItem['detail'];
}

export interface StoredPlan {
  plan: PlanRow;
  items: ItemRow[];
}

export async function loadPlannerConfig(db: Db): Promise<PlannerConfig> {
  const rows = await db<{ config: unknown }[]>`
    select config from app.planner_config order by version desc limit 1`;
  return plannerConfigFrom(rows[0]?.config);
}

export async function storedPlan(
  db: Db,
  householdId: string,
  studentId: string,
  day: string,
): Promise<StoredPlan | null> {
  const [plan] = await db<PlanRow[]>`
    select p.id, p.household_id, p.student_id, p.local_date::text as local_date, p.version,
           p.budget_minutes, p.free_minutes, p.session_minutes, p.generated_at,
           (select daily_minutes from app.planner_settings s where s.student_id = p.student_id)
             as daily_minutes
    from app.today_plans p
    where p.student_id = ${studentId} and p.household_id = ${householdId}
      and p.local_date = ${day}::date`;
  if (!plan) return null;
  const items = await db<ItemRow[]>`
    select * from app.today_plan_items
    where plan_id = ${plan.id} and household_id = ${householdId} order by position`;
  return { plan, items };
}

/**
 * Has anything the plan is made of changed since it was written? Deleted rows leave no trace
 * here, so a plan is also regenerated once it is older than `maxAgeMinutes`.
 */
export async function planIsStale(
  db: Db,
  plan: PlanRow,
  config: PlannerConfig,
  at: Date,
): Promise<boolean> {
  if (at.getTime() - new Date(plan.generated_at).getTime() > config.maxAgeMinutes * 60_000) {
    return true;
  }
  const s = plan.student_id;
  const h = plan.household_id;
  const [row] = await db<{ stale: boolean }[]>`
    select coalesce(greatest(
      (select max(updated_at) from app.task_occurrences
        where student_id = ${s} and household_id = ${h} and occurs_on = ${plan.local_date}::date),
      (select max(updated_at) from app.task_assignments
        where assigned_student_id = ${s} and household_id = ${h}),
      (select max(updated_at) from app.learning_sessions
        where student_id = ${s} and household_id = ${h} and status = 'FINISHED'),
      (select max(updated_at) from app.student_skill_states
        where student_id = ${s} and household_id = ${h}),
      (select max(updated_at) from app.calendar_events where student_id = ${s} and household_id = ${h}),
      (select max(updated_at) from app.school_timetable_entries
        where student_id = ${s} and household_id = ${h}),
      (select max(updated_at) from app.planner_settings where student_id = ${s} and household_id = ${h})
    ) > ${plan.generated_at}, false) as stale`;
  return row!.stale;
}

/** JSON with sorted keys: jsonb does not keep key order, so stored and new items compare equal. */
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );

const toPlanItem = (r: ItemRow): PlanItem => ({
  kind: r.kind,
  refKey: r.ref_key,
  refId: r.ref_id,
  title: r.title,
  subject: r.subject,
  minutes: r.minutes,
  priority: Number(r.priority),
  reasons: r.reasons,
  status: r.status,
  pinned: r.pinned,
  required: r.required,
  inBudget: r.in_budget,
  rewardXp: r.reward_xp,
  link: r.link,
  detail: r.detail,
});

/**
 * Regenerates today's plan of one child inside the caller's transaction (serialised per child).
 * Returns null when the child does not exist in that household.
 */
export async function regenerateToday(
  tx: TxSql,
  householdId: string,
  studentId: string,
  at: Date,
): Promise<StoredPlan | null> {
  const scope = scoped(tx as unknown as Sql, [householdId]);
  const student = await learning.learningStudent(tx, scope, studentId);
  if (!student) return null;
  await learning.lockStudent(tx, PLANNER_LOCK_CLASS, studentId);

  const tz = student.timezone;
  const today = householdToday(at, tz);
  const dayStart = zonedDayStart(today, tz);
  const dayEnd = zonedDayStart(addDays(today, 1), tz);
  const config = await loadPlannerConfig(tx);
  const [mastery, settings, occurrences, timetable, events, tree, states, sessions, before] =
    await Promise.all([
      learning.loadConfig(tx),
      tx<{ daily_minutes: number | null }[]>`
        select daily_minutes from app.planner_settings
        where student_id = ${studentId} and household_id = ${householdId}`,
      calendar.occurrencesBetween(tx, scope, studentId, today, today),
      calendar.timetable(tx, scope, studentId),
      calendar.eventsBetween(
        tx,
        scope,
        studentId,
        dayStart,
        zonedDayStart(addDays(today, config.examHorizonDays + 1), tz),
      ),
      learning.curriculumTree(tx, student.grade),
      learning.states(tx, scope, studentId),
      tx<
        {
          skill_ids: string[];
          mode: string;
          subject: string;
          max_minutes: number;
          started_at: Date;
          finished_at: Date;
        }[]
      >`
        select skill_ids, mode, subject, max_minutes, started_at, finished_at
        from app.learning_sessions
        where student_id = ${studentId} and household_id = ${householdId}
          and status = 'FINISHED' and answered_count > 0
          and finished_at >= ${dayStart} and finished_at < ${dayEnd}`,
      storedPlan(tx, householdId, studentId, today),
    ]);

  // Skills of the child's grade with their state, review date and prerequisites.
  const skillRows = tree.filter((r) => r.practicable);
  const edges = await learning.prerequisiteEdges(
    tx,
    skillRows.map((r) => r.id),
  );
  const stateOf = new Map(states.map((r) => [r.skill_id, r]));
  const now = at.getTime();
  const skills = skillRows.map((row, order): PlannerSkill => {
    const own = stateOf.get(row.id);
    const state = own ? learning.toState(own) : newSkillState(mastery);
    return {
      skillId: row.id,
      topicId: row.parent_id ?? row.id,
      order,
      state: displayState(mastery, state),
      masteryScore: state.masteryScore,
      dueAt: own?.due_at ? new Date(own.due_at).getTime() : null,
      prerequisites: edges.filter((e) => e.to_node_id === row.id).map((e) => e.from_node_id),
      subject: row.subject,
      title: row.title_vi,
      forgettingRisk: own
        ? forgettingRisk(state.lastAttemptAt, learning.toReview(own)?.intervalDays ?? null, now)
        : 0,
    };
  });

  // School periods and timed events of today take time out of the day window.
  const minuteOfDay = (d: Date) =>
    Math.round((new Date(d).getTime() - dayStart.getTime()) / 60_000);
  const busy = [
    ...timetable
      .filter(
        (e) =>
          e.weekday === isoWeekday(today) &&
          (e.valid_from === null || e.valid_from <= today) &&
          (e.valid_to === null || e.valid_to >= today),
      )
      .map((e) => ({
        start: timeToMinutes(toHHMM(e.start_time)),
        end: timeToMinutes(toHHMM(e.end_time)),
      })),
    ...events
      .filter((e) => !e.all_day && new Date(e.starts_at) < dayEnd)
      .map((e) => ({ start: minuteOfDay(e.starts_at), end: minuteOfDay(e.ends_at) })),
  ];
  const freeMinutes = freeMinutesOf(config.dayWindow, busy);

  const existing = (before?.items ?? []).map(toPlanItem);
  const plan = planToday(
    {
      grade: student.grade,
      now,
      tasks: occurrences.map((o) => ({
        occurrenceId: o.id,
        taskId: o.assignment_id,
        type: o.type,
        title: o.title,
        subject: (o.subject_code && LIBRARY_SUBJECT_OF[o.subject_code]) || null,
        durationMinutes: o.duration_minutes,
        priority: o.priority,
        required: o.required,
        rewardXp: o.reward_xp,
        verificationMode: o.verification_mode,
        status: o.status,
      })),
      exams: events
        .filter((e) => e.type === 'EXAM')
        .map((e) => ({
          eventId: e.id,
          title: e.title,
          daysUntil: daysBetween(today, householdToday(new Date(e.starts_at), tz)),
          subject: (e.subject_code && LIBRARY_SUBJECT_OF[e.subject_code]) || null,
          skillIds: e.skill_ids,
        })),
      skills,
      finished: {
        skillIds: [...new Set(sessions.flatMap((s) => s.skill_ids))],
        reviewSubjects: [
          ...new Set(sessions.filter((s) => s.mode === 'REVIEW').map((s) => s.subject)),
        ],
        minutes: sessions.reduce(
          (sum, s) =>
            sum +
            Math.min(
              s.max_minutes,
              Math.ceil(
                (new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) / 60_000,
              ),
            ),
          0,
        ),
      },
      freeMinutes,
      parentDailyMinutes: settings[0]?.daily_minutes ?? null,
      sessionXp: sessionXp(mastery, sessionShape(mastery, student.grade).targetItems),
      existing,
    },
    config,
  );

  const changed =
    !before ||
    before.plan.budget_minutes !== plan.budgetMinutes ||
    before.plan.free_minutes !== freeMinutes ||
    canonical(existing) !== canonical(plan.items);
  const [row] = await tx<{ id: string }[]>`
    insert into app.today_plans (household_id, student_id, local_date, budget_minutes,
      free_minutes, session_minutes, generated_at)
    values (${householdId}, ${studentId}, ${today}::date, ${plan.budgetMinutes}, ${freeMinutes},
      ${plan.sessionMinutes}, ${at})
    on conflict (student_id, local_date) do update set
      budget_minutes = excluded.budget_minutes,
      free_minutes = excluded.free_minutes,
      session_minutes = excluded.session_minutes,
      generated_at = excluded.generated_at,
      version = app.today_plans.version + ${changed ? 1 : 0}
    returning id`;
  if (changed) {
    const planId = row!.id;
    await tx`
      delete from app.today_plan_items
      where plan_id = ${planId} and not (ref_key = any(${plan.items.map((i) => i.refKey)}::text[]))`;
    if (plan.items.length > 0) {
      const rows = plan.items.map((i, position) => ({
        household_id: householdId,
        student_id: studentId,
        plan_id: planId,
        kind: i.kind,
        ref_key: i.refKey,
        ref_id: i.refId,
        title: i.title,
        subject: i.subject,
        minutes: i.minutes,
        priority: i.priority,
        reasons: tx.json(i.reasons as never),
        status: i.status,
        pinned: i.pinned,
        required: i.required,
        in_budget: i.inBudget,
        reward_xp: i.rewardXp,
        position,
        link: tx.json(i.link as never),
        detail: tx.json(i.detail as never),
      }));
      await tx`
        insert into app.today_plan_items ${tx(rows as never)}
        on conflict (plan_id, ref_key) do update set
          kind = excluded.kind, ref_id = excluded.ref_id, title = excluded.title,
          subject = excluded.subject, minutes = excluded.minutes, priority = excluded.priority,
          reasons = excluded.reasons, status = excluded.status, pinned = excluded.pinned,
          required = excluded.required, in_budget = excluded.in_budget,
          reward_xp = excluded.reward_xp, position = excluded.position, link = excluded.link,
          detail = excluded.detail`;
    }
  }
  return storedPlan(tx, householdId, studentId, today);
}

/**
 * Day start (`planner.day_start_requested`): every child whose household-local day has no plan
 * yet. Returns the number of plans written.
 */
export async function generateMissingPlans(tx: TxSql, at: Date): Promise<number> {
  // shortcut: one transaction for all children, 500 a run; move to one job per child when a
  // run no longer fits in the worker's time limit.
  const students = await tx<{ id: string; household_id: string }[]>`
    select s.id, s.household_id
    from app.students s join app.households h on h.id = s.household_id
    where h.deletion_requested_at is null
      and not exists (
        select 1 from app.today_plans p
        where p.student_id = s.id and p.local_date = (${at} at time zone h.timezone)::date)
    order by s.id limit 500`;
  for (const s of students) await regenerateToday(tx, s.household_id, s.id, at);
  return students.length;
}

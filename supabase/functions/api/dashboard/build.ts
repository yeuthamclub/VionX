// M08: daily summaries and the dashboard of one child. Reads go through household-scoped
// queries; school grades and app mastery are returned side by side, never combined.
import type { z } from '@hono/zod-openapi';
import type { DashboardResponseSchema } from '@vionx/contracts';
import {
  activeStreak,
  addDays,
  capView,
  completionRate,
  dashboardConfigFrom,
  daysUntil,
  displayState,
  eachDay,
  forgettingRisk,
  gradePercent,
  gradeTrend,
  householdToday,
  levelFor,
  LIBRARY_SUBJECT_OF,
  newSkillState,
  rangeDays,
  schoolTermOf,
  skillInsights,
  subjectMastery,
  sufficiency,
  zonedDayStart,
  type AssessmentType,
  type DashboardConfig,
  type DashboardRange,
  type DashboardSkill,
} from '@vionx/domain';
import type { Sql, TxSql } from '../../_shared/db.ts';
import {
  balances,
  loadDayFacts,
  loadRules,
  loadSystemCaps,
  rewardableXpOn,
} from '../../_shared/rewards.ts';
import { scoped } from '../../_shared/scope.ts';
import * as calendar from '../calendar/repo.ts';
import * as learning from '../learning/repo.ts';
import { profile } from '../library/repo.ts';
import { freshPlan } from '../planner/regenerate.ts';
import { iso } from '../route-helpers.ts';

type Db = Sql | TxSql;
export type Dashboard = z.infer<typeof DashboardResponseSchema>;

export interface DashboardStudent {
  id: string;
  household_id: string;
  display_name: string;
  grade: number;
  timezone: string;
}

export async function loadDashboardConfig(db: Db): Promise<DashboardConfig> {
  const rows = await db<{ config: unknown }[]>`
    select config from app.dashboard_config order by version desc limit 1`;
  return dashboardConfigFrom(rows[0]?.config);
}

/**
 * Rebuilds the daily totals of one child for the given household-local days from the source
 * rows (task days, finished sessions, XP ledger). One statement; safe to repeat.
 */
export async function refreshDaySummaries(
  db: Db,
  student: Pick<DashboardStudent, 'id' | 'household_id' | 'timezone'>,
  days: readonly string[],
): Promise<void> {
  if (days.length === 0) return;
  const s = student.id;
  const h = student.household_id;
  const list = [...days];
  await db`
    with d as (select unnest(${list}::date[]) as day),
    t as (
      select o.occurs_on as day,
             count(*)::int as total,
             count(*) filter (where o.status = 'COMPLETED')::int as done,
             count(*) filter (where a.required)::int as required_total,
             count(*) filter (where a.required and o.status = 'COMPLETED')::int as required_done
      from app.task_occurrences o
      join app.task_assignments a on a.id = o.assignment_id and a.household_id = o.household_id
      where o.student_id = ${s} and o.household_id = ${h} and o.occurs_on = any(${list}::date[])
        and (a.status = 'ACTIVE' or o.status <> 'ASSIGNED')
      group by o.occurs_on
    ),
    l as (
      select (finished_at at time zone ${student.timezone})::date as day,
             count(*)::int as sessions,
             sum(least(max_minutes, ceil(extract(epoch from finished_at - started_at) / 60)))::int
               as minutes,
             sum(answered_count)::int as answers,
             sum(correct_count)::int as correct
      from app.learning_sessions
      where student_id = ${s} and household_id = ${h} and status = 'FINISHED'
        and answered_count > 0
        and (finished_at at time zone ${student.timezone})::date = any(${list}::date[])
      group by 1
    ),
    x as (
      select reward_day as day, sum(lifetime_xp_delta)::int as xp
      from app.xp_ledger
      where student_id = ${s} and household_id = ${h} and reward_day = any(${list}::date[])
      group by reward_day
    )
    insert into app.student_day_summaries (student_id, local_day, household_id, tasks_total,
      tasks_done, required_total, required_done, sessions, learning_minutes, answers, correct,
      xp_earned, refreshed_at)
    select ${s}, d.day, ${h}, coalesce(t.total, 0), coalesce(t.done, 0),
           coalesce(t.required_total, 0), coalesce(t.required_done, 0), coalesce(l.sessions, 0),
           coalesce(l.minutes, 0), coalesce(l.answers, 0), coalesce(l.correct, 0),
           coalesce(x.xp, 0), now()
    from d left join t using (day) left join l using (day) left join x using (day)
    on conflict (student_id, local_day) do update set
      tasks_total = excluded.tasks_total, tasks_done = excluded.tasks_done,
      required_total = excluded.required_total, required_done = excluded.required_done,
      sessions = excluded.sessions, learning_minutes = excluded.learning_minutes,
      answers = excluded.answers, correct = excluded.correct, xp_earned = excluded.xp_earned,
      refreshed_at = excluded.refreshed_at`;
}

interface SummaryRow {
  local_day: string;
  tasks_total: number;
  tasks_done: number;
  required_total: number;
  required_done: number;
  sessions: number;
  learning_minutes: number;
  answers: number;
  correct: number;
  xp_earned: number;
}

/**
 * Summaries of `from`..`to`. Days without a row yet, and today (still changing), are rebuilt
 * first, so the result does not depend on the worker having seen every event.
 */
async function daySummaries(
  sql: Sql,
  student: DashboardStudent,
  from: string,
  to: string,
  today: string,
): Promise<SummaryRow[]> {
  const read = () => sql<SummaryRow[]>`
    select local_day::text as local_day, tasks_total, tasks_done, required_total, required_done,
           sessions, learning_minutes, answers, correct, xp_earned
    from app.student_day_summaries
    where student_id = ${student.id} and household_id = ${student.household_id}
      and local_day between ${from}::date and ${to}::date
    order by local_day`;
  const have = new Set((await read()).map((r) => r.local_day));
  const missing = eachDay(from, to).filter((d) => d === today || !have.has(d));
  await refreshDaySummaries(sql, student, missing);
  return read();
}

interface AssessmentPoint {
  subject_code: string;
  assessed_on: string;
  type: AssessmentType;
  score: string;
  max_score: string;
}

const sum = <T>(rows: readonly T[], pick: (row: T) => number) =>
  rows.reduce((n, r) => n + pick(r), 0);

/** Everything the dashboard of one child shows for a range ending today. */
export async function buildDashboard(
  sql: Sql,
  student: DashboardStudent,
  range: DashboardRange,
  at: Date,
): Promise<Dashboard> {
  const scope = scoped(sql, [student.household_id]);
  const s = student.id;
  const h = student.household_id;
  const tz = student.timezone;
  const today = householdToday(at, tz);
  const config = await loadDashboardConfig(sql);
  const { from, to } = rangeDays(config, range, today);
  // The streak looks back 30 days whatever the range.
  const streakFrom = addDays(today, -29);
  const firstDay = from < streakFrom ? from : streakFrom;
  const term = schoolTermOf(today);
  const caps = await loadSystemCaps(sql);

  const [
    plan,
    summaries,
    totals,
    todayXp,
    facts,
    rules,
    coins,
    mastery,
    tree,
    states,
    assessments,
    events,
  ] = await Promise.all([
    freshPlan(sql, student, at),
    daySummaries(sql, student, firstDay, to, today),
    balances(sql, h, s),
    rewardableXpOn(sql, h, s, today),
    loadDayFacts(sql, h, s, today),
    loadRules(sql, h, caps),
    sql<{ week: number; in_range: number }[]>`
      select
        coalesce(sum(amount) filter (where reward_day > ${addDays(today, -7)}::date), 0)::int as week,
        coalesce(sum(amount) filter (where reward_day >= ${from}::date), 0)::int as in_range
      from app.coin_ledger
      where student_id = ${s} and household_id = ${h} and kind = 'DAY_CONVERSION'
        and reward_day >= ${firstDay}::date`,
    learning.loadConfig(sql),
    learning.curriculumTree(sql, student.grade),
    learning.states(sql, scope, s),
    // Ordered by created_at within a day: two tests entered on one day keep their order, so the
    // trend ("up/down N points") does not flip with the random ids.
    sql<AssessmentPoint[]>`
      select subject_code, assessed_on::text as assessed_on, type, score, max_score
      from app.school_assessments
      where student_id = ${s} and household_id = ${h} and school_year = ${term.schoolYear}
      order by assessed_on, created_at, id`,
    calendar.eventsBetween(
      sql,
      scope,
      s,
      zonedDayStart(today, tz),
      zonedDayStart(addDays(today, config.examHorizonDays + 1), tz),
    ),
  ]);

  // Today (the planner's own numbers).
  const visible = plan.items.filter((i) => i.status !== 'REMOVED');
  const doneItems = visible.filter((i) => i.status === 'DONE' || i.status === 'PENDING_APPROVAL');
  const open = visible.filter((i) => i.status === 'PLANNED' || i.status === 'STARTED');

  // Activity.
  const inRange = summaries.filter((r) => r.local_day >= from);
  const active = summaries.filter((r) => r.tasks_done > 0 || r.sessions > 0);
  const activeInRange = active.filter((r) => r.local_day >= from).length;
  const byDay = new Map(inRange.map((r) => [r.local_day, r]));
  const cap = capView({
    day: today,
    facts,
    rules: rules.rules,
    caps,
    rewardableXp: todayXp.rewardable,
  });

  // Skills of the child's grade.
  const now = at.getTime();
  const stateOf = new Map(states.map((r) => [r.skill_id, r]));
  const skills = tree
    .filter((r) => r.practicable)
    .map((row): DashboardSkill => {
      const own = stateOf.get(row.id);
      const state = own ? learning.toState(own) : newSkillState(mastery);
      return {
        skillId: row.id,
        subject: row.subject,
        title: row.title_vi,
        state: displayState(mastery, state),
        masteryScore: state.masteryScore,
        attemptCount: state.attemptCount,
        correctCount: state.correctCount,
        recentAccuracy: state.recentAccuracy,
        forgettingRisk: own
          ? forgettingRisk(state.lastAttemptAt, learning.toReview(own)?.intervalDays ?? null, now)
          : 0,
        lastAttemptDay:
          state.lastAttemptAt === null ? null : householdToday(new Date(state.lastAttemptAt), tz),
      };
    });
  const insights = skillInsights(skills, { from, to }, config);
  const subjects = subjectMastery(skills, config);
  const titles = new Map<string, string>();
  for (const m of subjects) {
    titles.set(m.subject, (await profile(sql, student.grade, m.subject))?.title_vi ?? m.subject);
  }
  const answers = sum(inRange, (r) => r.answers);

  // School grades of the current school year, by subject.
  const codes = [...new Set(assessments.map((a) => a.subject_code))].sort();
  const school = codes.map((subjectCode) => {
    const points = assessments
      .filter((a) => a.subject_code === subjectCode)
      .map((a) => ({
        day: a.assessed_on,
        percent: gradePercent(Number(a.score), Number(a.max_score)),
        type: a.type,
      }));
    return { subjectCode, ...gradeTrend(points, config), points };
  });
  const masteryOf = new Map(subjects.map((m) => [m.subject, m]));

  return {
    studentId: s,
    displayName: student.display_name,
    grade: student.grade,
    range,
    from,
    to,
    today: {
      itemsTotal: visible.length,
      itemsDone: doneItems.length,
      plannedMinutes: sum(
        open.filter((i) => i.in_budget),
        (i) => i.minutes,
      ),
      doneMinutes: sum(doneItems, (i) => i.minutes),
      budgetMinutes: plan.plan.budget_minutes,
      completion: completionRate(doneItems.length, visible.length),
    },
    streak: {
      days: activeStreak(
        active.map((r) => r.local_day),
        today,
      ),
      activeDays: active.length,
      sufficiency: sufficiency(active.length, config.sufficiency.activeDays),
    },
    rewards: {
      coinBalance: totals.coinBalance,
      coinsToday: cap.projectedCoins,
      capCoinsToday: cap.capCoins,
      coinsWeek: coins[0]!.week,
      coinsInRange: coins[0]!.in_range,
      xpInRange: sum(inRange, (r) => r.xp_earned),
      lifetimeXp: totals.lifetimeXp,
      level: levelFor(totals.lifetimeXp).level,
    },
    tasks: {
      total: sum(inRange, (r) => r.tasks_total),
      done: sum(inRange, (r) => r.tasks_done),
      requiredTotal: sum(inRange, (r) => r.required_total),
      requiredDone: sum(inRange, (r) => r.required_done),
      completion: completionRate(
        sum(inRange, (r) => r.tasks_done),
        sum(inRange, (r) => r.tasks_total),
      ),
      sufficiency: sufficiency(activeInRange, config.sufficiency.activeDays),
    },
    days: eachDay(from, to).map((day) => {
      const r = byDay.get(day);
      return {
        day,
        tasksTotal: r?.tasks_total ?? 0,
        tasksDone: r?.tasks_done ?? 0,
        sessions: r?.sessions ?? 0,
        learningMinutes: r?.learning_minutes ?? 0,
        xpEarned: r?.xp_earned ?? 0,
      };
    }),
    learning: {
      sessions: sum(inRange, (r) => r.sessions),
      minutes: sum(inRange, (r) => r.learning_minutes),
      answers,
      accuracy: completionRate(
        sum(inRange, (r) => r.correct),
        answers,
      ),
      sufficiency: sufficiency(answers, config.sufficiency.subjectAttempts),
      improving: insights.improving,
      atRisk: insights.atRisk,
      subjects: subjects.map((m) => ({ ...m, title: titles.get(m.subject)! })),
    },
    school: { schoolYear: term.schoolYear, subjects: school },
    sideBySide: school.map((g) => {
      const librarySubject = LIBRARY_SUBJECT_OF[g.subjectCode] ?? null;
      const m = librarySubject ? masteryOf.get(librarySubject) : undefined;
      return {
        subjectCode: g.subjectCode,
        librarySubject,
        school: { averagePercent: g.averagePercent, count: g.count, sufficiency: g.sufficiency },
        mastery: m
          ? {
              meanScore: m.meanScore,
              practised: m.practised,
              skills: m.skills,
              sufficiency: m.sufficiency,
            }
          : null,
      };
    }),
    upcomingExams: events
      .filter((e) => e.type === 'EXAM')
      .map((e) => ({
        eventId: e.id,
        title: e.title,
        subjectCode: e.subject_code,
        startsAt: iso(e.starts_at)!,
        daysUntil: daysUntil(today, householdToday(new Date(e.starts_at), tz)),
      })),
  };
}

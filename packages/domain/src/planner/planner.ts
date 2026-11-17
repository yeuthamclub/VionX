// Today plan = candidates (one generator per source) → §11 priority with reasons → merge with what
// the day already holds (pins, removals, skips, facts) → deterministic order → time budget.
import { timeToMinutes } from '../calendar/dates.ts';
import { buildLearningPath } from '../mastery/path.ts';
import type { MasteryState } from '../mastery/types.ts';
import {
  isTaskKind,
  PLAN_ITEM_KINDS,
  type PlanItem,
  type PlanItemKind,
  type PlanLink,
  type PlannerConfig,
  type PlannerExam,
  type PlannerInput,
  type PlannerSkill,
  type PlannerTask,
  type PlanReason,
  type TodayPlan,
} from './types.ts';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const KNOWN: readonly MasteryState[] = ['PROFICIENT', 'MASTERED', 'RETAINED'];

/** Default length of one learning item: G1-3 15', G4-6 25', G7-9 35', G10-12 45'. */
export function sessionMinutesFor(config: PlannerConfig, grade: number): number {
  const band = config.sessionMinutes.find((b) => grade <= b.maxGrade);
  return (band ?? config.sessionMinutes[config.sessionMinutes.length - 1]!).minutes;
}

/** Minutes of the day window not covered by busy intervals (minutes of the day, may overlap). */
export function freeMinutesOf(
  window: { start: string; end: string },
  busy: readonly { start: number; end: number }[],
): number {
  const from = timeToMinutes(window.start);
  const to = timeToMinutes(window.end);
  let free = Math.max(0, to - from);
  let cursor = from;
  for (const b of [...busy].sort((x, y) => x.start - y.start || x.end - y.end)) {
    const start = Math.max(cursor, b.start);
    const end = Math.min(to, b.end);
    if (end > start) {
      free -= end - start;
      cursor = end;
    }
  }
  return Math.max(0, free);
}

/** Minutes Today may ask for: the parent setting (or the grade default), never above free time. */
export function dailyBudget(
  config: PlannerConfig,
  grade: number,
  freeMinutes: number,
  parentDailyMinutes: number | null,
): number {
  const wanted =
    parentDailyMinutes ?? config.defaultBudgetSessions * sessionMinutesFor(config, grade);
  return Math.max(0, Math.min(wanted, Math.floor(freeMinutes)));
}

/** §11 terms of one candidate, each 0-1. */
export interface PlanFactors {
  urgency?: number;
  prerequisiteGap?: number;
  forgettingRisk?: number;
  curriculumImportance?: number;
  examRelevance?: number;
  parentPriority?: number;
}

export interface PlanCandidate {
  kind: PlanItemKind;
  refKey: string;
  refId: string | null;
  title: string;
  subject: string | null;
  minutes: number;
  required: boolean;
  rewardXp: number;
  link: PlanLink;
  detail: Record<string, string | number | boolean>;
  factors: PlanFactors;
  /** Parameters shown with the reason of a term. */
  reasonParams?: Partial<Record<keyof PlanFactors, Record<string, string | number | boolean>>>;
  /** DONE / PENDING_APPROVAL come from facts (task occurrence, finished session). */
  fact: 'OPEN' | 'PENDING_APPROVAL' | 'DONE';
}

const TASK_KIND: Partial<Record<PlannerTask['type'], PlanItemKind>> = {
  HOMEWORK: 'HOMEWORK',
  READING: 'READING_GOAL',
  SPORT: 'ACTIVITY_GOAL',
};
const PARENT_PRIORITY = { LOW: 0, NORMAL: 0.5, HIGH: 1 } as const;

/** ParentTasks, Homework, ReadingGoal and ActivityGoal: today's task occurrences. */
export function taskCandidates(tasks: readonly PlannerTask[], config: PlannerConfig) {
  return tasks.map((t): PlanCandidate => {
    const kind = TASK_KIND[t.type] ?? 'PARENT_TASK';
    return {
      kind,
      refKey: `${kind}:${t.occurrenceId}`,
      refId: t.occurrenceId,
      title: t.title,
      subject: t.subject,
      minutes: t.durationMinutes ?? config.defaultTaskMinutes,
      required: t.required,
      rewardXp: t.rewardXp,
      link: {
        type: 'TASK',
        taskId: t.taskId,
        occurrenceId: t.occurrenceId,
        verificationMode: t.verificationMode,
      },
      detail: { taskType: t.type },
      factors: {
        urgency: t.required ? 1 : config.optionalTaskUrgency,
        parentPriority: PARENT_PRIORITY[t.priority],
      },
      reasonParams: {
        urgency: { required: t.required },
        parentPriority: { level: t.priority },
      },
      fact:
        t.status === 'COMPLETED'
          ? 'DONE'
          : t.status === 'PENDING_APPROVAL'
            ? 'PENDING_APPROVAL'
            : 'OPEN',
    };
  });
}

function skillCandidate(
  kind: PlanItemKind,
  s: PlannerSkill,
  minutes: number,
  rewardXp: number,
  rest: Pick<PlanCandidate, 'factors' | 'reasonParams' | 'detail'>,
): PlanCandidate {
  return {
    kind,
    refKey: `${kind}:${s.skillId}`,
    refId: s.skillId,
    title: s.title,
    subject: s.subject,
    minutes,
    required: false,
    rewardXp,
    link: { type: 'SESSION', mode: 'PRACTICE', skillIds: [s.skillId], subject: s.subject },
    fact: 'OPEN',
    ...rest,
  };
}

/**
 * ExamPrep: one item per skill of an exam inside the horizon. Without a skill list the exam
 * prepares the weakest skills of its subject. The closer the exam, the higher the item.
 */
export function examCandidates(
  exams: readonly PlannerExam[],
  skills: readonly PlannerSkill[],
  config: PlannerConfig,
  minutes: number,
  rewardXp: number,
): PlanCandidate[] {
  const byId = new Map(skills.map((s) => [s.skillId, s]));
  const best = new Map<string, PlanCandidate>();
  const ordered = [...exams]
    .filter((e) => e.daysUntil >= 0 && e.daysUntil <= config.examHorizonDays)
    .sort((a, b) => a.daysUntil - b.daysUntil || a.eventId.localeCompare(b.eventId));
  for (const exam of ordered) {
    const listed = exam.skillIds.flatMap((id) => byId.get(id) ?? []);
    const targets =
      listed.length > 0
        ? listed
        : skills
            .filter(
              (s) => s.subject === exam.subject && s.state !== 'MASTERED' && s.state !== 'RETAINED',
            )
            .sort(
              (a, b) =>
                a.masteryScore - b.masteryScore ||
                a.order - b.order ||
                a.skillId.localeCompare(b.skillId),
            )
            .slice(0, config.examSkillsWithoutList);
    const closeness = clamp01(1 - exam.daysUntil / (config.examHorizonDays + 1));
    for (const s of targets) {
      // The nearest exam of a skill wins (exams are visited nearest first).
      if (best.has(s.skillId)) continue;
      const params = { examTitle: exam.title, days: exam.daysUntil };
      best.set(
        s.skillId,
        skillCandidate('EXAM_PREP', s, minutes, rewardXp, {
          factors: {
            urgency: closeness,
            examRelevance: closeness,
            curriculumImportance: clamp01(1 - s.masteryScore / 100),
          },
          reasonParams: { urgency: params, examRelevance: params },
          detail: { eventId: exam.eventId, examTitle: exam.title, daysUntil: exam.daysUntil },
        }),
      );
    }
  }
  return [...best.values()];
}

/**
 * WeakPrerequisite: a skill the child has started but not reached Proficient on, that a skill
 * they have not yet learned well depends on.
 */
export function weakPrerequisiteCandidates(
  skills: readonly PlannerSkill[],
  minutes: number,
  rewardXp: number,
): PlanCandidate[] {
  const dependents = new Map<string, number>();
  for (const s of skills) {
    if (KNOWN.includes(s.state)) continue;
    for (const p of s.prerequisites) dependents.set(p, (dependents.get(p) ?? 0) + 1);
  }
  return skills
    .filter(
      (s) => dependents.has(s.skillId) && (s.state === 'INTRODUCED' || s.state === 'LEARNING'),
    )
    .map((s) =>
      skillCandidate('WEAK_PREREQUISITE', s, minutes, rewardXp, {
        factors: {
          prerequisiteGap: clamp01(1 - s.masteryScore / 100),
          curriculumImportance: clamp01(dependents.get(s.skillId)! / 3),
        },
        reasonParams: { prerequisiteGap: { dependents: dependents.get(s.skillId)! } },
        detail: {},
      }),
    );
}

/** DueReview: one review session per subject with skills whose review is due. */
export function dueReviewCandidates(
  skills: readonly PlannerSkill[],
  now: number,
  minutes: number,
  rewardXp: number,
): PlanCandidate[] {
  const bySubject = new Map<string, PlannerSkill[]>();
  for (const s of skills) {
    if (s.dueAt === null || s.dueAt > now) continue;
    bySubject.set(s.subject, [...(bySubject.get(s.subject) ?? []), s]);
  }
  return [...bySubject].map(([subject, due]): PlanCandidate => {
    const risk = clamp01(Math.max(...due.map((s) => s.forgettingRisk)));
    return {
      kind: 'DUE_REVIEW',
      refKey: `DUE_REVIEW:${subject}`,
      refId: null,
      title: '',
      subject,
      minutes,
      required: false,
      rewardXp,
      link: { type: 'SESSION', mode: 'REVIEW', skillIds: [], subject },
      detail: { count: due.length },
      factors: { forgettingRisk: risk, urgency: 0.5 },
      reasonParams: { forgettingRisk: { count: due.length } },
      fact: 'OPEN',
    };
  });
}

/** Curriculum progress: the next step of the learning path of each subject. */
export function nextSkillCandidates(
  skills: readonly PlannerSkill[],
  now: number,
  minutes: number,
  rewardXp: number,
): PlanCandidate[] {
  const subjects = [...new Set(skills.map((s) => s.subject))].sort();
  return subjects.flatMap((subject) => {
    const own = skills.filter((s) => s.subject === subject);
    const step = buildLearningPath(own, now, own.length).find((p) => p.kind !== 'REVIEW_DUE');
    const skill = step && own.find((s) => s.skillId === step.skillId);
    if (!skill) return [];
    return skillCandidate('NEXT_SKILL', skill, minutes, rewardXp, {
      factors: { curriculumImportance: 1 },
      detail: { step: step.kind },
    });
  });
}

const TERMS: readonly [keyof PlanFactors, PlanReason['code'], PlanReason['code']?][] = [
  ['urgency', 'DUE_TODAY', 'EXAM_SOON'],
  ['prerequisiteGap', 'PREREQUISITE_GAP'],
  ['forgettingRisk', 'REVIEW_DUE'],
  ['curriculumImportance', 'NEXT_IN_CURRICULUM'],
  ['examRelevance', 'EXAM_RELEVANT'],
  ['parentPriority', 'PARENT_PRIORITY'],
];

/**
 * §11: priority = urgency + prerequisite_gap + forgetting_risk + curriculum_importance +
 * exam_relevance + parent_priority − recent_workload_penalty. `workload` (0-1) is the share of
 * the day's budget already spent on learning; it only lowers optional learning items.
 */
export function scoreCandidate(
  c: PlanCandidate,
  config: PlannerConfig,
  workload: number,
): { priority: number; reasons: PlanReason[] } {
  const reasons: PlanReason[] = [];
  for (const [term, code, examCode] of TERMS) {
    const factor = c.factors[term];
    if (factor === undefined) continue;
    const params = c.reasonParams?.[term];
    reasons.push({
      code: term === 'urgency' && c.kind === 'EXAM_PREP' ? examCode! : code,
      points: round2(config.weights[term] * clamp01(factor)),
      ...(params ? { params } : {}),
    });
  }
  if (!isTaskKind(c.kind) && workload > 0) {
    reasons.push({
      code: 'WORKLOAD_TODAY',
      points: -round2(config.weights.recentWorkloadPenalty * clamp01(workload)),
    });
  }
  return { priority: round2(reasons.reduce((sum, r) => sum + r.points, 0)), reasons };
}

const KIND_ORDER = new Map(PLAN_ITEM_KINDS.map((k, i) => [k, i]));
/** One skill appears once: exam prep before prerequisite before next step. */
const SKILL_KIND_RANK: PlanItemKind[] = ['EXAM_PREP', 'WEAK_PREREQUISITE', 'NEXT_SKILL'];

const compareItems = (a: PlanItem, b: PlanItem) =>
  Number(b.pinned) - Number(a.pinned) ||
  b.priority - a.priority ||
  KIND_ORDER.get(a.kind)! - KIND_ORDER.get(b.kind)! ||
  (a.refKey < b.refKey ? -1 : a.refKey > b.refKey ? 1 : 0);

const isOpen = (i: PlanItem) => i.status === 'PLANNED' || i.status === 'STARTED';

export function planToday(input: PlannerInput, config: PlannerConfig): TodayPlan {
  const minutes = sessionMinutesFor(config, input.grade);
  const budget = dailyBudget(config, input.grade, input.freeMinutes, input.parentDailyMinutes);
  const workload = budget > 0 ? clamp01(input.finished.minutes / budget) : 1;
  const xp = input.sessionXp;
  const existing = new Map(input.existing.map((i) => [i.refKey, i]));
  const finishedSkills = new Set(input.finished.skillIds);
  const finishedReviews = new Set(input.finished.reviewSubjects);
  const covered = (i: Pick<PlanItem, 'kind' | 'refId' | 'subject'>) =>
    i.kind === 'DUE_REVIEW'
      ? i.subject !== null && finishedReviews.has(i.subject)
      : i.refId !== null && finishedSkills.has(i.refId);

  // Learning candidates: one per skill, then the best `maxLearningItems`.
  const perSkill = new Map<string, PlanCandidate>();
  for (const c of [
    ...examCandidates(input.exams, input.skills, config, minutes, xp),
    ...weakPrerequisiteCandidates(input.skills, minutes, xp),
    ...nextSkillCandidates(input.skills, input.now, minutes, xp),
  ]) {
    const seen = perSkill.get(c.refId!);
    if (!seen || SKILL_KIND_RANK.indexOf(c.kind) < SKILL_KIND_RANK.indexOf(seen.kind)) {
      perSkill.set(c.refId!, c);
    }
  }
  const toItem = (c: PlanCandidate): PlanItem => {
    const old = existing.get(c.refKey);
    const fact = !isTaskKind(c.kind) && covered(c) ? 'DONE' : c.fact;
    const kept =
      old && (old.status === 'SKIPPED' || old.status === 'REMOVED' || old.status === 'STARTED');
    return {
      kind: c.kind,
      refKey: c.refKey,
      refId: c.refId,
      title: c.title,
      subject: c.subject,
      minutes: c.minutes,
      ...scoreCandidate(c, config, workload),
      status: fact !== 'OPEN' ? fact : kept ? old!.status : 'PLANNED',
      pinned: old?.pinned ?? false,
      required: c.required,
      inBudget: true,
      rewardXp: c.rewardXp,
      link: c.link,
      detail: c.detail,
    };
  };
  const learning = [
    ...perSkill.values(),
    ...dueReviewCandidates(input.skills, input.now, minutes, xp),
  ]
    .map(toItem)
    .sort(compareItems);
  // The best `maxLearningItems`; an item the day already touched never falls off because of the cap.
  const items = [
    ...taskCandidates(input.tasks, config).map(toItem),
    ...learning.filter((i, n) => n < config.maxLearningItems || i.pinned || i.status !== 'PLANNED'),
  ];

  // Stored learning items that are no longer candidates: done today, or kept by a decision.
  const present = new Set(items.map((i) => i.refKey));
  for (const old of input.existing) {
    if (present.has(old.refKey) || isTaskKind(old.kind)) continue;
    if (covered(old)) items.push({ ...old, status: 'DONE', inBudget: true });
    else if (old.pinned || !['PLANNED', 'PENDING_APPROVAL'].includes(old.status)) items.push(old);
  }

  items.sort(compareItems);
  // Budget: what is done counts; required and pinned items always fit and take their time
  // first; the rest fits in order.
  const forced = (i: PlanItem) => !isOpen(i) || i.required || i.pinned;
  let left =
    budget -
    items
      .filter((i) => forced(i) && i.status !== 'SKIPPED' && i.status !== 'REMOVED')
      .reduce((sum, i) => sum + i.minutes, 0);
  for (const item of items) {
    if (forced(item)) {
      item.inBudget = true;
    } else {
      item.inBudget = item.minutes <= left;
      if (item.inBudget) left -= item.minutes;
    }
  }
  return { budgetMinutes: budget, sessionMinutes: minutes, items };
}

export type PlanActionError =
  'NOT_OPEN' | 'SYSTEM_VERIFIED_ONLY' | 'REQUIRED_ITEM' | 'REMOVED_ITEM';

/** May the child skip this item? Required tasks stay. */
export function canSkip(item: Pick<PlanItem, 'status' | 'required'>): PlanActionError | null {
  if (item.status !== 'PLANNED' && item.status !== 'STARTED') return 'NOT_OPEN';
  return item.required ? 'REQUIRED_ITEM' : null;
}

/** May the child start this item? */
export function canStart(item: Pick<PlanItem, 'status'>): PlanActionError | null {
  if (item.status === 'REMOVED') return 'REMOVED_ITEM';
  return item.status === 'PLANNED' || item.status === 'STARTED' || item.status === 'SKIPPED'
    ? null
    : 'NOT_OPEN';
}

/** Completing by hand is for tasks; learning items complete when a session covers them. */
export function canCompleteItem(item: Pick<PlanItem, 'status' | 'kind'>): PlanActionError | null {
  if (!isTaskKind(item.kind)) return 'SYSTEM_VERIFIED_ONLY';
  return item.status === 'PLANNED' || item.status === 'STARTED' || item.status === 'SKIPPED'
    ? null
    : 'NOT_OPEN';
}

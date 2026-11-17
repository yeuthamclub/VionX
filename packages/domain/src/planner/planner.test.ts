import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MASTERY_STATES } from '../mastery/types.ts';
import {
  canCompleteItem,
  canSkip,
  canStart,
  dailyBudget,
  DEFAULT_PLANNER_CONFIG as C,
  dueReviewCandidates,
  examCandidates,
  freeMinutesOf,
  isTaskKind,
  nextSkillCandidates,
  plannerConfigFrom,
  planToday,
  scoreCandidate,
  sessionMinutesFor,
  taskCandidates,
  weakPrerequisiteCandidates,
  type PlanItem,
  type PlannerExam,
  type PlannerInput,
  type PlannerSkill,
  type PlannerTask,
} from './index.ts';

const NOW = Date.UTC(2026, 10, 17, 3, 0, 0);

const skill = (id: string, over: Partial<PlannerSkill> = {}): PlannerSkill => ({
  skillId: id,
  topicId: 'topic',
  order: Number(id.replace(/\D/g, '')) || 0,
  state: 'NOT_LEARNED',
  masteryScore: 0,
  dueAt: null,
  prerequisites: [],
  subject: 'math',
  title: `Skill ${id}`,
  forgettingRisk: 0,
  ...over,
});

const task = (id: string, over: Partial<PlannerTask> = {}): PlannerTask => ({
  occurrenceId: id,
  taskId: `task-${id}`,
  type: 'CUSTOM',
  title: `Task ${id}`,
  subject: null,
  durationMinutes: 20,
  priority: 'NORMAL',
  required: true,
  rewardXp: 10,
  verificationMode: 'SELF_CHECK',
  status: 'ASSIGNED',
  ...over,
});

const input = (over: Partial<PlannerInput> = {}): PlannerInput => ({
  grade: 6,
  now: NOW,
  tasks: [],
  exams: [],
  skills: [],
  finished: { skillIds: [], reviewSubjects: [], minutes: 0 },
  freeMinutes: 300,
  parentDailyMinutes: null,
  sessionXp: 75,
  existing: [],
  ...over,
});

const byKey = (items: PlanItem[], refKey: string) => items.find((i) => i.refKey === refKey);

describe('planner config and time budget', () => {
  it('session lengths by grade: 15, 25, 35, 45 minutes', () => {
    expect([1, 3, 4, 6, 7, 9, 10, 12].map((g) => sessionMinutesFor(C, g))).toEqual([
      15, 15, 25, 25, 35, 35, 45, 45,
    ]);
  });

  it('a stored config is merged over the defaults', () => {
    const merged = plannerConfigFrom({ weights: { urgency: 50 }, maxLearningItems: 2 });
    expect(merged.weights.urgency).toBe(50);
    expect(merged.weights.examRelevance).toBe(C.weights.examRelevance);
    expect(merged.maxLearningItems).toBe(2);
    expect(plannerConfigFrom(null)).toEqual(C);
  });

  it('free time is the day window minus school and events, overlaps counted once', () => {
    const window = { start: '06:00', end: '21:30' };
    expect(freeMinutesOf(window, [])).toBe(930);
    expect(freeMinutesOf(window, [{ start: 420, end: 690 }])).toBe(660);
    expect(
      freeMinutesOf(window, [
        { start: 420, end: 690 },
        { start: 600, end: 720 },
        { start: 0, end: 400 },
        { start: 1280, end: 1440 },
      ]),
    ).toBe(930 - 40 - 300 - 10);
  });

  it('budget = parent setting or 3 sessions, never above free time', () => {
    expect(dailyBudget(C, 6, 600, null)).toBe(75);
    expect(dailyBudget(C, 2, 600, null)).toBe(45);
    expect(dailyBudget(C, 6, 600, 120)).toBe(120);
    expect(dailyBudget(C, 6, 50, 120)).toBe(50);
    expect(dailyBudget(C, 6, 0, null)).toBe(0);
  });

  it('free time and budget stay inside their bounds', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 1440 }), fc.integer({ min: 0, max: 1440 })), {
          maxLength: 12,
        }),
        fc.integer({ min: 1, max: 12 }),
        fc.option(fc.integer({ min: 10, max: 480 }), { nil: null }),
        (pairs, grade, parent) => {
          const busy = pairs.map(([a, b]) => ({ start: Math.min(a, b), end: Math.max(a, b) }));
          const free = freeMinutesOf(C.dayWindow, busy);
          expect(free).toBeGreaterThanOrEqual(0);
          expect(free).toBeLessThanOrEqual(930);
          // More busy time never gives more free time.
          expect(freeMinutesOf(C.dayWindow, busy.slice(1))).toBeGreaterThanOrEqual(free);
          const budget = dailyBudget(C, grade, free, parent);
          expect(budget).toBeGreaterThanOrEqual(0);
          expect(budget).toBeLessThanOrEqual(free);
        },
      ),
    );
  });
});

describe('candidate generators', () => {
  it('tasks map to ParentTask, Homework, ReadingGoal and ActivityGoal', () => {
    const kinds = taskCandidates(
      [
        task('a', { type: 'HOMEWORK' }),
        task('b', { type: 'READING' }),
        task('c', { type: 'SPORT' }),
        task('d', { type: 'HOUSEHOLD' }),
        task('e', { type: 'LEARNING', durationMinutes: null }),
      ],
      C,
    );
    expect(kinds.map((k) => k.kind)).toEqual([
      'HOMEWORK',
      'READING_GOAL',
      'ACTIVITY_GOAL',
      'PARENT_TASK',
      'PARENT_TASK',
    ]);
    expect(kinds[4]!.minutes).toBe(C.defaultTaskMinutes);
    expect(kinds.every((k) => k.link.type === 'TASK')).toBe(true);
  });

  it('task facts: completed is DONE, waiting for the parent is PENDING_APPROVAL', () => {
    const c = taskCandidates(
      [
        task('a', { status: 'COMPLETED' }),
        task('b', { status: 'PENDING_APPROVAL' }),
        task('c', { status: 'REJECTED' }),
      ],
      C,
    );
    expect(c.map((x) => x.fact)).toEqual(['DONE', 'PENDING_APPROVAL', 'OPEN']);
  });

  it('exam prep: listed skills, inside the horizon only, nearest exam wins', () => {
    const skills = [skill('s1'), skill('s2'), skill('s3')];
    const exams: PlannerExam[] = [
      { eventId: 'far', title: 'Cuối kì', daysUntil: 15, subject: 'math', skillIds: ['s3'] },
      { eventId: 'e2', title: 'Giữa kì', daysUntil: 10, subject: 'math', skillIds: ['s1'] },
      { eventId: 'e1', title: '15 phút', daysUntil: 3, subject: 'math', skillIds: ['s1', 's2'] },
      { eventId: 'past', title: 'Đã thi', daysUntil: -1, subject: 'math', skillIds: ['s3'] },
    ];
    const c = examCandidates(exams, skills, C, 25, 75);
    expect(c.map((x) => x.refId).sort()).toEqual(['s1', 's2']);
    expect(c.every((x) => x.detail.eventId === 'e1' && x.detail.daysUntil === 3)).toBe(true);
    expect(c[0]!.link).toEqual({
      type: 'SESSION',
      mode: 'PRACTICE',
      skillIds: [c[0]!.refId],
      subject: 'math',
    });
  });

  it('an exam without a skill list prepares the weakest skills of its subject', () => {
    const skills = [
      skill('s1', { masteryScore: 70, state: 'PROFICIENT' }),
      skill('s2', { masteryScore: 10, state: 'INTRODUCED' }),
      skill('s3', { masteryScore: 30, state: 'LEARNING' }),
      skill('s4', { masteryScore: 95, state: 'MASTERED' }),
      skill('v1', { subject: 'viet' }),
    ];
    const c = examCandidates(
      [{ eventId: 'e', title: 'Thi', daysUntil: 2, subject: 'math', skillIds: [] }],
      skills,
      C,
      25,
      75,
    );
    expect(c.map((x) => x.refId)).toEqual(['s2', 's3']);
  });

  it('weak prerequisite: started, below Proficient, and something still depends on it', () => {
    const skills = [
      skill('s1', { state: 'LEARNING', masteryScore: 40 }),
      skill('s2', { prerequisites: ['s1'] }),
      skill('s3', { state: 'LEARNING', masteryScore: 30 }),
      skill('s4', { state: 'MASTERED', masteryScore: 90, prerequisites: ['s3'] }),
      skill('s5', { state: 'PROFICIENT', masteryScore: 70 }),
      skill('s6', { prerequisites: ['s5'] }),
    ];
    const c = weakPrerequisiteCandidates(skills, 25, 75);
    expect(c.map((x) => x.refId)).toEqual(['s1']);
    expect(c[0]!.factors.prerequisiteGap).toBeCloseTo(0.6);
  });

  it('due reviews: one item per subject with the number of skills', () => {
    const skills = [
      skill('s1', { dueAt: NOW - 1000, forgettingRisk: 0.4 }),
      skill('s2', { dueAt: NOW, forgettingRisk: 0.7 }),
      skill('s3', { dueAt: NOW + 1000 }),
      skill('v1', { subject: 'viet', dueAt: NOW - 5 }),
    ];
    const c = dueReviewCandidates(skills, NOW, 25, 75);
    expect(c.map((x) => [x.refKey, x.detail.count, x.factors.forgettingRisk])).toEqual([
      ['DUE_REVIEW:math', 2, 0.7],
      ['DUE_REVIEW:viet', 1, 0],
    ]);
    expect(c[0]!.link).toEqual({ type: 'SESSION', mode: 'REVIEW', skillIds: [], subject: 'math' });
  });

  it('next skill: the first step of each subject that is not a review', () => {
    const skills = [
      skill('s1', { dueAt: NOW - 1, state: 'PROFICIENT', masteryScore: 70 }),
      skill('s2', { state: 'LEARNING', masteryScore: 30 }),
      skill('s3'),
      skill('v1', { subject: 'viet' }),
    ];
    expect(nextSkillCandidates(skills, NOW, 25, 75).map((x) => x.refId)).toEqual(['s2', 'v1']);
  });
});

describe('priority (§11)', () => {
  it('is the sum of its reasons, and the workload only lowers learning items', () => {
    const [t] = taskCandidates([task('a', { priority: 'HIGH' })], C);
    const scored = scoreCandidate(t!, C, 1);
    expect(scored.priority).toBe(C.weights.urgency + C.weights.parentPriority);
    expect(scored.reasons.map((r) => r.code)).toEqual(['DUE_TODAY', 'PARENT_PRIORITY']);

    const [n] = nextSkillCandidates([skill('s1')], NOW, 25, 75);
    expect(scoreCandidate(n!, C, 0).priority).toBe(C.weights.curriculumImportance);
    const tired = scoreCandidate(n!, C, 0.5);
    expect(tired.priority).toBe(C.weights.curriculumImportance - 7.5);
    expect(tired.reasons.at(-1)).toEqual({ code: 'WORKLOAD_TODAY', points: -7.5 });
  });

  it('a higher parent priority never lowers a task', () => {
    const p = (priority: PlannerTask['priority'], required: boolean) =>
      scoreCandidate(taskCandidates([task('a', { priority, required })], C)[0]!, C, 0).priority;
    for (const required of [true, false]) {
      expect(p('LOW', required)).toBeLessThan(p('NORMAL', required));
      expect(p('NORMAL', required)).toBeLessThan(p('HIGH', required));
    }
    expect(p('HIGH', false)).toBeLessThan(p('HIGH', true));
  });

  it('a nearer exam gives a higher exam-prep priority', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 13 }), (days) => {
        const at = (daysUntil: number) =>
          scoreCandidate(
            examCandidates(
              [{ eventId: 'e', title: 'Thi', daysUntil, subject: 'math', skillIds: ['s1'] }],
              [skill('s1')],
              C,
              25,
              75,
            )[0]!,
            C,
            0,
          ).priority;
        expect(at(days)).toBeGreaterThan(at(days + 1));
      }),
    );
  });
});

// --- Arbitraries -------------------------------------------------------------------------------------

const arbTask = fc.record({
  type: fc.constantFrom<PlannerTask['type']>('HOMEWORK', 'READING', 'SPORT', 'CUSTOM', 'HOUSEHOLD'),
  durationMinutes: fc.option(fc.integer({ min: 1, max: 120 }), { nil: null }),
  priority: fc.constantFrom<PlannerTask['priority']>('LOW', 'NORMAL', 'HIGH'),
  required: fc.boolean(),
  status: fc.constantFrom<PlannerTask['status']>(
    'ASSIGNED',
    'PENDING_APPROVAL',
    'COMPLETED',
    'REJECTED',
  ),
});

const arbSkill = fc.record({
  state: fc.constantFrom(...MASTERY_STATES),
  masteryScore: fc.integer({ min: 0, max: 100 }),
  due: fc.option(fc.integer({ min: -5, max: 5 }), { nil: null }),
  subject: fc.constantFrom('math', 'viet'),
  forgettingRisk: fc.double({ min: 0, max: 1, noNaN: true }),
  prerequisite: fc.option(fc.nat(), { nil: null }),
});

const arbInput = fc
  .record({
    grade: fc.integer({ min: 1, max: 12 }),
    tasks: fc.array(arbTask, { maxLength: 6 }),
    skills: fc.array(arbSkill, { maxLength: 10 }),
    exams: fc.array(
      fc.record({
        daysUntil: fc.integer({ min: -2, max: 20 }),
        subject: fc.constantFrom('math', 'viet', null),
        picks: fc.array(fc.nat(), { maxLength: 3 }),
      }),
      { maxLength: 3 },
    ),
    freeMinutes: fc.integer({ min: 0, max: 930 }),
    parentDailyMinutes: fc.option(fc.integer({ min: 10, max: 480 }), { nil: null }),
    finishedMinutes: fc.integer({ min: 0, max: 200 }),
    finishedPicks: fc.array(fc.nat(), { maxLength: 3 }),
  })
  .map((r): PlannerInput => {
    const skills = r.skills.map((s, i) =>
      skill(`s${i}`, {
        order: i,
        state: s.state,
        masteryScore: s.masteryScore,
        dueAt: s.due === null ? null : NOW + s.due * 3_600_000,
        subject: s.subject,
        forgettingRisk: s.forgettingRisk,
        prerequisites: s.prerequisite !== null && i > 0 ? [`s${s.prerequisite % i}`] : [],
      }),
    );
    const pick = (n: number) => (skills.length ? [skills[n % skills.length]!.skillId] : []);
    return input({
      grade: r.grade,
      tasks: r.tasks.map((t, i) => task(`t${i}`, t)),
      skills,
      exams: r.exams.map((e, i) => ({
        eventId: `e${i}`,
        title: `Exam ${i}`,
        daysUntil: e.daysUntil,
        subject: e.subject,
        skillIds: [...new Set(e.picks.flatMap(pick))],
      })),
      freeMinutes: r.freeMinutes,
      parentDailyMinutes: r.parentDailyMinutes,
      finished: {
        skillIds: [...new Set(r.finishedPicks.flatMap(pick))],
        reviewSubjects: [],
        minutes: r.finishedMinutes,
      },
    });
  });

const shuffled = <T>(xs: readonly T[], seed: number): T[] =>
  xs
    .map((x, i) => [x, Math.sin(seed + i * 12.9898) * 43758.5453] as const)
    .sort((a, b) => (a[1] % 1) - (b[1] % 1))
    .map(([x]) => x);

describe('planToday', () => {
  it('acceptance: an exam in 3 days on 2 skills ranks above optional tasks', () => {
    const plan = planToday(
      input({
        tasks: [
          task('opt1', { required: false, priority: 'HIGH' }),
          task('opt2', { required: false, type: 'READING' }),
        ],
        skills: [skill('s1'), skill('s2'), skill('s3')],
        exams: [
          {
            eventId: 'e',
            title: 'Kiểm tra',
            daysUntil: 3,
            subject: 'math',
            skillIds: ['s1', 's2'],
          },
        ],
      }),
      C,
    );
    expect(plan.items.slice(0, 2).map((i) => i.kind)).toEqual(['EXAM_PREP', 'EXAM_PREP']);
    const exam = plan.items[0]!;
    expect(exam.reasons.map((r) => r.code)).toEqual([
      'EXAM_SOON',
      'NEXT_IN_CURRICULUM',
      'EXAM_RELEVANT',
    ]);
    expect(exam.reasons[0]!.params).toEqual({ examTitle: 'Kiểm tra', days: 3 });
    expect(exam.minutes).toBe(25);
  });

  it('an exam within 3 days outranks every optional task, whatever the workload', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.array(arbTask, { maxLength: 6 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 400 }),
        (daysUntil, tasks, masteryScore, done) => {
          const plan = planToday(
            input({
              tasks: tasks.map((t, i) => task(`t${i}`, { ...t, required: false })),
              skills: [skill('s1', { masteryScore })],
              exams: [{ eventId: 'e', title: 'Thi', daysUntil, subject: 'math', skillIds: ['s1'] }],
              finished: { skillIds: [], reviewSubjects: [], minutes: done },
            }),
            C,
          );
          const exam = byKey(plan.items, 'EXAM_PREP:s1')!;
          for (const i of plan.items.filter((x) => isTaskKind(x.kind))) {
            expect(exam.priority).toBeGreaterThan(i.priority);
          }
        },
      ),
    );
  });

  it('every item has reasons that add up to its priority; keys are unique', () => {
    fc.assert(
      fc.property(arbInput, (inp) => {
        const { items } = planToday(inp, C);
        expect(new Set(items.map((i) => i.refKey)).size).toBe(items.length);
        for (const i of items) {
          expect(i.reasons.length).toBeGreaterThan(0);
          expect(i.priority).toBeCloseTo(
            i.reasons.reduce((sum, r) => sum + r.points, 0),
            5,
          );
          expect(i.minutes).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('ordering is deterministic: the order of the inputs does not matter', () => {
    fc.assert(
      fc.property(arbInput, fc.integer(), (inp, seed) => {
        const again = planToday(
          {
            ...inp,
            tasks: shuffled(inp.tasks, seed),
            skills: shuffled(inp.skills, seed),
            exams: shuffled(inp.exams, seed),
          },
          C,
        );
        expect(again).toEqual(planToday(inp, C));
      }),
    );
  });

  it('pinned first, then priority descending; a skill appears once', () => {
    fc.assert(
      fc.property(arbInput, (inp) => {
        const { items } = planToday(inp, C);
        for (let i = 1; i < items.length; i++) {
          const [a, b] = [items[i - 1]!, items[i]!];
          expect(Number(a.pinned)).toBeGreaterThanOrEqual(Number(b.pinned));
          if (a.pinned === b.pinned) expect(a.priority).toBeGreaterThanOrEqual(b.priority);
        }
        const skills = items
          .filter((i) => i.link.type === 'SESSION' && i.refId)
          .map((i) => i.refId);
        expect(new Set(skills).size).toBe(skills.length);
      }),
    );
  });

  it('budget: optional open items fit in what is left; required items always fit', () => {
    fc.assert(
      fc.property(arbInput, (inp) => {
        const plan = planToday(inp, C);
        expect(plan.budgetMinutes).toBeLessThanOrEqual(inp.freeMinutes);
        const open = plan.items.filter((i) => i.status === 'PLANNED');
        const spent = plan.items
          .filter((i) => i.status === 'DONE' || i.status === 'PENDING_APPROVAL')
          .reduce((sum, i) => sum + i.minutes, 0);
        const forced = open.filter((i) => i.required).reduce((sum, i) => sum + i.minutes, 0);
        const optional = open
          .filter((i) => !i.required && i.inBudget)
          .reduce((sum, i) => sum + i.minutes, 0);
        expect(open.filter((i) => i.required).every((i) => i.inBudget)).toBe(true);
        if (optional > 0) {
          expect(optional).toBeLessThanOrEqual(plan.budgetMinutes - spent - forced + 0);
        }
        const learning = open.filter((i) => !isTaskKind(i.kind));
        expect(learning.length).toBeLessThanOrEqual(C.maxLearningItems);
      }),
    );
  });

  it('regenerating with its own output changes nothing (stable)', () => {
    fc.assert(
      fc.property(arbInput, (inp) => {
        const first = planToday(inp, C);
        expect(planToday({ ...inp, existing: first.items }, C)).toEqual(first);
      }),
    );
  });

  it('pins, removals and skips of the day survive a regeneration', () => {
    fc.assert(
      fc.property(arbInput, fc.array(fc.nat(), { maxLength: 4 }), (inp, picks) => {
        const first = planToday(inp, C).items;
        if (first.length === 0) return;
        const touched = first.map((i) => ({ ...i }));
        picks.forEach((p, n) => {
          const item = touched[p % touched.length]!;
          if (n % 3 === 0) item.pinned = true;
          else if (item.status === 'PLANNED') item.status = n % 3 === 1 ? 'REMOVED' : 'SKIPPED';
        });
        const next = planToday({ ...inp, existing: touched }, C).items;
        for (const before of touched) {
          const after = byKey(next, before.refKey);
          if (before.pinned) expect(after?.pinned).toBe(true);
          if (before.status === 'REMOVED' || before.status === 'SKIPPED') {
            expect(after?.status).toBe(before.status);
          }
        }
      }),
    );
  });

  it('a finished session completes its learning item, also when it is no longer a candidate', () => {
    const skills = [skill('s1', { state: 'LEARNING', masteryScore: 40 }), skill('s2')];
    const first = planToday(input({ skills }), C);
    expect(first.items.map((i) => [i.refKey, i.status])).toEqual([['NEXT_SKILL:s1', 'PLANNED']]);
    // The session moved s1 to Proficient: the path now proposes s2.
    const after = planToday(
      input({
        skills: [skill('s1', { state: 'PROFICIENT', masteryScore: 65 }), skill('s2')],
        finished: { skillIds: ['s1'], reviewSubjects: [], minutes: 20 },
        existing: first.items,
      }),
      C,
    );
    expect(byKey(after.items, 'NEXT_SKILL:s1')?.status).toBe('DONE');
    expect(byKey(after.items, 'NEXT_SKILL:s2')?.status).toBe('PLANNED');
    expect(byKey(after.items, 'NEXT_SKILL:s2')!.reasons.at(-1)!.code).toBe('WORKLOAD_TODAY');
  });

  it('a finished review completes the review item of its subject', () => {
    const due = [skill('s1', { dueAt: NOW - 1, state: 'PROFICIENT', masteryScore: 70 })];
    const first = planToday(input({ skills: due }), C);
    expect(byKey(first.items, 'DUE_REVIEW:math')?.status).toBe('PLANNED');
    const after = planToday(
      input({
        skills: [skill('s1', { dueAt: NOW + 86_400_000, state: 'PROFICIENT', masteryScore: 72 })],
        finished: { skillIds: ['s1'], reviewSubjects: ['math'], minutes: 10 },
        existing: first.items,
      }),
      C,
    );
    expect(byKey(after.items, 'DUE_REVIEW:math')?.status).toBe('DONE');
  });

  it('a task that left the day leaves the plan; a rejected one is open again', () => {
    const first = planToday(input({ tasks: [task('a'), task('b', { status: 'COMPLETED' })] }), C);
    expect(byKey(first.items, 'PARENT_TASK:b')?.status).toBe('DONE');
    const after = planToday(
      input({ tasks: [task('b', { status: 'REJECTED' })], existing: first.items }),
      C,
    );
    expect(after.items.map((i) => [i.refKey, i.status])).toEqual([['PARENT_TASK:b', 'PLANNED']]);
  });

  it('items beyond the budget are marked, required ones are not', () => {
    const plan = planToday(
      input({
        parentDailyMinutes: 30,
        tasks: [
          task('req', { durationMinutes: 40 }),
          task('opt', { required: false, durationMinutes: 10 }),
        ],
        skills: [skill('s1')],
      }),
      C,
    );
    expect(plan.budgetMinutes).toBe(30);
    expect(plan.items.map((i) => [i.refKey, i.inBudget])).toEqual([
      ['PARENT_TASK:req', true],
      ['PARENT_TASK:opt', false],
      ['NEXT_SKILL:s1', false],
    ]);
  });
});

describe('item actions', () => {
  it('skip: open optional items only', () => {
    expect(canSkip({ status: 'PLANNED', required: false })).toBeNull();
    expect(canSkip({ status: 'STARTED', required: false })).toBeNull();
    expect(canSkip({ status: 'PLANNED', required: true })).toBe('REQUIRED_ITEM');
    expect(canSkip({ status: 'DONE', required: false })).toBe('NOT_OPEN');
  });

  it('start: open or skipped items, never removed or done ones', () => {
    expect(canStart({ status: 'PLANNED' })).toBeNull();
    expect(canStart({ status: 'SKIPPED' })).toBeNull();
    expect(canStart({ status: 'REMOVED' })).toBe('REMOVED_ITEM');
    expect(canStart({ status: 'DONE' })).toBe('NOT_OPEN');
  });

  it('complete: tasks by hand, learning items only through a session', () => {
    expect(canCompleteItem({ kind: 'HOMEWORK', status: 'PLANNED' })).toBeNull();
    expect(canCompleteItem({ kind: 'EXAM_PREP', status: 'PLANNED' })).toBe('SYSTEM_VERIFIED_ONLY');
    expect(canCompleteItem({ kind: 'PARENT_TASK', status: 'DONE' })).toBe('NOT_OPEN');
  });
});

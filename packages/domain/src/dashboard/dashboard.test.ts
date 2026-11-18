import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays } from '../calendar/dates.ts';
import {
  activeStreak,
  assessmentFileBelongsTo,
  assessmentFilePath,
  completionRate,
  dashboardConfigFrom,
  DEFAULT_DASHBOARD_CONFIG as C,
  gradePercent,
  gradeTrend,
  rangeDays,
  schoolTermOf,
  skillInsights,
  subjectMastery,
  sufficiency,
  type DashboardSkill,
} from './index.ts';

const TODAY = '2026-11-17';
const H = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const F = '33333333-3333-4333-8333-333333333333';

const skill = (id: string, over: Partial<DashboardSkill> = {}): DashboardSkill => ({
  skillId: id,
  subject: 'math',
  title: `Skill ${id}`,
  state: 'LEARNING',
  masteryScore: 40,
  attemptCount: 10,
  correctCount: 5,
  recentAccuracy: 0.5,
  forgettingRisk: 0,
  lastAttemptDay: TODAY,
  ...over,
});

describe('config and sufficiency', () => {
  it('a stored config is merged over the defaults', () => {
    const merged = dashboardConfigFrom({ sufficiency: { grades: { low: 1, ok: 2 } } });
    expect(merged.sufficiency.grades).toEqual({ low: 1, ok: 2 });
    expect(merged.sufficiency.skillAttempts).toEqual(C.sufficiency.skillAttempts);
    expect(dashboardConfigFrom(null)).toEqual(C);
  });

  it('labels: below low INSUFFICIENT, from low LOW, from ok OK', () => {
    const t = { low: 2, ok: 4 };
    expect([0, 1, 2, 3, 4, 9].map((n) => sufficiency(n, t))).toEqual([
      'INSUFFICIENT',
      'INSUFFICIENT',
      'LOW',
      'LOW',
      'OK',
      'OK',
    ]);
  });

  it('more data never lowers the label', () => {
    const rank = { INSUFFICIENT: 0, LOW: 1, OK: 2 };
    fc.assert(
      fc.property(fc.nat(100), fc.nat(100), fc.nat(50), fc.nat(50), (a, b, low, extra) => {
        const t = { low, ok: low + extra };
        const [x, y] = [Math.min(a, b), Math.max(a, b)];
        expect(rank[sufficiency(x, t)]).toBeLessThanOrEqual(rank[sufficiency(y, t)]);
      }),
    );
  });

  it('a range ends today and has the configured number of days', () => {
    expect(rangeDays(C, '7d', TODAY)).toEqual({ from: '2026-11-11', to: TODAY, days: 7 });
    expect(rangeDays(C, '30d', TODAY).from).toBe('2026-10-19');
    expect(rangeDays(C, '90d', TODAY).days).toBe(90);
  });
});

describe('school gradebook', () => {
  it('school year starts in September; HK1 to mid January, HK2 to May, then summer', () => {
    expect(schoolTermOf('2026-09-01')).toEqual({ schoolYear: '2026-2027', semester: 'HK1' });
    expect(schoolTermOf('2026-11-17')).toEqual({ schoolYear: '2026-2027', semester: 'HK1' });
    expect(schoolTermOf('2027-01-15')).toEqual({ schoolYear: '2026-2027', semester: 'HK1' });
    expect(schoolTermOf('2027-01-16')).toEqual({ schoolYear: '2026-2027', semester: 'HK2' });
    expect(schoolTermOf('2027-05-31')).toEqual({ schoolYear: '2026-2027', semester: 'HK2' });
    expect(schoolTermOf('2027-06-01')).toEqual({ schoolYear: '2026-2027', semester: 'SUMMER' });
    expect(schoolTermOf('2027-08-31')).toEqual({ schoolYear: '2026-2027', semester: 'SUMMER' });
  });

  it('a score is a share of its maximum', () => {
    expect(gradePercent(8.5, 10)).toBe(85);
    expect(gradePercent(17, 20)).toBe(85);
    expect(gradePercent(1, 3)).toBe(33.3);
    expect(gradePercent(12, 10)).toBe(100);
    expect(gradePercent(5, 0)).toBe(0);
  });

  it('attachment paths are per household and child, and only ours are accepted', () => {
    const path = assessmentFilePath({ householdId: H, studentId: S, fileId: F }, 'application/pdf');
    expect(path).toBe(`${H}/${S}/${F}.pdf`);
    expect(assessmentFileBelongsTo(path, { householdId: H, studentId: S })).toBe(true);
    expect(assessmentFileBelongsTo(path, { householdId: S, studentId: S })).toBe(false);
    expect(assessmentFileBelongsTo(path, { householdId: H, studentId: H })).toBe(false);
    expect(assessmentFileBelongsTo(`${H}/${S}/../x.pdf`, { householdId: H, studentId: S })).toBe(
      false,
    );
    expect(assessmentFileBelongsTo(`${H}/${S}/${F}.exe`, { householdId: H, studentId: S })).toBe(
      false,
    );
  });

  it('trend: newer half against older half, with the sufficiency of the count', () => {
    expect(gradeTrend([], C)).toEqual({
      count: 0,
      averagePercent: null,
      direction: 'FLAT',
      deltaPercent: 0,
      sufficiency: 'INSUFFICIENT',
    });
    expect(gradeTrend([{ day: '2026-10-01', percent: 70 }], C)).toMatchObject({
      averagePercent: 70,
      direction: 'FLAT',
      sufficiency: 'INSUFFICIENT',
    });
    const up = gradeTrend(
      [
        { day: '2026-11-10', percent: 90 },
        { day: '2026-09-10', percent: 60 },
        { day: '2026-10-10', percent: 70 },
        { day: '2026-11-01', percent: 80 },
      ],
      C,
    );
    expect(up).toEqual({
      count: 4,
      averagePercent: 75,
      direction: 'UP',
      deltaPercent: 20,
      sufficiency: 'OK',
    });
    expect(
      gradeTrend(
        [
          { day: '2026-09-10', percent: 80 },
          { day: '2026-10-10', percent: 77 },
        ],
        C,
      ),
    ).toMatchObject({ direction: 'FLAT', deltaPercent: -3, sufficiency: 'LOW' });
    expect(
      gradeTrend(
        [
          { day: '2026-09-10', percent: 80 },
          { day: '2026-10-10', percent: 60 },
        ],
        C,
      ).direction,
    ).toBe('DOWN');
  });

  it('trend: order of the points does not matter; the average stays inside the scores', () => {
    const arbPoints = fc.array(
      fc.record({
        offset: fc.integer({ min: 0, max: 200 }),
        percent: fc.integer({ min: 0, max: 100 }),
      }),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(arbPoints, (raw) => {
        // Distinct days, so the order in time is defined.
        const points = [...new Map(raw.map((p) => [p.offset, p])).values()].map((p) => ({
          day: addDays('2026-01-01', p.offset),
          percent: p.percent,
        }));
        const trend = gradeTrend(points, C);
        expect(gradeTrend([...points].reverse(), C)).toEqual(trend);
        if (points.length > 0) {
          expect(trend.averagePercent).toBeGreaterThanOrEqual(
            Math.min(...points.map((p) => p.percent)),
          );
          expect(trend.averagePercent).toBeLessThanOrEqual(
            Math.max(...points.map((p) => p.percent)),
          );
        }
        if (trend.direction === 'UP') expect(trend.deltaPercent).toBeGreaterThan(0);
        if (trend.direction === 'DOWN') expect(trend.deltaPercent).toBeLessThan(0);
      }),
    );
  });
});

describe('activity', () => {
  it('streak: consecutive days ending today; today without activity does not break it yet', () => {
    expect(activeStreak([], TODAY)).toBe(0);
    expect(activeStreak([TODAY], TODAY)).toBe(1);
    expect(activeStreak(['2026-11-15', '2026-11-16', TODAY], TODAY)).toBe(3);
    expect(activeStreak(['2026-11-15', '2026-11-16'], TODAY)).toBe(2);
    expect(activeStreak(['2026-11-14', '2026-11-15'], TODAY)).toBe(0);
    expect(activeStreak(['2026-11-13', '2026-11-15', '2026-11-16', TODAY], TODAY)).toBe(3);
  });

  it('streak never exceeds the number of active days and grows by one with a new day', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 40 }), { maxLength: 30 }), (offsets) => {
        const days = [...new Set(offsets)].map((o) => addDays(TODAY, -o));
        const streak = activeStreak(days, TODAY);
        expect(streak).toBeGreaterThanOrEqual(0);
        expect(streak).toBeLessThanOrEqual(days.length);
        const tomorrow = addDays(TODAY, 1);
        if (days.includes(TODAY)) {
          expect(activeStreak([...days, tomorrow], tomorrow)).toBe(streak + 1);
        }
      }),
    );
  });

  it('completion rate: done over total, null when nothing was planned', () => {
    expect(completionRate(0, 0)).toBeNull();
    expect(completionRate(1, 3)).toBe(0.333);
    expect(completionRate(3, 3)).toBe(1);
    expect(completionRate(5, 3)).toBe(1);
  });
});

describe('skills', () => {
  const range = { from: '2026-11-11', to: TODAY };

  it('improving: practised in the range and recently more accurate than overall', () => {
    const out = skillInsights(
      [
        skill('a', { recentAccuracy: 0.8 }),
        skill('b', { recentAccuracy: 0.8, lastAttemptDay: '2026-10-01' }),
        skill('c', { recentAccuracy: 0.55 }),
        skill('d', { recentAccuracy: 0.9, attemptCount: 2, correctCount: 1 }),
      ],
      range,
      C,
    );
    expect(out.improving.map((s) => [s.skillId, s.reason, s.sufficiency])).toEqual([
      ['a', 'RECENT_ABOVE_AVERAGE', 'OK'],
    ]);
    expect(out.atRisk).toEqual([]);
  });

  it('at risk: recently less accurate than overall, or learned and likely forgotten', () => {
    const out = skillInsights(
      [
        skill('a', { recentAccuracy: 0.3, attemptCount: 5, correctCount: 3 }),
        skill('b', { state: 'MASTERED', forgettingRisk: 0.7, lastAttemptDay: '2026-09-01' }),
        skill('c', { state: 'NOT_LEARNED', forgettingRisk: 0.9 }),
        skill('d', { forgettingRisk: 0.5 }),
      ],
      range,
      C,
    );
    expect(out.atRisk.map((s) => [s.skillId, s.reason, s.sufficiency])).toEqual([
      ['b', 'FORGETTING', 'OK'],
      ['a', 'RECENT_BELOW_AVERAGE', 'LOW'],
    ]);
    expect(out.improving).toEqual([]);
  });

  it('lists are capped, a skill is in one list at most, thin data is left out', () => {
    const arb = fc.array(
      fc.record({
        attemptCount: fc.integer({ min: 0, max: 30 }),
        accuracy: fc.double({ min: 0, max: 1, noNaN: true }),
        recentAccuracy: fc.double({ min: 0, max: 1, noNaN: true }),
        forgettingRisk: fc.double({ min: 0, max: 1, noNaN: true }),
        recent: fc.boolean(),
      }),
      { maxLength: 30 },
    );
    fc.assert(
      fc.property(arb, (raw) => {
        const skills = raw.map((r, i) =>
          skill(`s${i}`, {
            attemptCount: r.attemptCount,
            correctCount: Math.round(r.attemptCount * r.accuracy),
            recentAccuracy: r.recentAccuracy,
            forgettingRisk: r.forgettingRisk,
            lastAttemptDay: r.recent ? TODAY : '2026-01-01',
          }),
        );
        const out = skillInsights(skills, range, C);
        expect(out.improving.length).toBeLessThanOrEqual(C.skillListLimit);
        expect(out.atRisk.length).toBeLessThanOrEqual(C.skillListLimit);
        const ids = [...out.improving, ...out.atRisk].map((s) => s.skillId);
        expect(new Set(ids).size).toBe(ids.length);
        expect(
          [...out.improving, ...out.atRisk].every((s) => s.sufficiency !== 'INSUFFICIENT'),
        ).toBe(true);
        expect(skillInsights([...skills].reverse(), range, C)).toEqual(out);
      }),
    );
  });

  it('mastery per subject: practised skills only in the mean, with a sufficiency label', () => {
    const out = subjectMastery(
      [
        skill('a', { masteryScore: 80, state: 'PROFICIENT', attemptCount: 20 }),
        skill('b', { masteryScore: 40, attemptCount: 12 }),
        skill('c', { masteryScore: 0, state: 'NOT_LEARNED', attemptCount: 0 }),
        skill('v', { subject: 'viet', masteryScore: 30, attemptCount: 4 }),
        skill('w', { subject: 'eng', masteryScore: 0, state: 'NOT_LEARNED', attemptCount: 0 }),
      ],
      C,
    );
    expect(out).toEqual([
      {
        subject: 'eng',
        skills: 1,
        practised: 0,
        proficient: 0,
        meanScore: null,
        attempts: 0,
        sufficiency: 'INSUFFICIENT',
      },
      {
        subject: 'math',
        skills: 3,
        practised: 2,
        proficient: 1,
        meanScore: 60,
        attempts: 32,
        sufficiency: 'OK',
      },
      {
        subject: 'viet',
        skills: 1,
        practised: 1,
        proficient: 0,
        meanScore: 30,
        attempts: 4,
        sufficiency: 'INSUFFICIENT',
      },
    ]);
  });
});

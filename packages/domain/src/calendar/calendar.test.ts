import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayFromNumber,
  dayNumber,
  daysBetween,
  eachDay,
  householdToday,
  isoWeekday,
  isValidDay,
  isValidTime,
  timeToMinutes,
  timeZoneOffsetMinutes,
  toHHMM,
  weekStart,
  zonedDayStart,
} from './dates.ts';
import {
  formatRRule,
  normaliseRRule,
  occurrencesBetween,
  parseRRule,
  taskDaysBetween,
  type RRule,
} from './rrule.ts';
import { isSubjectCode, SCHOOL_SUBJECTS, subjectsForGrade } from './subjects.ts';
import {
  approvalBadge,
  canComplete,
  canDecide,
  completionStatusFor,
  daysToMaterialise,
  isProofContentType,
  materialiseWindow,
  occurrenceStatusFor,
  proofContentTypeOf,
  proofObjectPath,
  proofPathBelongsTo,
  validateCalendarRange,
  validTimeWindow,
} from './tasks.ts';
import {
  CALENDAR_EVENT_TYPES,
  MATERIALISE_DAYS,
  TASK_EVENT_NAMES,
  VERIFICATION_MODES,
} from './types.ts';

const rule = (text: string): RRule => {
  const r = parseRRule(text);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};

// 2026-10-12 is a Monday.
const MON = '2026-10-12';

describe('dates', () => {
  it('validates days and times', () => {
    expect(isValidDay('2026-10-12')).toBe(true);
    expect(isValidDay('2026-02-29')).toBe(false);
    expect(isValidDay('2028-02-29')).toBe(true);
    expect(isValidDay('2026-1-1')).toBe(false);
    expect(isValidTime('07:30')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('7:30')).toBe(false);
    expect(timeToMinutes('07:30')).toBe(450);
    expect(toHHMM('07:30:00')).toBe('07:30');
  });

  it('does day arithmetic across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-10-15')).toBe(14);
    expect(isoWeekday(MON)).toBe(1);
    expect(isoWeekday('2026-10-18')).toBe(7);
    expect(weekStart('2026-10-18')).toBe(MON);
    expect(eachDay(MON, '2026-10-14')).toEqual([MON, '2026-10-13', '2026-10-14']);
  });

  it('uses the household timezone for today', () => {
    // 18:30 UTC on the 12th is already the 13th in Vietnam.
    expect(householdToday(new Date('2026-10-12T18:30:00Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-10-13');
    expect(householdToday(new Date('2026-10-12T18:30:00Z'), 'Not/AZone')).toBe('2026-10-12');
  });

  it('finds the UTC start of a household-local day', () => {
    expect(timeZoneOffsetMinutes(new Date('2026-10-12T00:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe(420);
    expect(zonedDayStart('2026-10-13', 'Asia/Ho_Chi_Minh').toISOString()).toBe(
      '2026-10-12T17:00:00.000Z',
    );
    expect(zonedDayStart('2026-10-13', 'UTC').toISOString()).toBe('2026-10-13T00:00:00.000Z');
    // Europe/Berlin switches to CET on 2026-10-25.
    expect(zonedDayStart('2026-10-25', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-24T22:00:00.000Z',
    );
    expect(zonedDayStart('2026-10-26', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-25T23:00:00.000Z',
    );
  });

  it('round-trips day numbers (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60_000 }), (n) => {
        const day = dayFromNumber(n);
        expect(isValidDay(day)).toBe(true);
        expect(dayNumber(day)).toBe(n);
        expect(isoWeekday(weekStart(day))).toBe(1);
      }),
    );
  });
});

describe('RRULE subset', () => {
  it('parses and formats canonically', () => {
    expect(rule('FREQ=DAILY')).toEqual({ freq: 'DAILY', interval: 1, byDay: [] });
    expect(formatRRule(rule('rrule:freq=weekly;byday=fr,mo,we,mo;interval=2'))).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR',
    );
    expect(formatRRule(rule('FREQ=WEEKLY;UNTIL=20261231'))).toBe('FREQ=WEEKLY;UNTIL=20261231');
    expect(normaliseRRule('FREQ=DAILY;COUNT=10')).toBe('FREQ=DAILY;COUNT=10');
  });

  it('rejects what it does not support', () => {
    for (const bad of [
      '',
      'FREQ=MONTHLY',
      'FREQ=DAILY;INTERVAL=0',
      'FREQ=DAILY;INTERVAL=31',
      'FREQ=DAILY;BYDAY=XX',
      'FREQ=DAILY;COUNT=0',
      'FREQ=DAILY;COUNT=5;UNTIL=20261231',
      'FREQ=DAILY;UNTIL=20260230',
      'FREQ=DAILY;BYHOUR=7',
      'FREQ=DAILY;FREQ=WEEKLY',
      'INTERVAL=2',
      'FREQ',
    ]) {
      expect(parseRRule(bad).ok, bad).toBe(false);
    }
    expect(normaliseRRule('FREQ=YEARLY')).toBeNull();
  });

  it('expands daily, weekly, interval, count and until', () => {
    expect(occurrencesBetween(rule('FREQ=DAILY'), MON, MON, '2026-10-14')).toEqual([
      MON,
      '2026-10-13',
      '2026-10-14',
    ]);
    expect(
      occurrencesBetween(rule('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR'), MON, MON, '2026-10-19'),
    ).toEqual([MON, '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19']);
    expect(occurrencesBetween(rule('FREQ=WEEKLY'), '2026-10-14', MON, '2026-10-31')).toEqual([
      '2026-10-14',
      '2026-10-21',
      '2026-10-28',
    ]);
    expect(
      occurrencesBetween(rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=SA'), MON, MON, '2026-11-08'),
    ).toEqual(['2026-10-17', '2026-10-31']);
    // COUNT is counted from the start, even when the window starts later.
    expect(occurrencesBetween(rule('FREQ=DAILY;COUNT=5'), MON, '2026-10-15', '2026-10-31')).toEqual(
      ['2026-10-15', '2026-10-16'],
    );
    expect(
      occurrencesBetween(rule('FREQ=DAILY;UNTIL=20261013'), MON, '2026-10-01', '2026-10-31'),
    ).toEqual([MON, '2026-10-13']);
    expect(occurrencesBetween(rule('FREQ=DAILY'), MON, '2026-10-01', '2026-10-11')).toEqual([]);
  });

  it('one-off tasks happen once on their start day', () => {
    expect(taskDaysBetween({ startsOn: MON, rrule: null }, MON, MON)).toEqual([MON]);
    expect(taskDaysBetween({ startsOn: MON, rrule: null }, '2026-10-13', '2026-10-20')).toEqual([]);
    expect(taskDaysBetween({ startsOn: MON, rrule: 'nonsense' }, MON, '2026-10-20')).toEqual([]);
  });

  const ruleArb = fc.record({
    freq: fc.constantFrom('DAILY' as const, 'WEEKLY' as const),
    interval: fc.integer({ min: 1, max: 30 }),
    byDay: fc
      .uniqueArray(fc.integer({ min: 1, max: 7 }), { maxLength: 7 })
      .map((a) => a.sort((x, y) => x - y)),
    count: fc.option(fc.integer({ min: 1, max: 366 }), { nil: undefined }),
    untilOffset: fc.option(fc.integer({ min: 0, max: 400 }), { nil: undefined }),
  });

  it('occurrences are sorted, unique, in the window and respect the rule (property)', () => {
    fc.assert(
      fc.property(
        ruleArb,
        fc.integer({ min: 20_000, max: 21_000 }),
        fc.integer({ min: -30, max: 200 }),
        fc.integer({ min: 0, max: 61 }),
        (r, startN, fromOffset, span) => {
          const start = dayFromNumber(startN);
          const rr: RRule = {
            freq: r.freq,
            interval: r.interval,
            byDay: r.byDay,
            ...(r.count !== undefined ? { count: r.count } : {}),
            ...(r.count === undefined && r.untilOffset !== undefined
              ? { until: addDays(start, r.untilOffset) }
              : {}),
          };
          // Canonical text round-trips.
          expect(parseRRule(formatRRule(rr))).toEqual({ ok: true, value: rr });
          const from = addDays(start, fromOffset);
          const to = addDays(from, span);
          const days = occurrencesBetween(rr, start, from, to);
          for (let i = 0; i < days.length; i++) {
            const d = days[i]!;
            expect(d >= from && d <= to && d >= start).toBe(true);
            if (i > 0) expect(d > days[i - 1]!).toBe(true);
            if (rr.until) expect(d <= rr.until).toBe(true);
            const allowed =
              rr.byDay.length > 0 ? rr.byDay : rr.freq === 'WEEKLY' ? [isoWeekday(start)] : [];
            if (allowed.length > 0) expect(allowed).toContain(isoWeekday(d));
          }
          if (rr.count !== undefined) {
            const all = occurrencesBetween(rr, start, start, addDays(start, 366 * 30 * 7 + 7));
            expect(all.length).toBeLessThanOrEqual(rr.count);
            // The window is a slice of the full series.
            expect(days).toEqual(all.filter((d) => d >= from && d <= to));
          }
          // Splitting the window never changes the result (idempotent materialisation).
          const mid = addDays(from, Math.floor(span / 2));
          const split = [
            ...occurrencesBetween(rr, start, from, mid),
            ...(mid < to ? occurrencesBetween(rr, start, addDays(mid, 1), to) : []),
          ];
          expect(split).toEqual(days);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('subjects', () => {
  it('lists the GDPT 2018 subjects per grade', () => {
    expect(isSubjectCode('TOAN')).toBe(true);
    expect(isSubjectCode('MATH')).toBe(false);
    const g2 = subjectsForGrade(2).map((s) => s.code);
    expect(g2).toEqual(expect.arrayContaining(['TOAN', 'TIENG_VIET', 'TNXH', 'DAO_DUC']));
    expect(g2).not.toContain('NGU_VAN');
    const g6 = subjectsForGrade(6).map((s) => s.code);
    expect(g6).toEqual(expect.arrayContaining(['TOAN', 'NGU_VAN', 'KHTN', 'LICH_SU_DIA_LY']));
    expect(g6).not.toContain('TIENG_VIET');
    expect(new Set(SCHOOL_SUBJECTS.map((s) => s.code)).size).toBe(SCHOOL_SUBJECTS.length);
  });
});

describe('task rules', () => {
  it('has the §13.1 event types and the four verification modes', () => {
    expect(CALENDAR_EVENT_TYPES).toHaveLength(11);
    expect(VERIFICATION_MODES).toEqual([
      'SELF_CHECK',
      'PHOTO_PROOF',
      'PARENT_APPROVAL',
      'SYSTEM_VERIFIED',
    ]);
    expect(TASK_EVENT_NAMES['task.approved']).toBe('TaskApproved');
  });

  it('materialises 14 days of recurring tasks and one-off tasks whenever they are', () => {
    expect(materialiseWindow(MON)).toEqual({ from: MON, to: addDays(MON, MATERIALISE_DAYS - 1) });
    expect(daysToMaterialise({ startsOn: '2026-12-01', rrule: null }, MON)).toEqual(['2026-12-01']);
    expect(daysToMaterialise({ startsOn: '2026-10-01', rrule: 'FREQ=DAILY' }, MON)).toHaveLength(
      14,
    );
    expect(daysToMaterialise({ startsOn: '2026-10-20', rrule: 'FREQ=DAILY' }, MON)).toEqual(
      eachDay('2026-10-20', '2026-10-25'),
    );
  });

  it('decides what a completion becomes', () => {
    expect(completionStatusFor('SELF_CHECK')).toBe('APPROVED');
    expect(completionStatusFor('PHOTO_PROOF')).toBe('PENDING_APPROVAL');
    expect(completionStatusFor('PARENT_APPROVAL')).toBe('PENDING_APPROVAL');
    expect(occurrenceStatusFor('APPROVED')).toBe('COMPLETED');
    expect(occurrenceStatusFor('PENDING_APPROVAL')).toBe('PENDING_APPROVAL');
    expect(occurrenceStatusFor('REJECTED')).toBe('REJECTED');
  });

  const base = {
    taskStatus: 'ACTIVE' as const,
    mode: 'PARENT_APPROVAL' as const,
    occurrence: { day: MON, status: 'ASSIGNED' as const },
    today: MON,
    hasProof: false,
  };

  it('lets the child complete today’s or a past occurrence once', () => {
    expect(canComplete(base)).toEqual({ ok: true, value: 'PENDING_APPROVAL' });
    expect(canComplete({ ...base, mode: 'SELF_CHECK' })).toEqual({ ok: true, value: 'APPROVED' });
    expect(canComplete({ ...base, today: '2026-10-20' }).ok).toBe(true);
    expect(canComplete({ ...base, occurrence: { day: MON, status: 'REJECTED' } }).ok).toBe(true);
    const error = (input: Parameters<typeof canComplete>[0]) => {
      const r = canComplete(input);
      return r.ok ? null : r.error;
    };
    expect(error({ ...base, taskStatus: 'ARCHIVED' })).toBe('TASK_ARCHIVED');
    expect(error({ ...base, mode: 'SYSTEM_VERIFIED' })).toBe('SYSTEM_VERIFIED_ONLY');
    expect(error({ ...base, occurrence: null })).toBe('NOT_SCHEDULED');
    expect(error({ ...base, today: '2026-10-11' })).toBe('FUTURE_OCCURRENCE');
    expect(error({ ...base, occurrence: { day: MON, status: 'COMPLETED' } })).toBe(
      'ALREADY_COMPLETED',
    );
    expect(error({ ...base, occurrence: { day: MON, status: 'PENDING_APPROVAL' } })).toBe(
      'PENDING_APPROVAL',
    );
    expect(error({ ...base, mode: 'PHOTO_PROOF' })).toBe('PROOF_REQUIRED');
    expect(canComplete({ ...base, mode: 'PHOTO_PROOF', hasProof: true }).ok).toBe(true);
  });

  it('approves or rejects only pending completions', () => {
    expect(canDecide('PENDING_APPROVAL', 'PENDING_APPROVAL').ok).toBe(true);
    expect(canDecide('COMPLETED', 'APPROVED').ok).toBe(false);
    expect(canDecide('REJECTED', 'REJECTED').ok).toBe(false);
    expect(canDecide('ASSIGNED', null).ok).toBe(false);
  });

  it('validates calendar ranges and time windows', () => {
    expect(validateCalendarRange(MON, '2026-10-18')).toEqual({
      ok: true,
      value: { from: MON, to: '2026-10-18', days: 7 },
    });
    expect(validateCalendarRange('2026-10-18', MON).ok).toBe(false);
    expect(validateCalendarRange(MON, addDays(MON, 62))).toEqual({
      ok: false,
      error: 'RANGE_TOO_LONG',
    });
    expect(validateCalendarRange('x', MON).ok).toBe(false);
    expect(validTimeWindow(null, null)).toBe(true);
    expect(validTimeWindow('07:00', '07:45')).toBe(true);
    expect(validTimeWindow('08:00', '07:45')).toBe(false);
    expect(validTimeWindow('08:00', null)).toBe(false);
  });

  it('builds and checks proof paths', () => {
    const ids = {
      householdId: '11111111-1111-4111-8111-111111111111',
      studentId: '22222222-2222-4222-8222-222222222222',
      taskId: '33333333-3333-4333-8333-333333333333',
    };
    const path = proofObjectPath(
      { ...ids, fileId: '44444444-4444-4444-8444-444444444444' },
      'image/jpeg',
    );
    expect(path).toBe(
      `${ids.householdId}/${ids.studentId}/${ids.taskId}/44444444-4444-4444-8444-444444444444.jpg`,
    );
    expect(proofPathBelongsTo(path, ids)).toBe(true);
    expect(proofPathBelongsTo(path, { ...ids, studentId: ids.taskId })).toBe(false);
    expect(proofPathBelongsTo(`../${path}`, ids)).toBe(false);
    expect(proofPathBelongsTo(path.replace('.jpg', '.exe'), ids)).toBe(false);
    expect(proofContentTypeOf(path)).toBe('image/jpeg');
    expect(proofContentTypeOf('a.gif')).toBeNull();
    expect(isProofContentType('image/png')).toBe(true);
    expect(isProofContentType('image/gif')).toBe(false);
  });

  it('shows a badge count', () => {
    expect(approvalBadge(0)).toBeNull();
    expect(approvalBadge(3)).toBe('3');
    expect(approvalBadge(120)).toBe('99+');
  });
});

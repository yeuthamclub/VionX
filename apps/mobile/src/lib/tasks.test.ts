import type { CalendarResponse, TaskOccurrence } from '@vionx/contracts/client';
import { describe, expect, it } from 'vitest';
import { AppError, describeError } from './api-error.ts';
import {
  agendaByDay,
  badgeText,
  childTaskState,
  dayLabel,
  describeRepeat,
  localDayOf,
  localTimeOf,
  repeatToRRule,
  rruleToRepeat,
  subjectName,
  timeWindowError,
  weekOf,
} from './tasks.ts';

const occurrence = (over: Partial<TaskOccurrence> = {}): TaskOccurrence => ({
  id: 'o1',
  taskId: 't1',
  studentId: 's1',
  date: '2026-10-13',
  status: 'ASSIGNED',
  type: 'HOMEWORK',
  title: 'Bài tập',
  description: null,
  subjectCode: null,
  windowStart: null,
  windowEnd: null,
  durationMinutes: null,
  priority: 'NORMAL',
  required: true,
  rewardXp: 10,
  verificationMode: 'PARENT_APPROVAL',
  recurring: true,
  completion: null,
  ...over,
});

describe('calendar helpers', () => {
  it('builds the Monday-Sunday week', () => {
    expect(weekOf('2026-10-15')).toEqual({
      from: '2026-10-12',
      to: '2026-10-18',
      days: [
        '2026-10-12',
        '2026-10-13',
        '2026-10-14',
        '2026-10-15',
        '2026-10-16',
        '2026-10-17',
        '2026-10-18',
      ],
    });
    expect(dayLabel('2026-10-12')).toBe('Thứ 2, 12/10');
    expect(subjectName('KHTN')).toBe('Khoa học tự nhiên');
    expect(subjectName('XYZ')).toBe('XYZ');
  });

  it('places events on the household-local day', () => {
    expect(localDayOf('2026-10-20T17:30:00Z', 'Asia/Ho_Chi_Minh')).toBe('2026-10-21');
    expect(localTimeOf('2026-10-20T17:30:00Z', 'Asia/Ho_Chi_Minh')).toBe('00:30');
    const cal: CalendarResponse = {
      studentId: 's1',
      timezone: 'Asia/Ho_Chi_Minh',
      today: '2026-10-13',
      from: '2026-10-20',
      to: '2026-10-21',
      timetable: [],
      events: [
        {
          id: 'e1',
          studentId: 's1',
          type: 'EXAM',
          title: 'Kiểm tra',
          note: null,
          location: null,
          subjectCode: 'TOAN',
          startsAt: '2026-10-20T17:30:00Z',
          endsAt: '2026-10-20T18:00:00Z',
          allDay: false,
        },
      ],
      tasks: [occurrence({ date: '2026-10-20' })],
    };
    const days = agendaByDay(cal);
    expect(days.map((d) => [d.date, d.events.length, d.tasks.length])).toEqual([
      ['2026-10-20', 0, 1],
      ['2026-10-21', 1, 0],
    ]);
  });

  it('maps repeat choices to rules and back', () => {
    expect(repeatToRRule('ONCE')).toBeNull();
    expect(repeatToRRule('DAILY')).toBe('FREQ=DAILY');
    expect(repeatToRRule('SCHOOL_DAYS')).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(repeatToRRule('WEEKLY', [6, 2, 6])).toBe('FREQ=WEEKLY;BYDAY=TU,SA');
    expect(rruleToRepeat('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toEqual({
      preset: 'SCHOOL_DAYS',
      weekdays: [1, 2, 3, 4, 5],
    });
    expect(rruleToRepeat('FREQ=DAILY')).toEqual({ preset: 'DAILY', weekdays: [] });
    expect(rruleToRepeat(null).preset).toBe('ONCE');
    expect(describeRepeat('FREQ=WEEKLY;BYDAY=TU,SA')).toBe('Hằng tuần: Thứ 3, Thứ 7');
    expect(describeRepeat('FREQ=DAILY')).toBe('Hằng ngày');
  });

  it('decides what the child can do with a task', () => {
    expect(childTaskState(occurrence(), '2026-10-13')).toMatchObject({
      canComplete: true,
      needsPhoto: false,
    });
    expect(childTaskState(occurrence({ date: '2026-10-14' }), '2026-10-13').canComplete).toBe(
      false,
    );
    expect(
      childTaskState(occurrence({ status: 'PENDING_APPROVAL' }), '2026-10-13').canComplete,
    ).toBe(false);
    expect(
      childTaskState(occurrence({ verificationMode: 'SYSTEM_VERIFIED' }), '2026-10-13').canComplete,
    ).toBe(false);
    const rejected = childTaskState(
      occurrence({
        status: 'REJECTED',
        verificationMode: 'PHOTO_PROOF',
        completion: {
          id: 'c1',
          clientUuid: 'u',
          status: 'REJECTED',
          completedAt: '2026-10-13T10:00:00Z',
          decidedAt: '2026-10-13T11:00:00Z',
          decidedByType: 'parent',
          decisionNote: 'Dọn lại nhé',
          hasProof: true,
        },
      }),
      '2026-10-13',
    );
    expect(rejected).toMatchObject({
      canComplete: true,
      needsPhoto: true,
      rejectedNote: 'Dọn lại nhé',
    });
  });

  it('validates the time window and shows the badge', () => {
    expect(timeWindowError('', '')).toBeNull();
    expect(timeWindowError('19:00', '20:00')).toBeNull();
    expect(timeWindowError('20:00', '19:00')).toBe('taskForm.windowInvalid');
    expect(timeWindowError('19:00', '')).toBe('taskForm.windowInvalid');
    expect(badgeText(0)).toBeNull();
    expect(badgeText(4)).toBe('4');
  });

  it('describes task rule errors', () => {
    const err = new AppError('api', 409, {
      code: 'CONFLICT',
      message: 'x',
      details: { reason: 'FUTURE_OCCURRENCE' },
      requestId: 'r',
    });
    expect(describeError(err)).toBe('Chưa đến ngày làm nhiệm vụ này.');
  });
});

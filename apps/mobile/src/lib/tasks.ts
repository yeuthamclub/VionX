// Pure helpers for the calendar and task screens (no React, tested with Vitest).
import type {
  CalendarEvent,
  CalendarResponse,
  TaskOccurrence,
  TimetableSlot,
  VerificationMode,
} from '@vionx/contracts/client';
import {
  addDays,
  approvalBadge,
  eachDay,
  formatRRule,
  isoWeekday,
  parseRRule,
  SCHOOL_SUBJECTS,
  timeZoneOffsetMinutes,
  weekStart,
} from '@vionx/domain';
import { getLocale, t, type MessageKey } from '../i18n/index.ts';

/** The seven days (Mon..Sun) of the week containing `day`. */
export function weekOf(day: string): { from: string; to: string; days: string[] } {
  const from = weekStart(day);
  const to = addDays(from, 6);
  return { from, to, days: eachDay(from, to) };
}

export interface DayAgenda {
  date: string;
  timetable: TimetableSlot[];
  events: CalendarEvent[];
  tasks: TaskOccurrence[];
}

/** Household-local day of an instant (events are stored in UTC). */
export function localDayOf(instant: string, timeZone: string): string {
  const d = new Date(instant);
  return new Date(d.getTime() + timeZoneOffsetMinutes(d, timeZone) * 60_000)
    .toISOString()
    .slice(0, 10);
}

/** Local `HH:MM` of an instant. */
export function localTimeOf(instant: string, timeZone: string): string {
  const d = new Date(instant);
  return new Date(d.getTime() + timeZoneOffsetMinutes(d, timeZone) * 60_000)
    .toISOString()
    .slice(11, 16);
}

/** Groups a calendar response by day (every day of the range, possibly empty). */
export function agendaByDay(cal: CalendarResponse): DayAgenda[] {
  return eachDay(cal.from, cal.to).map((date) => ({
    date,
    timetable: cal.timetable.filter((s) => s.date === date),
    events: cal.events.filter((e) => localDayOf(e.startsAt, cal.timezone) === date),
    tasks: cal.tasks.filter((o) => o.date === date),
  }));
}

/** Repeat choices on the task form. */
export type RepeatPreset = 'ONCE' | 'DAILY' | 'SCHOOL_DAYS' | 'WEEKLY';

export function repeatToRRule(preset: RepeatPreset, weekdays: number[] = []): string | null {
  switch (preset) {
    case 'ONCE':
      return null;
    case 'DAILY':
      return 'FREQ=DAILY';
    case 'SCHOOL_DAYS':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'WEEKLY':
      return formatRRule({
        freq: 'WEEKLY',
        interval: 1,
        byDay: [...new Set(weekdays)].sort((a, b) => a - b),
      });
  }
}

/** Reads a stored rule back into the form (rules the form cannot express become WEEKLY/ONCE). */
export function rruleToRepeat(rrule: string | null): { preset: RepeatPreset; weekdays: number[] } {
  if (!rrule) return { preset: 'ONCE', weekdays: [] };
  const parsed = parseRRule(rrule);
  if (!parsed.ok) return { preset: 'ONCE', weekdays: [] };
  const r = parsed.value;
  if (r.freq === 'DAILY' && r.interval === 1 && r.byDay.length === 0) {
    return { preset: 'DAILY', weekdays: [] };
  }
  if (r.byDay.join(',') === '1,2,3,4,5' && r.interval === 1) {
    return { preset: 'SCHOOL_DAYS', weekdays: [1, 2, 3, 4, 5] };
  }
  return { preset: 'WEEKLY', weekdays: r.byDay };
}

const WEEKDAY_KEYS: MessageKey[] = [
  'weekday.1',
  'weekday.2',
  'weekday.3',
  'weekday.4',
  'weekday.5',
  'weekday.6',
  'weekday.7',
];

export const weekdayLabel = (weekday: number): string => t(WEEKDAY_KEYS[weekday - 1]!);

/** "Thứ 2, 13/10" */
export function dayLabel(day: string): string {
  return `${weekdayLabel(isoWeekday(day))}, ${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** Human repeat text for a stored rule. */
export function describeRepeat(rrule: string | null): string {
  const { preset, weekdays } = rruleToRepeat(rrule);
  if (preset !== 'WEEKLY') return t(`repeat.${preset}` as MessageKey);
  return t('repeat.weeklyOn', { days: weekdays.map(weekdayLabel).join(', ') });
}

/** What the child sees on a task card and whether they can press "done". */
export function childTaskState(o: TaskOccurrence, today: string) {
  const canComplete =
    (o.status === 'ASSIGNED' || o.status === 'REJECTED') &&
    o.date <= today &&
    o.verificationMode !== 'SYSTEM_VERIFIED';
  return {
    canComplete,
    needsPhoto: o.verificationMode === 'PHOTO_PROOF',
    labelKey: `taskStatus.${o.status}` as MessageKey,
    rejectedNote: o.status === 'REJECTED' ? (o.completion?.decisionNote ?? null) : null,
  };
}

export const verificationLabel = (mode: VerificationMode): string =>
  t(`verification.${mode}` as MessageKey);

/** Badge text on the parent home approvals button. */
export const badgeText = approvalBadge;

/** Validates the task form's optional time window. */
export function timeWindowError(start: string, end: string): MessageKey | null {
  const re = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (start === '' && end === '') return null;
  if (!re.test(start) || !re.test(end) || start >= end) return 'taskForm.windowInvalid';
  return null;
}

/** Subject name in the app's language (codes from GET /v1/subjects, mirrored in @vionx/domain). */
export function subjectName(code: string): string {
  const subject = SCHOOL_SUBJECTS.find((s) => s.code === code);
  if (!subject) return code;
  return getLocale() === 'en' ? subject.nameEn : subject.nameVi;
}

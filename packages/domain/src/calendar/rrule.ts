// Repeat rules: a small subset of RFC 5545 RRULE, enough for family schedules ("every day",
// "Mon/Wed/Fri", "every other Saturday", "10 times", "until the end of term").
//   FREQ=DAILY|WEEKLY   required
//   INTERVAL=1..30      default 1
//   BYDAY=MO,TU,…       optional; DAILY: only these weekdays; WEEKLY: default = start weekday
//   COUNT=1..366        optional; occurrences counted from the start day
//   UNTIL=YYYYMMDD      optional; last possible day (inclusive). Not together with COUNT.
import { err, ok, type Result } from '../shared/result.ts';
import { dayFromNumber, dayNumber, isValidDay } from './dates.ts';

export const RRULE_WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type RRuleWeekday = (typeof RRULE_WEEKDAYS)[number];

export const RRULE_FREQUENCIES = ['DAILY', 'WEEKLY'] as const;
export type RRuleFrequency = (typeof RRULE_FREQUENCIES)[number];

export const RRULE_MAX_INTERVAL = 30;
export const RRULE_MAX_COUNT = 366;

export interface RRule {
  freq: RRuleFrequency;
  interval: number;
  /** ISO weekdays 1..7, sorted, unique; empty = not restricted (DAILY) / start weekday (WEEKLY). */
  byDay: number[];
  count?: number;
  /** Inclusive last day, `YYYY-MM-DD`. */
  until?: string;
}

export type RRuleError = 'INVALID_RRULE';

const weekdayNumber = (code: string) => RRULE_WEEKDAYS.indexOf(code as RRuleWeekday) + 1;

function intIn(value: string, min: number, max: number): number | null {
  if (!/^\d{1,4}$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

export function parseRRule(input: string): Result<RRule, RRuleError> {
  const fail = (message: string) => err('INVALID_RRULE' as const, message);
  const text = input.trim().replace(/^RRULE:/i, '');
  if (text.length === 0 || text.length > 200) return fail('Empty or too long');
  const parts = new Map<string, string>();
  for (const part of text.split(';')) {
    const [key, value, ...rest] = part.split('=');
    if (!key || value === undefined || rest.length > 0) return fail(`Bad part "${part}"`);
    const k = key.toUpperCase();
    if (parts.has(k)) return fail(`Duplicate ${k}`);
    parts.set(k, value.toUpperCase());
  }
  for (const k of parts.keys()) {
    if (!['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL'].includes(k)) {
      return fail(`Unsupported ${k}`);
    }
  }
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return fail('FREQ must be DAILY or WEEKLY');
  const rule: RRule = { freq, interval: 1, byDay: [] };
  const interval = parts.get('INTERVAL');
  if (interval !== undefined) {
    const n = intIn(interval, 1, RRULE_MAX_INTERVAL);
    if (n === null) return fail(`INTERVAL must be 1..${RRULE_MAX_INTERVAL}`);
    rule.interval = n;
  }
  const byDay = parts.get('BYDAY');
  if (byDay !== undefined) {
    const days = byDay.split(',').map(weekdayNumber);
    if (days.some((d) => d < 1)) return fail('BYDAY must list MO..SU');
    rule.byDay = [...new Set(days)].sort((a, b) => a - b);
  }
  const count = parts.get('COUNT');
  const until = parts.get('UNTIL');
  if (count !== undefined && until !== undefined) return fail('COUNT and UNTIL are exclusive');
  if (count !== undefined) {
    const n = intIn(count, 1, RRULE_MAX_COUNT);
    if (n === null) return fail(`COUNT must be 1..${RRULE_MAX_COUNT}`);
    rule.count = n;
  }
  if (until !== undefined) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(until);
    const day = m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    if (!isValidDay(day)) return fail('UNTIL must be YYYYMMDD');
    rule.until = day;
  }
  return ok(rule);
}

/** Canonical text (stored in app.task_assignments.rrule). */
export function formatRRule(rule: RRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay.length > 0) {
    parts.push(`BYDAY=${rule.byDay.map((d) => RRULE_WEEKDAYS[d - 1]).join(',')}`);
  }
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== undefined) parts.push(`UNTIL=${rule.until.replaceAll('-', '')}`);
  return parts.join(';');
}

/** Normalises a client rule (`RRULE:` prefix, case, order); null when invalid. */
export function normaliseRRule(input: string): string | null {
  const parsed = parseRRule(input);
  return parsed.ok ? formatRRule(parsed.value) : null;
}

// Day numbers (days since 1970-01-01): 1970-01-01 was a Thursday (ISO weekday 4).
const weekdayOf = (n: number) => ((((n + 3) % 7) + 7) % 7) + 1;
const mondayOf = (n: number) => n - (weekdayOf(n) - 1);

function matcher(rule: RRule, startN: number): (n: number) => boolean {
  if (rule.freq === 'DAILY') {
    return (n) =>
      (n - startN) % rule.interval === 0 &&
      (rule.byDay.length === 0 || rule.byDay.includes(weekdayOf(n)));
  }
  const days = rule.byDay.length > 0 ? rule.byDay : [weekdayOf(startN)];
  const startMonday = mondayOf(startN);
  return (n) =>
    ((mondayOf(n) - startMonday) / 7) % rule.interval === 0 && days.includes(weekdayOf(n));
}

/**
 * Days of the series that fall in [from, to] (inclusive, `YYYY-MM-DD`), in order. The series starts
 * on `start` (never before it), stops after UNTIL or after COUNT occurrences counted from `start`.
 */
export function occurrencesBetween(rule: RRule, start: string, from: string, to: string): string[] {
  const last = rule.until !== undefined && rule.until < to ? rule.until : to;
  if (last < start || last < from) return [];
  const startN = dayNumber(start);
  const fromN = dayNumber(from);
  const lastN = dayNumber(last);
  const matches = matcher(rule, startN);
  const out: string[] = [];
  // With COUNT the series must be walked from its start; otherwise jump to the window.
  let seen = 0;
  for (let n = rule.count === undefined ? Math.max(startN, fromN) : startN; n <= lastN; n++) {
    if (!matches(n)) continue;
    seen += 1;
    if (n >= fromN) out.push(dayFromNumber(n));
    if (rule.count !== undefined && seen >= rule.count) break;
  }
  return out;
}

/** Days a task happens in [from, to]: its repeat rule, or once on its start day. */
export function taskDaysBetween(
  task: { startsOn: string; rrule: string | null },
  from: string,
  to: string,
): string[] {
  if (!task.rrule) return task.startsOn >= from && task.startsOn <= to ? [task.startsOn] : [];
  const parsed = parseRRule(task.rrule);
  return parsed.ok ? occurrencesBetween(parsed.value, task.startsOn, from, to) : [];
}

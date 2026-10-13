// Household-local calendar days as `YYYY-MM-DD` strings and wall-clock times as `HH:MM`.
// Day arithmetic runs on UTC midnights, so it never depends on the runtime's timezone.
import { localDay } from '../time/local-day.ts';

const DAY_MS = 24 * 3600_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True for a real calendar date `YYYY-MM-DD` (rejects 2026-02-30). */
export function isValidDay(value: string): boolean {
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** Days since 1970-01-01 (for arithmetic). */
export function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

export function dayFromNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return dayFromNumber(dayNumber(day) + days);
}

/** `b - a` in days. */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  const w = new Date(`${day}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  return addDays(day, 1 - isoWeekday(day));
}

/** Every day from `from` to `to`, both included. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let n = dayNumber(from); n <= dayNumber(to); n++) out.push(dayFromNumber(n));
  return out;
}

/** Today in the household's timezone (falls back to UTC for an unknown zone). */
export function householdToday(now: Date, timeZone: string): string {
  const r = localDay(now, timeZone);
  return r.ok ? r.value : now.toISOString().slice(0, 10);
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** `HH:MM` → minutes after midnight. */
export function timeToMinutes(value: string): number {
  const m = TIME_RE.exec(value);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Postgres `time` values come back as `HH:MM:SS`; the API speaks `HH:MM`. */
export function toHHMM(value: string): string {
  return value.slice(0, 5);
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** Offset of `timeZone` from UTC at `instant`, in minutes (Asia/Ho_Chi_Minh → 420). */
export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  let f = offsetFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFormatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The UTC instant at which household-local `day` starts (00:00 in `timeZone`). */
export function zonedDayStart(day: string, timeZone: string): Date {
  const guess = Date.parse(`${day}T00:00:00Z`);
  let instant = guess - timeZoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  // Second pass for days where the offset changes around midnight (DST zones).
  instant = guess - timeZoneOffsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant);
}

import { err, ok, type Result } from '../shared/result.ts';

/** Default household timezone (CONTRACT §3). */
export const DEFAULT_HOUSEHOLD_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** A calendar day in a household's timezone, formatted `YYYY-MM-DD`. */
export type LocalDay = string & { readonly __brand: 'LocalDay' };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** True when `timeZone` is an IANA zone the runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The household-local calendar day of a UTC instant. Data is stored in UTC; reward "local day"
 * boundaries use the household timezone (CONTRACT §3).
 */
export function localDay(
  instant: Date,
  timeZone: string = DEFAULT_HOUSEHOLD_TIMEZONE,
): Result<LocalDay, 'INVALID_TIMEZONE' | 'INVALID_INSTANT'> {
  if (Number.isNaN(instant.getTime())) return err('INVALID_INSTANT');
  if (!isValidTimeZone(timeZone)) return err('INVALID_TIMEZONE', `Unknown timezone ${timeZone}`);
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return ok(`${get('year')}-${get('month')}-${get('day')}` as LocalDay);
}

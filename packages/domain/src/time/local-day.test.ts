import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_HOUSEHOLD_TIMEZONE, isValidTimeZone, localDay } from './local-day.ts';

describe('localDay', () => {
  it('uses Asia/Ho_Chi_Minh (UTC+7) by default', () => {
    // 2026-10-07 17:30 UTC is already 2026-10-08 00:30 in Vietnam.
    expect(localDay(new Date('2026-10-07T17:30:00Z'))).toEqual({ ok: true, value: '2026-10-08' });
    expect(localDay(new Date('2026-10-07T16:59:59Z'))).toEqual({ ok: true, value: '2026-10-07' });
  });

  it('respects an explicit household timezone', () => {
    expect(localDay(new Date('2026-10-07T17:30:00Z'), 'UTC')).toEqual({
      ok: true,
      value: '2026-10-07',
    });
  });

  it('rejects unknown timezones and invalid dates', () => {
    expect(localDay(new Date(), 'Mars/Olympus')).toMatchObject({
      ok: false,
      error: 'INVALID_TIMEZONE',
    });
    expect(localDay(new Date('nope'))).toEqual({ ok: false, error: 'INVALID_INSTANT' });
  });

  it('knows the default timezone', () => {
    expect(isValidTimeZone(DEFAULT_HOUSEHOLD_TIMEZONE)).toBe(true);
  });

  it('property: Vietnam local day equals the UTC day of instant + 7h (no DST)', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2000-01-01Z'),
          max: new Date('2100-01-01Z'),
          noInvalidDate: true,
        }),
        (instant) => {
          const shifted = new Date(instant.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
          const result = localDay(instant);
          return result.ok && result.value === shifted;
        },
      ),
    );
  });
});

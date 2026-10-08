import { DEFAULT_HOUSEHOLD_TIMEZONE, localDay } from '../time/local-day.ts';
import type { ChildAssentStatus, ConsentType } from './types.ts';

/** From this age the child must also agree (CONTRACT §5). */
export const CHILD_ASSENT_MIN_AGE = 7;

/** Consent types that need the child's own assent at age ≥ 7. */
export const ASSENT_CONSENT_TYPES: readonly ConsentType[] = [
  'AI_PERSONALIZATION',
  'MICROPHONE_SPEAKING',
  'HEALTH_CONNECT_ACTIVITY',
];

/**
 * Age used for the assent rule. Only the birth year is stored, so this is the oldest the child can
 * be this year (household-local year − birth year): near the boundary we ask for assent rather
 * than skip it.
 */
export function assentAge(
  birthYear: number,
  now: Date,
  timeZone: string = DEFAULT_HOUSEHOLD_TIMEZONE,
): number {
  const day = localDay(now, timeZone);
  const year = day.ok ? Number(day.value.slice(0, 4)) : now.getUTCFullYear();
  return year - birthYear;
}

export function childAssentRequired(
  type: ConsentType,
  birthYear: number,
  now: Date,
  timeZone?: string,
): boolean {
  return (
    ASSENT_CONSENT_TYPES.includes(type) &&
    assentAge(birthYear, now, timeZone) >= CHILD_ASSENT_MIN_AGE
  );
}

/** Assent status of a fresh grant. */
export function initialAssentStatus(required: boolean): ChildAssentStatus {
  return required ? 'PENDING' : 'NOT_REQUIRED';
}

import { err, ok, type Result } from '../shared/result.ts';
import { DEFAULT_HOUSEHOLD_TIMEZONE, isValidTimeZone } from '../time/local-day.ts';

export const HOUSEHOLD_ROLES = ['OWNER', 'GUARDIAN'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];
export const HOUSEHOLD_NAME_MAX = 80;

export interface HouseholdInput {
  name: string;
  timezone?: string;
}

export function validateHousehold(
  input: HouseholdInput,
): Result<{ name: string; timezone: string }, 'HOUSEHOLD_NAME' | 'INVALID_TIMEZONE'> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > HOUSEHOLD_NAME_MAX) {
    return err('HOUSEHOLD_NAME', `Name must be 1-${HOUSEHOLD_NAME_MAX} characters`);
  }
  const timezone = input.timezone ?? DEFAULT_HOUSEHOLD_TIMEZONE;
  if (!isValidTimeZone(timezone)) return err('INVALID_TIMEZONE', `Unknown timezone ${timezone}`);
  return ok({ name, timezone });
}

/** Who may manage children (create, reset PIN, revoke, disable). GUARDIAN invites arrive later. */
export function canManageChildren(role: HouseholdRole): boolean {
  return role === 'OWNER' || role === 'GUARDIAN';
}

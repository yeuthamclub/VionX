import { err, ok, type Result } from '../shared/result.ts';

export const MIN_GRADE = 1;
export const MAX_GRADE = 12;
export const DISPLAY_NAME_MAX = 40;

/** Preset avatars (no photo uploads for children in v1). */
export const AVATARS = ['owl', 'fox', 'cat', 'dog', 'panda', 'rabbit', 'tiger', 'turtle'] as const;
export type Avatar = (typeof AVATARS)[number];
export const DEFAULT_AVATAR: Avatar = 'owl';

export type StudentError = 'DISPLAY_NAME' | 'GRADE' | 'BIRTH_YEAR' | 'AVATAR';

export interface StudentProfileInput {
  displayName?: string;
  grade?: number;
  birthYear?: number;
  avatar?: string;
}

/** Normalises a display name: trims and collapses inner whitespace. */
export function normalizeDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * Birth year must fit a Grade 1-12 student: age 4..20 in the current year. Grade and age need
 * not match exactly (repeated or skipped years happen), but the age bounds catch typos.
 */
export function validateBirthYear(birthYear: number, now: Date): boolean {
  const year = now.getUTCFullYear();
  return Number.isInteger(birthYear) && birthYear >= year - 20 && birthYear <= year - 4;
}

/** Validates the fields present in `input` (all optional, for PATCH). */
export function validateStudentProfile(
  input: StudentProfileInput,
  now: Date,
): Result<StudentProfileInput, StudentError> {
  const out: StudentProfileInput = {};
  if (input.displayName !== undefined) {
    const name = normalizeDisplayName(input.displayName);
    if (name.length < 1 || name.length > DISPLAY_NAME_MAX) {
      return err('DISPLAY_NAME', `Name must be 1-${DISPLAY_NAME_MAX} characters`);
    }
    out.displayName = name;
  }
  if (input.grade !== undefined) {
    if (!Number.isInteger(input.grade) || input.grade < MIN_GRADE || input.grade > MAX_GRADE) {
      return err('GRADE', `Grade must be ${MIN_GRADE}-${MAX_GRADE}`);
    }
    out.grade = input.grade;
  }
  if (input.birthYear !== undefined) {
    if (!validateBirthYear(input.birthYear, now)) {
      return err('BIRTH_YEAR', 'Birth year must give an age between 4 and 20');
    }
    out.birthYear = input.birthYear;
  }
  if (input.avatar !== undefined) {
    if (!(AVATARS as readonly string[]).includes(input.avatar)) {
      return err('AVATAR', `Avatar must be one of ${AVATARS.join(', ')}`);
    }
    out.avatar = input.avatar;
  }
  return ok(out);
}

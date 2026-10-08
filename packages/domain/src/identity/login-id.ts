import { randomString, type RandomBytes } from './random.ts';

/**
 * Child login id: `vx-` plus 6 characters from an alphabet without look-alikes
 * (no 0/o, 1/i/l). 31^6 ≈ 887 million ids. Ids are case-insensitive; stored lower case.
 */
export const LOGIN_ID_PREFIX = 'vx-';
export const LOGIN_ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
export const LOGIN_ID_BODY_LENGTH = 6;
export const LOGIN_ID_PATTERN = /^vx-[23456789abcdefghjkmnpqrstuvwxyz]{6}$/;

export function generateLoginId(random: RandomBytes): string {
  return LOGIN_ID_PREFIX + randomString(LOGIN_ID_ALPHABET, LOGIN_ID_BODY_LENGTH, random);
}

/**
 * Normalises what a child types: trims, lower-cases, removes spaces, and accepts the id with or
 * without the `vx-` prefix (`VX DEMY22`, `demy22`). Returns null when it cannot be a login id.
 */
export function normalizeLoginId(input: string): string | null {
  let s = input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '');
  if (s.startsWith('vx-')) s = s.slice(3);
  else if (s.startsWith('vx') && s.length === 2 + LOGIN_ID_BODY_LENGTH) s = s.slice(2);
  const candidate = LOGIN_ID_PREFIX + s;
  return LOGIN_ID_PATTERN.test(candidate) ? candidate : null;
}

export function isValidLoginId(value: string): boolean {
  return LOGIN_ID_PATTERN.test(value);
}

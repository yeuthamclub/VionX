import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  afterFailedAttempt,
  attemptsRemaining,
  clearedLock,
  isLocked,
  LOCK_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  type LockState,
} from './lockout.ts';
import {
  generateLoginId,
  isValidLoginId,
  LOGIN_ID_ALPHABET,
  normalizeLoginId,
} from './login-id.ts';
import { generatePin, isTrivialPin, validatePin } from './pin.ts';
import { randomString } from './random.ts';
import { hasPermission, isAdminPermission } from './permissions.ts';
import {
  CHILD_LOGIN_RATE_LIMITS,
  isOverLimit,
  rateLimitBucket,
  retryAfterSeconds,
  windowStart,
} from './rate-limit.ts';
import {
  CHILD_SESSION_TTL_MS,
  isSessionActive,
  sessionExpiry,
  shouldTouchSession,
} from './session.ts';
import { validateBirthYear, validateStudentProfile } from './student.ts';
import { canManageChildren, validateHousehold } from './household.ts';

// Web Crypto (Node 22 global); the domain package has no DOM/Node type libs.
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };
const secureRandom = (n: number) => crypto.getRandomValues(new Uint8Array(n));
/** Deterministic random source from a byte array (cycled). */
const fixedRandom = (bytes: number[]) => {
  let i = 0;
  return (n: number) => Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length]!);
};

describe('login id', () => {
  it('is vx- plus 6 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const id = generateLoginId(secureRandom);
      expect(id).toMatch(/^vx-[23456789abcdefghjkmnpqrstuvwxyz]{6}$/);
      expect(isValidLoginId(id)).toBe(true);
    }
  });

  it('alphabet has no look-alike characters', () => {
    for (const c of '01ilo') expect(LOGIN_ID_ALPHABET).not.toContain(c);
    expect(new Set(LOGIN_ID_ALPHABET).size).toBe(LOGIN_ID_ALPHABET.length);
  });

  it('property: any random source yields a valid id', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 1, maxLength: 64 }),
        (b) =>
          // a source of only rejected bytes (≥248) would loop forever; include at least one usable byte
          isValidLoginId(generateLoginId(fixedRandom([...b, 7]))),
      ),
    );
  });

  it('normalises what a child types', () => {
    expect(normalizeLoginId('  VX-DEMY22 ')).toBe('vx-demy22');
    expect(normalizeLoginId('demy22')).toBe('vx-demy22');
    expect(normalizeLoginId('vxdemy22')).toBe('vx-demy22');
    expect(normalizeLoginId('vx demy 22')).toBe('vx-demy22');
    expect(normalizeLoginId('vx-demo22')).toBeNull(); // "o" is not in the alphabet
    expect(normalizeLoginId('vx-abc')).toBeNull();
    expect(normalizeLoginId('')).toBeNull();
  });
});

describe('randomString', () => {
  it('rejects bytes that would bias the distribution', () => {
    // 31 chars: bytes >= 248 are rejected; 248 → skipped, 0 → '2', 30 → 'z'
    expect(randomString(LOGIN_ID_ALPHABET, 2, fixedRandom([248, 255, 0, 30]))).toBe('2z');
  });
  it('rejects silly alphabets', () => {
    expect(() => randomString('a', 3, secureRandom)).toThrow(RangeError);
  });
});

describe('PIN', () => {
  it('accepts 4-8 digits only', () => {
    for (const pin of ['1234', '00000000', '582913']) expect(validatePin(pin).ok).toBe(true);
    for (const pin of ['123', '123456789', '12a4', ' 1234', '']) {
      expect(validatePin(pin)).toMatchObject({ ok: false, error: 'PIN_FORMAT' });
    }
  });

  it('detects trivial PINs', () => {
    for (const pin of ['1111', '1234', '9876', '456789', '00000000']) {
      expect(isTrivialPin(pin)).toBe(true);
    }
    for (const pin of ['1235', '2468', '1212', '9078']) expect(isTrivialPin(pin)).toBe(false);
  });

  it('property: generated PINs are valid and never trivial', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 8 }), (length) => {
        const pin = generatePin(secureRandom, length);
        return pin.length === length && validatePin(pin).ok && !isTrivialPin(pin);
      }),
    );
  });

  it('defaults to 6 digits and rejects bad lengths', () => {
    expect(generatePin(secureRandom)).toMatch(/^\d{6}$/);
    expect(() => generatePin(secureRandom, 3)).toThrow(RangeError);
  });
});

describe('lockout', () => {
  const now = new Date('2026-10-08T10:00:00Z');

  it('locks for 15 minutes on the 5th wrong PIN', () => {
    let s: LockState = clearedLock();
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      s = afterFailedAttempt(s, now);
      expect(isLocked(s, now)).toBe(false);
      expect(attemptsRemaining(s)).toBe(MAX_FAILED_ATTEMPTS - i);
    }
    s = afterFailedAttempt(s, now);
    expect(isLocked(s, now)).toBe(true);
    expect(s.lockedUntil!.getTime() - now.getTime()).toBe(LOCK_DURATION_MS);
    expect(isLocked(s, new Date(now.getTime() + LOCK_DURATION_MS - 1))).toBe(true);
    expect(isLocked(s, new Date(now.getTime() + LOCK_DURATION_MS))).toBe(false);
  });

  it('gives fresh attempts after the lock expires', () => {
    const expired: LockState = { failedAttempts: 3, lockedUntil: new Date(now.getTime() - 1) };
    expect(afterFailedAttempt(expired, now)).toEqual({ failedAttempts: 1, lockedUntil: null });
  });

  it('property: n consecutive failures lock iff n >= 5 (counted from a clean state)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), (n) => {
        let s = clearedLock();
        let everLocked = false;
        for (let i = 0; i < n; i++) {
          if (isLocked(s, now)) break; // the API rejects attempts while locked
          s = afterFailedAttempt(s, now);
          everLocked ||= isLocked(s, now);
        }
        return everLocked === n >= MAX_FAILED_ATTEMPTS;
      }),
    );
  });
});

describe('child session', () => {
  const now = new Date('2026-10-08T10:00:00Z');

  it('expires 30 days after the last use', () => {
    expect(sessionExpiry(now).getTime() - now.getTime()).toBe(CHILD_SESSION_TTL_MS);
    expect(CHILD_SESSION_TTL_MS).toBe(30 * 24 * 3600 * 1000);
  });

  it('is active until expiry or revocation', () => {
    const s = { expiresAt: sessionExpiry(now), revokedAt: null, lastSeenAt: now };
    expect(isSessionActive(s, now)).toBe(true);
    expect(isSessionActive(s, sessionExpiry(now))).toBe(false);
    expect(isSessionActive({ ...s, revokedAt: now }, now)).toBe(false);
  });

  it('touches the sliding expiry at most hourly', () => {
    const s = { expiresAt: sessionExpiry(now), revokedAt: null, lastSeenAt: now };
    expect(shouldTouchSession(s, new Date(now.getTime() + 59 * 60_000))).toBe(false);
    expect(shouldTouchSession(s, new Date(now.getTime() + 60 * 60_000))).toBe(true);
  });
});

describe('student profile', () => {
  const now = new Date('2026-10-08T10:00:00Z');

  it('validates and normalises fields', () => {
    expect(
      validateStudentProfile(
        { displayName: '  Bé   An ', grade: 2, birthYear: 2019, avatar: 'fox' },
        now,
      ),
    ).toEqual({
      ok: true,
      value: { displayName: 'Bé An', grade: 2, birthYear: 2019, avatar: 'fox' },
    });
  });

  it('rejects out-of-range values', () => {
    expect(validateStudentProfile({ displayName: '   ' }, now)).toMatchObject({
      error: 'DISPLAY_NAME',
    });
    expect(validateStudentProfile({ displayName: 'x'.repeat(41) }, now)).toMatchObject({
      error: 'DISPLAY_NAME',
    });
    expect(validateStudentProfile({ grade: 0 }, now)).toMatchObject({ error: 'GRADE' });
    expect(validateStudentProfile({ grade: 13 }, now)).toMatchObject({ error: 'GRADE' });
    expect(validateStudentProfile({ grade: 2.5 }, now)).toMatchObject({ error: 'GRADE' });
    expect(validateStudentProfile({ avatar: 'dragon' }, now)).toMatchObject({ error: 'AVATAR' });
    expect(validateStudentProfile({ birthYear: 2025 }, now)).toMatchObject({
      error: 'BIRTH_YEAR',
    });
  });

  it('birth year gives an age of 4..20', () => {
    expect(validateBirthYear(2022, now)).toBe(true);
    expect(validateBirthYear(2006, now)).toBe(true);
    expect(validateBirthYear(2023, now)).toBe(false);
    expect(validateBirthYear(2005, now)).toBe(false);
  });

  it('allows empty patches', () => {
    expect(validateStudentProfile({}, now)).toEqual({ ok: true, value: {} });
  });
});

describe('household', () => {
  it('defaults to Asia/Ho_Chi_Minh and validates the timezone', () => {
    expect(validateHousehold({ name: ' Nhà  Minh ' })).toEqual({
      ok: true,
      value: { name: 'Nhà Minh', timezone: 'Asia/Ho_Chi_Minh' },
    });
    expect(validateHousehold({ name: 'A', timezone: 'Mars/Base' })).toMatchObject({
      error: 'INVALID_TIMEZONE',
    });
    expect(validateHousehold({ name: '' })).toMatchObject({ error: 'HOUSEHOLD_NAME' });
  });

  it('owners and guardians manage children', () => {
    expect(canManageChildren('OWNER')).toBe(true);
    expect(canManageChildren('GUARDIAN')).toBe(true);
  });
});

describe('admin permissions', () => {
  it('checks by name; SUPER_ADMIN implies all', () => {
    expect(hasPermission(['CONTENT_REVIEWER'], 'CONTENT_REVIEWER')).toBe(true);
    expect(hasPermission(['CONTENT_REVIEWER'], 'LIBRARIAN')).toBe(false);
    expect(hasPermission(['SUPER_ADMIN'], 'ANALYST')).toBe(true);
    expect(hasPermission([], 'SUPPORT')).toBe(false);
    expect(isAdminPermission('SUPPORT')).toBe(true);
    expect(isAdminPermission('ROOT')).toBe(false);
  });
});

describe('child login rate limits', () => {
  const now = new Date('2026-10-08T10:07:30Z');

  it('uses fixed windows', () => {
    expect(windowStart(now, 900).toISOString()).toBe('2026-10-08T10:00:00.000Z');
    expect(retryAfterSeconds(now, { limit: 1, windowSeconds: 900 })).toBe(450);
  });

  it('allows up to the limit, then blocks', () => {
    const rule = CHILD_LOGIN_RATE_LIMITS.perLoginId;
    expect(isOverLimit(rule.limit, rule)).toBe(false);
    expect(isOverLimit(rule.limit + 1, rule)).toBe(true);
  });

  it('keeps the per-login limit above the PIN lock threshold', () => {
    expect(CHILD_LOGIN_RATE_LIMITS.perLoginId.limit).toBeGreaterThan(MAX_FAILED_ATTEMPTS);
    expect(rateLimitBucket('device', 'abc')).toBe('child_login:device:abc');
  });
});

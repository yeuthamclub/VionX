/** Child session token: 32 random bytes, stored as sha-256, 30-day sliding expiry, revocable. */
export const CHILD_TOKEN_BYTES = 32;
export const CHILD_SESSION_TTL_MS = 30 * 24 * 3600_000;
/** Sliding expiry is refreshed at most once per hour to avoid a write on every request. */
export const CHILD_SESSION_TOUCH_INTERVAL_MS = 3600_000;

export function sessionExpiry(now: Date): Date {
  return new Date(now.getTime() + CHILD_SESSION_TTL_MS);
}

export interface SessionState {
  expiresAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date;
}

export function isSessionActive(s: SessionState, now: Date): boolean {
  return s.revokedAt === null && s.expiresAt.getTime() > now.getTime();
}

/** True when the sliding expiry should be pushed forward on this request. */
export function shouldTouchSession(s: SessionState, now: Date): boolean {
  return now.getTime() - s.lastSeenAt.getTime() >= CHILD_SESSION_TOUCH_INTERVAL_MS;
}

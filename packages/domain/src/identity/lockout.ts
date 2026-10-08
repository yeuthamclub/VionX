/** 5 wrong PINs lock the child login for 15 minutes (TASK_PACKS/M01). */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60_000;

export interface LockState {
  failedAttempts: number;
  lockedUntil: Date | null;
}

export function isLocked(state: LockState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/**
 * State after a wrong PIN (callers reject attempts while locked without calling this). The 5th
 * consecutive failure sets `lockedUntil` and resets the counter, so the child gets 5 fresh
 * attempts after the lock expires.
 */
export function afterFailedAttempt(state: LockState, now: Date): LockState {
  // A lock that has expired starts a fresh count.
  const expired = state.lockedUntil !== null && !isLocked(state, now);
  const attempts = (expired ? 0 : state.failedAttempts) + 1;
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    return { failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCK_DURATION_MS) };
  }
  return { failedAttempts: attempts, lockedUntil: null };
}

/** A correct PIN (or a parent PIN reset) clears the counter and any lock. */
export const clearedLock = (): LockState => ({ failedAttempts: 0, lockedUntil: null });

/** Attempts left before the lock, for the child-facing message. */
export function attemptsRemaining(state: LockState): number {
  return Math.max(0, MAX_FAILED_ATTEMPTS - state.failedAttempts);
}

/** Fixed-window rate limits on child login (ops.rate_limits), in addition to the PIN lock. */
export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export const CHILD_LOGIN_RATE_LIMITS = {
  /** One phone or tablet: covers several children sharing a device. */
  perDevice: { limit: 30, windowSeconds: 15 * 60 },
  /** One login id across all devices. Above 5 (lock) so the lock message is reachable. */
  perLoginId: { limit: 12, windowSeconds: 15 * 60 },
} as const satisfies Record<string, RateLimitRule>;

export const rateLimitBucket = (kind: string, key: string): string => `child_login:${kind}:${key}`;

/** Start of the fixed window containing `now`. */
export function windowStart(now: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

export function isOverLimit(hits: number, rule: RateLimitRule): boolean {
  return hits > rule.limit;
}

/** Seconds until the window resets (for `Retry-After`). */
export function retryAfterSeconds(now: Date, rule: RateLimitRule): number {
  const end = windowStart(now, rule.windowSeconds).getTime() + rule.windowSeconds * 1000;
  return Math.max(1, Math.ceil((end - now.getTime()) / 1000));
}

import type { RateLimitRule } from '../identity/rate-limit.ts';

/** A data export download link (and the file) lives for 24 hours (TASK_PACKS/M02). */
export const EXPORT_LINK_TTL_MS = 24 * 3600_000;

/** Deletion: disabled at once, hard-deleted after 30 days (TASK_PACKS/M02). */
export const DELETION_GRACE_DAYS = 30;
export const DELETION_GRACE_MS = DELETION_GRACE_DAYS * 24 * 3600_000;

/** At most 3 export requests per household per day. */
export const EXPORT_RATE_LIMIT = {
  limit: 3,
  windowSeconds: 24 * 3600,
} as const satisfies RateLimitRule;

export const exportRateLimitBucket = (householdId: string): string =>
  `privacy_export:${householdId}`;

export function exportExpiresAt(completedAt: Date): Date {
  return new Date(completedAt.getTime() + EXPORT_LINK_TTL_MS);
}

/**
 * Lifetime of a freshly signed download URL: whatever remains of the 24 hours (null once expired),
 * so a link never outlives the export.
 */
export function remainingLinkSeconds(expiresAt: Date, now: Date): number | null {
  const seconds = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  return seconds >= 60 ? seconds : null;
}

export function purgeAfter(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + DELETION_GRACE_MS);
}

export const EXPORT_JOB_STATUSES = ['QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED'] as const;
export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number];

export const DELETION_JOB_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'FAILED'] as const;
export type DeletionJobStatus = (typeof DELETION_JOB_STATUSES)[number];

export const PRIVACY_REQUEST_TYPES = ['EXPORT', 'DELETE_CHILD', 'DELETE_ACCOUNT'] as const;
export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];

export const PRIVACY_REQUEST_STATUSES = [
  'RECEIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const;
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

/** Storage object path of an export: one folder per household. */
export function exportObjectPath(householdId: string, jobId: string): string {
  return `${householdId}/${jobId}.zip`;
}

import type { RateLimitRule } from '../identity/rate-limit.ts';

/** A data export download link (and the file) lives for 24 hours (TASK_PACKS/M02). */
export const EXPORT_LINK_TTL_MS = 24 * 3600_000;

/**
 * Deletion grace period: disabled at once, cancellable by the parent, hard-deleted once this many
 * days have passed (the daily pg_cron purge runs at the latest one day later). 14 days so deletion
 * completes within the 20 days required by Decree 356/2025 Art. 5(4). The single source for the
 * api, the app, the admin deletion page and the tests.
 */
export const DELETION_GRACE_DAYS = 14;
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

// --- Cancelling a deletion during the grace period (product owner decision 2026-10-08) -----------

export interface PendingDeletion {
  status: DeletionJobStatus;
  purgeAfter: Date;
}

export type CancelDeletionError = 'NOT_PENDING' | 'GRACE_PERIOD_OVER';

/**
 * A deletion can be cancelled while it is SCHEDULED and the grace period has not run out. Once the
 * purge has run (COMPLETED), was cancelled already, or the purge is due, it cannot.
 */
export function canCancelDeletion(
  job: PendingDeletion | null,
  now: Date,
): { ok: true } | { ok: false; error: CancelDeletionError } {
  if (!job || job.status !== 'SCHEDULED') return { ok: false, error: 'NOT_PENDING' };
  if (now.getTime() >= job.purgeAfter.getTime()) return { ok: false, error: 'GRACE_PERIOD_OVER' };
  return { ok: true };
}

/** Whole days left before the purge, rounded up (the Privacy Center's "N days left"); 0 when due. */
export function deletionDaysLeft(purgeAfterAt: Date, now: Date): number {
  const ms = purgeAfterAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / (24 * 3600_000));
}

/**
 * Children whose login an account-deletion cancel turns back on: every child of the household
 * except those the parent had disabled before the request and those with their own pending child
 * deletion.
 */
export function studentsToReenable(
  studentIds: readonly string[],
  disabledBeforeRequest: readonly string[],
  pendingChildDeletions: readonly string[],
): string[] {
  const keep = new Set([...disabledBeforeRequest, ...pendingChildDeletions]);
  return studentIds.filter((id) => !keep.has(id));
}

// --- Retention of audit logs and domain events after a purge (decision 2026-10-08) ---------------

/** Audit logs and domain events about purged data are deleted this many days after the purge. */
export const PURGED_LOG_RETENTION_DAYS = 365;

export function purgedLogDeleteAfter(purgedAt: Date): Date {
  return new Date(purgedAt.getTime() + PURGED_LOG_RETENTION_DAYS * 24 * 3600_000);
}

/**
 * Keys treated as personal data in audit/event json, normalised (lower case, letters and digits
 * only). Mirrored by ops.strip_personal_fields in supabase/migrations (kept in sync by a test).
 */
export const PERSONAL_DATA_KEYS = [
  'name',
  'displayname',
  'fullname',
  'firstname',
  'lastname',
  'nickname',
  'householdname',
  'phone',
  'phonenumber',
  'email',
  'emailaddress',
  'address',
  'birthyear',
  'birthdate',
  'dateofbirth',
  'childloginid',
  'loginid',
  'deviceid',
  'ip',
  'ipaddress',
  'useragent',
] as const;

const PERSONAL = new Set<string>(PERSONAL_DATA_KEYS);

export const isPersonalDataKey = (key: string): boolean =>
  PERSONAL.has(key.replace(/[^A-Za-z0-9]/g, '').toLowerCase());

/** Drops personal keys at any depth; ids, counters and other fields stay. */
export function stripPersonalFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPersonalFields);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !isPersonalDataKey(key))
        .map(([key, v]) => [key, stripPersonalFields(v)]),
    );
  }
  return value;
}

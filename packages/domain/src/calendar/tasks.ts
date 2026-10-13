// Task lifecycle rules (TASK_PACKS/M03 "Rules"). The api applies them inside one transaction.
import type { RateLimitRule } from '../identity/rate-limit.ts';
import { err, ok, type Result } from '../shared/result.ts';
import { addDays, daysBetween, isValidDay, timeToMinutes } from './dates.ts';
import { taskDaysBetween } from './rrule.ts';
import {
  MATERIALISE_DAYS,
  MAX_CALENDAR_RANGE_DAYS,
  PROOF_CONTENT_TYPES,
  type CompletionStatus,
  type OccurrenceStatus,
  type ProofContentType,
  type VerificationMode,
} from './types.ts';

/** First and last household-local day the materialiser fills, starting today. */
export function materialiseWindow(today: string): { from: string; to: string } {
  return { from: today, to: addDays(today, MATERIALISE_DAYS - 1) };
}

/**
 * Days to insert into app.task_occurrences for a task (insert … on conflict do nothing makes this
 * idempotent). One-off tasks get their only day whatever the window (so a task set for next month
 * shows up at once); recurring tasks get the days inside the 14-day window, never before the start.
 */
export function daysToMaterialise(
  task: { startsOn: string; rrule: string | null },
  today: string,
): string[] {
  if (!task.rrule) return [task.startsOn];
  const { from, to } = materialiseWindow(today);
  return taskDaysBetween(task, from, to);
}

export type CompletionError =
  | 'TASK_ARCHIVED'
  | 'SYSTEM_VERIFIED_ONLY'
  | 'NOT_SCHEDULED'
  | 'FUTURE_OCCURRENCE'
  | 'ALREADY_COMPLETED'
  | 'PENDING_APPROVAL'
  | 'PROOF_REQUIRED';

/** What a completion becomes: SELF_CHECK is approved at once, the others wait for the parent. */
export function completionStatusFor(mode: VerificationMode): CompletionStatus {
  return mode === 'SELF_CHECK' ? 'APPROVED' : 'PENDING_APPROVAL';
}

export function occurrenceStatusFor(completion: CompletionStatus): OccurrenceStatus {
  switch (completion) {
    case 'APPROVED':
      return 'COMPLETED';
    case 'PENDING_APPROVAL':
      return 'PENDING_APPROVAL';
    case 'REJECTED':
      return 'REJECTED';
  }
}

/**
 * May the child complete this occurrence now? (A replay of an already stored clientUuid is
 * answered before this check and never reaches it.)
 */
export function canComplete(input: {
  taskStatus: 'ACTIVE' | 'ARCHIVED';
  mode: VerificationMode;
  occurrence: { day: string; status: OccurrenceStatus } | null;
  today: string;
  hasProof: boolean;
}): Result<CompletionStatus, CompletionError> {
  if (input.taskStatus === 'ARCHIVED') return err('TASK_ARCHIVED');
  if (input.mode === 'SYSTEM_VERIFIED') return err('SYSTEM_VERIFIED_ONLY');
  if (!input.occurrence) return err('NOT_SCHEDULED');
  if (input.occurrence.day > input.today) return err('FUTURE_OCCURRENCE');
  if (input.occurrence.status === 'COMPLETED') return err('ALREADY_COMPLETED');
  if (input.occurrence.status === 'PENDING_APPROVAL') return err('PENDING_APPROVAL');
  if (input.mode === 'PHOTO_PROOF' && !input.hasProof) return err('PROOF_REQUIRED');
  return ok(completionStatusFor(input.mode));
}

export type DecisionError = 'NOT_PENDING';

/** Approve or reject: only a completion waiting for the parent. */
export function canDecide(
  occurrenceStatus: OccurrenceStatus,
  completionStatus: CompletionStatus | null,
): Result<true, DecisionError> {
  return occurrenceStatus === 'PENDING_APPROVAL' && completionStatus === 'PENDING_APPROVAL'
    ? ok(true)
    : err('NOT_PENDING');
}

export type CalendarRangeError = 'INVALID_RANGE' | 'RANGE_TOO_LONG';

export function validateCalendarRange(
  from: string,
  to: string,
): Result<{ from: string; to: string; days: number }, CalendarRangeError> {
  if (!isValidDay(from) || !isValidDay(to) || to < from) return err('INVALID_RANGE');
  const days = daysBetween(from, to) + 1;
  if (days > MAX_CALENDAR_RANGE_DAYS) return err('RANGE_TOO_LONG');
  return ok({ from, to, days });
}

/** A time window `HH:MM`-`HH:MM`: both or neither, start before end. */
export function validTimeWindow(start: string | null, end: string | null): boolean {
  if (start === null && end === null) return true;
  if (start === null || end === null) return false;
  const a = timeToMinutes(start);
  const b = timeToMinutes(end);
  return Number.isFinite(a) && Number.isFinite(b) && a < b;
}

export function isProofContentType(value: string): value is ProofContentType {
  return (PROOF_CONTENT_TYPES as readonly string[]).includes(value);
}

const EXTENSIONS: Record<ProofContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Storage path of a proof photo: one folder per household and child, then per task. */
export function proofObjectPath(
  ids: { householdId: string; studentId: string; taskId: string; fileId: string },
  contentType: ProofContentType,
): string {
  return `${ids.householdId}/${ids.studentId}/${ids.taskId}/${ids.fileId}.${EXTENSIONS[contentType]}`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PROOF_PATH_RE = new RegExp(`^(${UUID})/(${UUID})/(${UUID})/(${UUID})\\.(jpg|png|webp)$`);

/** A client-supplied proof path must be one we signed for this child and task. */
export function proofPathBelongsTo(
  path: string,
  ids: { householdId: string; studentId: string; taskId: string },
): boolean {
  const m = PROOF_PATH_RE.exec(path);
  return Boolean(m && m[1] === ids.householdId && m[2] === ids.studentId && m[3] === ids.taskId);
}

export function proofContentTypeOf(path: string): ProofContentType | null {
  const ext = path.slice(path.lastIndexOf('.') + 1);
  const entry = Object.entries(EXTENSIONS).find(([, e]) => e === ext);
  return entry ? (entry[0] as ProofContentType) : null;
}

/** Count shown on the parent's approvals badge. */
export function approvalBadge(pending: number): string | null {
  if (pending <= 0) return null;
  return pending > 99 ? '99+' : String(pending);
}

/** Signed proof uploads per child: 60 an hour is far above real use and stops runaway loops. */
export const PROOF_UPLOAD_RATE_LIMIT = {
  limit: 60,
  windowSeconds: 3600,
} as const satisfies RateLimitRule;

export const proofUploadRateLimitBucket = (studentId: string): string =>
  `proof_upload:${studentId}`;

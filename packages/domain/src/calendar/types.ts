// M03 calendar & task enums (Master Spec §13). Mirrored by check constraints in
// supabase/migrations/0007_calendar_tasks.sql.

/** Calendar event types (Master Spec §13.1). */
export const CALENDAR_EVENT_TYPES = [
  'SCHOOL_CLASS',
  'TUTORING',
  'EXAM',
  'LEARNING_BLOCK',
  'ENGLISH',
  'READING',
  'SPORT',
  'HOUSEHOLD_TASK',
  'CREATIVE',
  'FAMILY_EVENT',
  'CUSTOM',
] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

/** Task types (Master Spec §13.2 "type"). */
export const TASK_TYPES = [
  'HOMEWORK',
  'LEARNING',
  'READING',
  'ENGLISH',
  'SPORT',
  'HOUSEHOLD',
  'CREATIVE',
  'CUSTOM',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * Verification modes (TASK_PACKS/M03):
 * - SELF_CHECK: done as soon as the child says so;
 * - PHOTO_PROOF: the child attaches a photo, then the parent approves;
 * - PARENT_APPROVAL: the parent approves;
 * - SYSTEM_VERIFIED: completed by the system (practice sessions, M06/M07), never by hand.
 */
export const VERIFICATION_MODES = [
  'SELF_CHECK',
  'PHOTO_PROOF',
  'PARENT_APPROVAL',
  'SYSTEM_VERIFIED',
] as const;
export type VerificationMode = (typeof VERIFICATION_MODES)[number];

/** A task as a whole: active or archived by the parent. */
export const TASK_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** One task on one household-local day. */
export const OCCURRENCE_STATUSES = [
  'ASSIGNED',
  'PENDING_APPROVAL',
  'COMPLETED',
  'REJECTED',
] as const;
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

export const COMPLETION_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'] as const;
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];

export const PROOF_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ProofContentType = (typeof PROOF_CONTENT_TYPES)[number];

/** Recurring tasks are materialised this many household-local days ahead (today included). */
export const MATERIALISE_DAYS = 14;

/** Longest calendar range one request may ask for. */
export const MAX_CALENDAR_RANGE_DAYS = 62;

/** Proof photos: 10 MB, same as the bucket limit. */
export const MAX_PROOF_BYTES = 10 * 1024 * 1024;

/** A signed upload URL is valid for this long. */
export const PROOF_UPLOAD_URL_TTL_SECONDS = 2 * 3600;

/** Signed links to view a proof photo (approvals inbox). */
export const PROOF_VIEW_URL_TTL_SECONDS = 15 * 60;

/** Uploaded proof files never attached to a completion are removed after this long. */
export const ORPHAN_PROOF_MAX_AGE_HOURS = 24;

export const TASK_EVENT_TYPES = {
  assigned: 'task.assigned',
  completed: 'task.completed',
  approved: 'task.approved',
  rejected: 'task.rejected',
  materialiseRequested: 'task.materialise_requested',
} as const;

/** Master Spec §25 names of the task events (carried as `eventName` in the outbox payload). */
export const TASK_EVENT_NAMES = {
  'task.assigned': 'TaskAssigned',
  'task.completed': 'TaskCompleted',
  'task.approved': 'TaskApproved',
  'task.rejected': 'TaskRejected',
} as const;

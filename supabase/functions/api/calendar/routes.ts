import { createRoute, type OpenAPIHono, type z } from '@hono/zod-openapi';
import {
  addDays,
  canComplete,
  canDecide,
  eachDay,
  householdToday,
  isoWeekday,
  isOverLimit,
  MAX_PROOF_BYTES,
  normaliseRRule,
  occurrenceStatusFor,
  PROOF_UPLOAD_RATE_LIMIT,
  PROOF_UPLOAD_URL_TTL_SECONDS,
  PROOF_VIEW_URL_TTL_SECONDS,
  proofContentTypeOf,
  proofObjectPath,
  proofPathBelongsTo,
  proofUploadRateLimitBucket,
  retryAfterSeconds,
  TASK_EVENT_NAMES,
  TASK_EVENT_TYPES,
  toHHMM,
  validateCalendarRange,
  validTimeWindow,
  zonedDayStart,
  type CompletionError,
} from '@vionx/domain';
import { requireActor, type Actor } from '../../_shared/actor.ts';
import type { TxSql } from '../../_shared/db.ts';
import { ApiError } from '../../_shared/errors.ts';
import { OutboxPushNotifier } from '../../_shared/notify.ts';
import { scoped, scopeFor, type Scope } from '../../_shared/scope.ts';
import { TASK_PROOF_BUCKET } from '../../_shared/storage.ts';
import { materialiseTask } from '../../_shared/tasks.ts';
import type { AppEnv } from '../app.ts';
import type { ApiDeps } from '../deps.ts';
import { rateLimitHit, writeAudit, writeEvent } from '../identity/repo.ts';
import { body, CHILD, errorResponses, iso, json, PARENT } from '../route-helpers.ts';
import * as repo from './repo.ts';
import {
  ApprovalsResponseSchema,
  CalendarEventCreateSchema,
  CalendarEventResponseSchema,
  CalendarEventUpdateSchema,
  CalendarQuerySchema,
  CalendarResponseSchema,
  EntryIdParamSchema,
  EventIdParamSchema,
  StudentIdParamSchema,
  SubjectsResponseSchema,
  TaskCompleteRequestSchema,
  TaskCompleteResponseSchema,
  TaskCreateSchema,
  TaskDecisionRequestSchema,
  TaskDecisionResponseSchema,
  TaskIdParamSchema,
  TaskResponseSchema,
  TaskTemplatesResponseSchema,
  TaskUpdateSchema,
  TimetableEntryCreateSchema,
  TimetableEntryResponseSchema,
  TimetableEntryUpdateSchema,
  TimetableResponseSchema,
  UploadSignRequestSchema,
  UploadSignResponseSchema,
  type CalendarEvent,
  type Task,
  type TaskOccurrence,
  type TimetableEntry,
} from './schemas.ts';

const PARENT_OR_CHILD = [...PARENT, ...CHILD];
const notifier = new OutboxPushNotifier();

// --- Route definitions ----------------------------------------------------------------------------

const subjectsRoute = createRoute({
  method: 'get',
  path: '/v1/subjects',
  tags: ['calendar'],
  summary: 'School subjects (GDPT 2018)',
  description: 'Public reference list with the grades each subject is taught in.',
  security: [{}],
  responses: { 200: json(SubjectsResponseSchema, 'Subjects') },
});

const templatesRoute = createRoute({
  method: 'get',
  path: '/v1/task-templates',
  tags: ['calendar'],
  summary: 'Task templates for the task form',
  description: 'Built-in starter templates and the household’s own (saved with `saveAsTemplate`).',
  security: PARENT,
  responses: {
    200: json(TaskTemplatesResponseSchema, 'Templates'),
    ...errorResponses('UNAUTHENTICATED', 'FORBIDDEN'),
  },
});

const calendarRoute = createRoute({
  method: 'get',
  path: '/v1/students/{id}/calendar',
  tags: ['calendar'],
  summary: 'A child’s calendar between two days',
  description:
    'Household-local days `from`..`to` (at most 62). School periods expanded from the weekly timetable, calendar events, and task days with their latest completion. Recurring tasks are materialised 14 days ahead. Parent: any child of the household; child: only their own id (today’s tasks). Other ids answer 404.',
  security: PARENT_OR_CHILD,
  request: { params: StudentIdParamSchema, query: CalendarQuerySchema },
  responses: {
    200: json(CalendarResponseSchema, 'Calendar'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const timetableRoute = createRoute({
  method: 'get',
  path: '/v1/students/{id}/timetable',
  tags: ['calendar'],
  summary: 'A child’s weekly school timetable',
  security: PARENT_OR_CHILD,
  request: { params: StudentIdParamSchema },
  responses: {
    200: json(TimetableResponseSchema, 'Timetable'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const timetableCreateRoute = createRoute({
  method: 'post',
  path: '/v1/students/{id}/timetable',
  tags: ['calendar'],
  summary: 'Add a school period',
  security: PARENT,
  request: { params: StudentIdParamSchema, ...body(TimetableEntryCreateSchema) },
  responses: {
    201: json(TimetableEntryResponseSchema, 'Created'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const timetableUpdateRoute = createRoute({
  method: 'patch',
  path: '/v1/timetable/{entryId}',
  tags: ['calendar'],
  summary: 'Change a school period',
  security: PARENT,
  request: { params: EntryIdParamSchema, ...body(TimetableEntryUpdateSchema) },
  responses: {
    200: json(TimetableEntryResponseSchema, 'Updated'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const timetableDeleteRoute = createRoute({
  method: 'delete',
  path: '/v1/timetable/{entryId}',
  tags: ['calendar'],
  summary: 'Remove a school period',
  security: PARENT,
  request: { params: EntryIdParamSchema },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const eventCreateRoute = createRoute({
  method: 'post',
  path: '/v1/students/{id}/events',
  tags: ['calendar'],
  summary: 'Add a calendar event (Master Spec §13.1 types)',
  security: PARENT,
  request: { params: StudentIdParamSchema, ...body(CalendarEventCreateSchema) },
  responses: {
    201: json(CalendarEventResponseSchema, 'Created'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const eventUpdateRoute = createRoute({
  method: 'patch',
  path: '/v1/events/{eventId}',
  tags: ['calendar'],
  summary: 'Change a calendar event',
  security: PARENT,
  request: { params: EventIdParamSchema, ...body(CalendarEventUpdateSchema) },
  responses: {
    200: json(CalendarEventResponseSchema, 'Updated'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const eventDeleteRoute = createRoute({
  method: 'delete',
  path: '/v1/events/{eventId}',
  tags: ['calendar'],
  summary: 'Remove a calendar event',
  security: PARENT,
  request: { params: EventIdParamSchema },
  responses: {
    204: { description: 'Deleted' },
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const taskCreateRoute = createRoute({
  method: 'post',
  path: '/v1/students/{id}/tasks',
  tags: ['tasks'],
  summary: 'Assign a task to a child',
  description:
    'Master Spec §13.2 fields. `rrule` repeats it (RRULE subset); without it the task happens once on `startsOn`. Days are materialised at once (recurring: the next 14 days, then daily). Emits `task.assigned` (TaskAssigned). Audited.',
  security: PARENT,
  request: { params: StudentIdParamSchema, ...body(TaskCreateSchema) },
  responses: {
    201: json(TaskResponseSchema, 'Created'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const taskGetRoute = createRoute({
  method: 'get',
  path: '/v1/tasks/{id}',
  tags: ['tasks'],
  summary: 'One task (edit form)',
  description: 'Parent: tasks of the household; child: tasks assigned to them. Others answer 404.',
  security: PARENT_OR_CHILD,
  request: { params: TaskIdParamSchema },
  responses: {
    200: json(TaskResponseSchema, 'Task'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const taskUpdateRoute = createRoute({
  method: 'patch',
  path: '/v1/tasks/{id}',
  tags: ['tasks'],
  summary: 'Edit or archive a task (parent only)',
  description:
    'Children can never edit tasks (403). When the schedule changes or the task is archived, open days from today on are removed and the new schedule is materialised; days with a completion stay. Audited.',
  security: PARENT,
  request: { params: TaskIdParamSchema, ...body(TaskUpdateSchema) },
  responses: {
    200: json(TaskResponseSchema, 'Updated'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const completeRoute = createRoute({
  method: 'post',
  path: '/v1/tasks/{id}/complete',
  tags: ['tasks'],
  summary: 'The child completes a task day',
  description:
    'Child actor, own tasks only. Idempotent by `clientUuid`: a retry returns the stored result with `replayed: true` and emits nothing (409 if the UUID was used for another task). SELF_CHECK is done at once (also emits `task.approved`); PHOTO_PROOF (needs `proofPath`) and PARENT_APPROVAL wait for the parent (push request to the parents); SYSTEM_VERIFIED cannot be completed by hand (409). Only days up to today. Emits `task.completed` (TaskCompleted).',
  security: CHILD,
  request: { params: TaskIdParamSchema, ...body(TaskCompleteRequestSchema) },
  responses: {
    200: json(TaskCompleteResponseSchema, 'Completed (or replayed)'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'),
  },
});

const approveRoute = createRoute({
  method: 'post',
  path: '/v1/tasks/{id}/approve',
  tags: ['tasks'],
  summary: 'Approve a completed task day',
  description:
    'Parent only. The day’s pending completion becomes APPROVED; 409 when nothing is pending (e.g. already decided). Emits `task.approved` (TaskApproved) once per completion. Audited.',
  security: PARENT,
  request: { params: TaskIdParamSchema, ...body(TaskDecisionRequestSchema) },
  responses: {
    200: json(TaskDecisionResponseSchema, 'Approved'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'),
  },
});

const rejectRoute = createRoute({
  method: 'post',
  path: '/v1/tasks/{id}/reject',
  tags: ['tasks'],
  summary: 'Reject a completed task day',
  description:
    'Parent only, with an optional note for the child. The day becomes REJECTED and the child may complete it again (with a new `clientUuid`). Emits `task.rejected` (TaskRejected). Audited.',
  security: PARENT,
  request: { params: TaskIdParamSchema, ...body(TaskDecisionRequestSchema) },
  responses: {
    200: json(TaskDecisionResponseSchema, 'Rejected'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'),
  },
});

const approvalsRoute = createRoute({
  method: 'get',
  path: '/v1/approvals',
  tags: ['tasks'],
  summary: 'Approvals inbox',
  description:
    'Task days waiting for the parent, oldest first (up to 100), with a 15-minute link to the proof photo. `count` drives the badge.',
  security: PARENT,
  responses: {
    200: json(ApprovalsResponseSchema, 'Pending approvals'),
    ...errorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'SERVICE_UNAVAILABLE'),
  },
});

const uploadSignRoute = createRoute({
  method: 'post',
  path: '/v1/uploads/sign',
  tags: ['tasks'],
  summary: 'Signed upload URL for a task proof photo',
  description:
    'Child actor, own active tasks only. PUT the image to `uploadUrl` (valid 2 hours, max 10 MB, JPEG/PNG/WebP) into the private bucket, then send `path` as `proofPath` when completing. Files never attached are removed after a day. 60 per hour per child.',
  security: CHILD,
  request: body(UploadSignRequestSchema),
  responses: {
    200: json(UploadSignResponseSchema, 'Signed'),
    ...errorResponses(
      'VALIDATION_FAILED',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'RATE_LIMITED',
      'SERVICE_UNAVAILABLE',
    ),
  },
});

// --- Mapping ---------------------------------------------------------------------------------------

const hhmm = (v: string | null) => (v === null ? null : toHHMM(v));

function toEntry(row: repo.TimetableRow): TimetableEntry {
  return {
    id: row.id,
    studentId: row.student_id,
    weekday: row.weekday,
    startTime: toHHMM(row.start_time),
    endTime: toHHMM(row.end_time),
    subjectCode: row.subject_code,
    room: row.room,
    note: row.note,
    validFrom: row.valid_from,
    validTo: row.valid_to,
  };
}

function toEvent(row: repo.EventRow): CalendarEvent {
  return {
    id: row.id,
    studentId: row.student_id,
    type: row.type,
    title: row.title,
    note: row.note,
    location: row.location,
    subjectCode: row.subject_code,
    startsAt: iso(row.starts_at)!,
    endsAt: iso(row.ends_at)!,
    allDay: row.all_day,
  };
}

function toTask(row: repo.TaskRow): Task {
  return {
    id: row.id,
    studentId: row.assigned_student_id,
    templateId: row.template_id,
    type: row.type,
    title: row.title,
    description: row.description,
    subjectCode: row.subject_code,
    startsOn: row.starts_on,
    windowStart: hhmm(row.window_start),
    windowEnd: hhmm(row.window_end),
    durationMinutes: row.duration_minutes,
    rrule: row.rrule,
    priority: row.priority,
    required: row.required,
    rewardXp: row.reward_xp,
    verificationMode: row.verification_mode,
    status: row.status,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function toOccurrence(row: repo.OccurrenceRow): TaskOccurrence {
  return {
    id: row.id,
    taskId: row.assignment_id,
    studentId: row.student_id,
    date: row.occurs_on,
    status: row.status,
    type: row.type,
    title: row.title,
    description: row.description,
    subjectCode: row.subject_code,
    windowStart: hhmm(row.window_start),
    windowEnd: hhmm(row.window_end),
    durationMinutes: row.duration_minutes,
    priority: row.priority,
    required: row.required,
    rewardXp: row.reward_xp,
    verificationMode: row.verification_mode,
    recurring: row.rrule !== null,
    completion:
      row.completion_id === null
        ? null
        : {
            id: row.completion_id,
            clientUuid: row.client_uuid!,
            status: row.completion_status!,
            completedAt: iso(row.completed_at)!,
            decidedAt: iso(row.decided_at),
            decidedByType: row.decided_by_type,
            decisionNote: row.decision_note,
            hasProof: row.proof_path !== null,
          },
  };
}

const invalid = (message: string, details?: Record<string, unknown>) =>
  new ApiError('VALIDATION_FAILED', message, details);

const COMPLETION_MESSAGES: Record<CompletionError, string> = {
  TASK_ARCHIVED: 'This task was archived',
  SYSTEM_VERIFIED_ONLY: 'This task is completed by the app itself',
  NOT_SCHEDULED: 'This task is not scheduled on that day',
  FUTURE_OCCURRENCE: 'This day has not come yet',
  ALREADY_COMPLETED: 'Already completed',
  PENDING_APPROVAL: 'Already waiting for a parent',
  PROOF_REQUIRED: 'A photo is required',
};

function completionError(error: CompletionError): ApiError {
  const details = { reason: error };
  if (error === 'NOT_SCHEDULED')
    return new ApiError('NOT_FOUND', COMPLETION_MESSAGES[error], details);
  if (error === 'PROOF_REQUIRED') return invalid(COMPLETION_MESSAGES[error], details);
  return new ApiError('CONFLICT', COMPLETION_MESSAGES[error], details);
}

// --- Handlers --------------------------------------------------------------------------------------

export function registerCalendarRoutes(app: OpenAPIHono<AppEnv>, deps: ApiDeps): void {
  const sql = deps.sql;
  const now = () => deps.now?.() ?? new Date();

  /** Parent → their households; child → their own household, only for their own id. */
  async function readScope(actor: Actor, studentId: string): Promise<Scope> {
    const who = requireActor(actor, 'parent', 'child');
    if (who.kind === 'child') {
      if (who.childId !== studentId) throw new ApiError('NOT_FOUND', 'Student not found');
      return scoped(sql, [who.householdId]);
    }
    return scopeFor(sql, who);
  }

  async function studentOr404(scope: Scope, id: string) {
    const student = await repo.calendarStudent(sql, scope, id);
    if (!student) throw new ApiError('NOT_FOUND', 'Student not found');
    return student;
  }

  async function parentScope(actor: Actor) {
    const parent = requireActor(actor, 'parent');
    return { parent, scope: await scopeFor(sql, parent) };
  }

  /** A task the actor may see: parent → household; child → only tasks assigned to them. */
  async function visibleTask(actor: Actor, id: string) {
    const who = requireActor(actor, 'parent', 'child');
    const scope = who.kind === 'child' ? scoped(sql, [who.householdId]) : await scopeFor(sql, who);
    const task = await repo.task(sql, scope, id);
    if (!task || (who.kind === 'child' && task.assigned_student_id !== who.childId)) {
      throw new ApiError('NOT_FOUND', 'Task not found');
    }
    return { who, scope, task };
  }

  function checkTimetable(v: repo.TimetableValues) {
    if (!validTimeWindow(toHHMM(v.start_time), toHHMM(v.end_time))) {
      throw invalid('endTime must be after startTime');
    }
    if (v.valid_from && v.valid_to && v.valid_to < v.valid_from) {
      throw invalid('validTo must not be before validFrom');
    }
  }

  function checkEvent(v: repo.EventValues) {
    if (!(v.starts_at < v.ends_at)) throw invalid('endsAt must be after startsAt');
  }

  function checkTask(v: repo.TaskValues) {
    if (!validTimeWindow(hhmm(v.window_start), hhmm(v.window_end))) {
      throw invalid('windowStart and windowEnd go together, start before end');
    }
  }

  function rruleOrThrow(input: string | null | undefined): string | null {
    if (input === null || input === undefined) return null;
    const normalised = normaliseRRule(input);
    if (!normalised) throw invalid('Unsupported repeat rule', { field: 'rrule' });
    return normalised;
  }

  // Reference data ---------------------------------------------------------------------------------

  app.openapi(subjectsRoute, async (c) => {
    const rows = await repo.subjects(sql);
    return c.json(
      {
        subjects: rows.map((r) => ({
          code: r.code,
          nameVi: r.name_vi,
          nameEn: r.name_en,
          gradeFrom: r.grade_from,
          gradeTo: r.grade_to,
        })),
      },
      200,
    );
  });

  app.openapi(templatesRoute, async (c) => {
    const { scope } = await parentScope(c.get('actor'));
    const rows = await repo.templates(sql, scope);
    return c.json(
      {
        templates: rows.map((r) => ({
          id: r.id,
          builtIn: r.household_id === null,
          type: r.type,
          title: r.title,
          description: r.description,
          durationMinutes: r.duration_minutes,
          priority: r.priority,
          verificationMode: r.verification_mode,
          rewardXp: r.reward_xp,
        })),
      },
      200,
    );
  });

  // Calendar ---------------------------------------------------------------------------------------

  app.openapi(calendarRoute, async (c) => {
    const { id } = c.req.valid('param');
    const query = c.req.valid('query');
    const range = validateCalendarRange(query.from, query.to);
    if (!range.ok)
      throw invalid('Invalid range (to ≥ from, at most 62 days)', { reason: range.error });
    const scope = await readScope(c.get('actor'), id);
    const student = await studentOr404(scope, id);
    const { from, to } = range.value;
    const [entries, events, occurrences] = await Promise.all([
      repo.timetable(sql, scope, id),
      repo.eventsBetween(
        sql,
        scope,
        id,
        zonedDayStart(from, student.timezone),
        zonedDayStart(addDays(to, 1), student.timezone),
      ),
      repo.occurrencesBetween(sql, scope, id, from, to),
    ]);
    const timetable = eachDay(from, to).flatMap((date) =>
      entries
        .filter(
          (e) =>
            e.weekday === isoWeekday(date) &&
            (e.valid_from === null || e.valid_from <= date) &&
            (e.valid_to === null || e.valid_to >= date),
        )
        .map((e) => ({
          date,
          entryId: e.id,
          startTime: toHHMM(e.start_time),
          endTime: toHHMM(e.end_time),
          subjectCode: e.subject_code,
          room: e.room,
          note: e.note,
        })),
    );
    return c.json(
      {
        studentId: id,
        timezone: student.timezone,
        today: householdToday(now(), student.timezone),
        from,
        to,
        timetable,
        events: events.map(toEvent),
        tasks: occurrences.map(toOccurrence),
      },
      200,
    );
  });

  // Timetable --------------------------------------------------------------------------------------

  app.openapi(timetableRoute, async (c) => {
    const { id } = c.req.valid('param');
    const scope = await readScope(c.get('actor'), id);
    await studentOr404(scope, id);
    const rows = await repo.timetable(sql, scope, id);
    return c.json({ studentId: id, entries: rows.map(toEntry) }, 200);
  });

  app.openapi(timetableCreateRoute, async (c) => {
    const { parent, scope } = await parentScope(c.get('actor'));
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const student = await studentOr404(scope, id);
    const values: repo.TimetableValues = {
      weekday: input.weekday,
      start_time: input.startTime,
      end_time: input.endTime,
      subject_code: input.subjectCode,
      room: input.room ?? null,
      note: input.note || null,
      valid_from: input.validFrom ?? null,
      valid_to: input.validTo ?? null,
    };
    checkTimetable(values);
    const row = await repo.insertTimetableEntry(
      sql,
      student.household_id,
      id,
      parent.userId,
      values,
    );
    return c.json({ entry: toEntry(row) }, 201);
  });

  app.openapi(timetableUpdateRoute, async (c) => {
    const { scope } = await parentScope(c.get('actor'));
    const { entryId } = c.req.valid('param');
    const input = c.req.valid('json');
    const current = await repo.timetableEntry(sql, scope, entryId);
    if (!current) throw new ApiError('NOT_FOUND', 'Timetable entry not found');
    const values: repo.TimetableValues = {
      weekday: input.weekday ?? current.weekday,
      start_time: input.startTime ?? current.start_time,
      end_time: input.endTime ?? current.end_time,
      subject_code: input.subjectCode ?? current.subject_code,
      room: input.room === undefined ? current.room : input.room,
      note: input.note === undefined ? current.note : input.note || null,
      valid_from: input.validFrom === undefined ? current.valid_from : input.validFrom,
      valid_to: input.validTo === undefined ? current.valid_to : input.validTo,
    };
    checkTimetable(values);
    const row = await repo.updateTimetableEntry(sql, scope, entryId, values);
    if (!row) throw new ApiError('NOT_FOUND', 'Timetable entry not found');
    return c.json({ entry: toEntry(row) }, 200);
  });

  app.openapi(timetableDeleteRoute, async (c) => {
    const { scope } = await parentScope(c.get('actor'));
    const { entryId } = c.req.valid('param');
    if (!(await repo.deleteTimetableEntry(sql, scope, entryId))) {
      throw new ApiError('NOT_FOUND', 'Timetable entry not found');
    }
    return c.body(null, 204);
  });

  // Events -----------------------------------------------------------------------------------------

  app.openapi(eventCreateRoute, async (c) => {
    const { parent, scope } = await parentScope(c.get('actor'));
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const student = await studentOr404(scope, id);
    const values: repo.EventValues = {
      type: input.type,
      title: input.title,
      note: input.note || null,
      location: input.location || null,
      subject_code: input.subjectCode ?? null,
      starts_at: new Date(input.startsAt),
      ends_at: new Date(input.endsAt),
      all_day: input.allDay ?? false,
    };
    checkEvent(values);
    const row = await repo.insertEvent(sql, student.household_id, id, parent.userId, values);
    return c.json({ event: toEvent(row) }, 201);
  });

  app.openapi(eventUpdateRoute, async (c) => {
    const { scope } = await parentScope(c.get('actor'));
    const { eventId } = c.req.valid('param');
    const input = c.req.valid('json');
    const current = await repo.calendarEvent(sql, scope, eventId);
    if (!current) throw new ApiError('NOT_FOUND', 'Event not found');
    const values: repo.EventValues = {
      type: input.type ?? current.type,
      title: input.title ?? current.title,
      note: input.note === undefined ? current.note : input.note || null,
      location: input.location === undefined ? current.location : input.location || null,
      subject_code: input.subjectCode === undefined ? current.subject_code : input.subjectCode,
      starts_at: input.startsAt ? new Date(input.startsAt) : new Date(current.starts_at),
      ends_at: input.endsAt ? new Date(input.endsAt) : new Date(current.ends_at),
      all_day: input.allDay ?? current.all_day,
    };
    checkEvent(values);
    const row = await repo.updateEvent(sql, scope, eventId, values);
    if (!row) throw new ApiError('NOT_FOUND', 'Event not found');
    return c.json({ event: toEvent(row) }, 200);
  });

  app.openapi(eventDeleteRoute, async (c) => {
    const { scope } = await parentScope(c.get('actor'));
    const { eventId } = c.req.valid('param');
    if (!(await repo.deleteEvent(sql, scope, eventId))) {
      throw new ApiError('NOT_FOUND', 'Event not found');
    }
    return c.body(null, 204);
  });

  // Tasks ------------------------------------------------------------------------------------------

  app.openapi(taskCreateRoute, async (c) => {
    const { parent, scope } = await parentScope(c.get('actor'));
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const student = await studentOr404(scope, id);
    const today = householdToday(now(), student.timezone);
    const values: repo.TaskValues = {
      type: input.type,
      title: input.title,
      description: input.description || null,
      subject_code: input.subjectCode ?? null,
      starts_on: input.startsOn ?? today,
      window_start: input.windowStart ?? null,
      window_end: input.windowEnd ?? null,
      duration_minutes: input.durationMinutes ?? null,
      rrule: rruleOrThrow(input.rrule),
      priority: input.priority ?? 'NORMAL',
      required: input.required ?? true,
      reward_xp: input.rewardXp ?? 0,
      verification_mode: input.verificationMode,
    };
    checkTask(values);
    if (input.templateId && !(await repo.templateVisible(sql, scope, input.templateId))) {
      throw invalid('Unknown template', { field: 'templateId' });
    }
    const requestId = c.get('requestId');
    const task = (await sql.begin(async (tx) => {
      const row = await repo.insertTask(tx, {
        ...values,
        householdId: student.household_id,
        studentId: id,
        createdBy: parent.userId,
        templateId: input.templateId ?? null,
      });
      if (input.saveAsTemplate) {
        await repo.insertTemplate(tx, {
          householdId: student.household_id,
          type: values.type,
          title: values.title,
          description: values.description,
          durationMinutes: values.duration_minutes,
          priority: values.priority,
          verificationMode: values.verification_mode,
          rewardXp: values.reward_xp,
          createdBy: parent.userId,
        });
      }
      await materialiseTask(tx, row, today);
      await writeEvent(tx, {
        type: TASK_EVENT_TYPES.assigned,
        householdId: student.household_id,
        aggregateType: 'task',
        aggregateId: row.id,
        payload: {
          eventName: TASK_EVENT_NAMES['task.assigned'],
          actorType: 'parent',
          actorId: parent.userId,
          studentId: id,
          taskId: row.id,
          type: row.type,
          verificationMode: row.verification_mode,
          rrule: row.rrule,
          startsOn: row.starts_on,
          rewardXp: row.reward_xp,
          required: row.required,
        },
        idempotencyKey: row.id,
      });
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: parent.userId,
        action: 'task.created',
        targetType: 'task',
        targetId: row.id,
        householdId: student.household_id,
        requestId,
        details: { studentId: id, verificationMode: row.verification_mode, rrule: row.rrule },
      });
      return row;
    })) as repo.TaskRow;
    const upcoming = await repo.upcomingDays(sql, scope, task.id, today);
    return c.json({ task: toTask(task), upcoming }, 201);
  });

  app.openapi(taskGetRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { scope, task } = await visibleTask(c.get('actor'), id);
    const student = await studentOr404(scope, task.assigned_student_id);
    const upcoming = await repo.upcomingDays(
      sql,
      scope,
      id,
      householdToday(now(), student.timezone),
    );
    return c.json({ task: toTask(task), upcoming }, 200);
  });

  app.openapi(taskUpdateRoute, async (c) => {
    const { parent, scope } = await parentScope(c.get('actor'));
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const requestId = c.get('requestId');
    const result = (await sql.begin(async (tx) => {
      const current = await repo.task(tx, scope, id, true);
      if (!current) throw new ApiError('NOT_FOUND', 'Task not found');
      const student = await studentOr404(scope, current.assigned_student_id);
      const today = householdToday(now(), student.timezone);
      const values: repo.TaskValues & { status: 'ACTIVE' | 'ARCHIVED' } = {
        type: input.type ?? current.type,
        title: input.title ?? current.title,
        description:
          input.description === undefined ? current.description : input.description || null,
        subject_code: input.subjectCode === undefined ? current.subject_code : input.subjectCode,
        starts_on: input.startsOn ?? current.starts_on,
        window_start: input.windowStart === undefined ? current.window_start : input.windowStart,
        window_end: input.windowEnd === undefined ? current.window_end : input.windowEnd,
        duration_minutes:
          input.durationMinutes === undefined ? current.duration_minutes : input.durationMinutes,
        rrule: input.rrule === undefined ? current.rrule : rruleOrThrow(input.rrule),
        priority: input.priority ?? current.priority,
        required: input.required ?? current.required,
        reward_xp: input.rewardXp ?? current.reward_xp,
        verification_mode: input.verificationMode ?? current.verification_mode,
        status:
          input.archived === undefined ? current.status : input.archived ? 'ARCHIVED' : 'ACTIVE',
      };
      checkTask(values);
      const row = (await repo.updateTask(tx, scope, id, values))!;
      const rescheduled =
        values.starts_on !== current.starts_on ||
        values.rrule !== current.rrule ||
        values.status !== current.status;
      let removed = 0;
      if (rescheduled) {
        removed = await repo.removeOpenOccurrences(tx, scope, id, today);
        if (values.status === 'ACTIVE') await materialiseTask(tx, row, today);
      }
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: parent.userId,
        action:
          values.status !== current.status && values.status === 'ARCHIVED'
            ? 'task.archived'
            : 'task.updated',
        targetType: 'task',
        targetId: id,
        householdId: row.household_id,
        requestId,
        details: {
          studentId: row.assigned_student_id,
          fields: Object.keys(input),
          removedOpenDays: removed,
        },
      });
      return { row, today };
    })) as { row: repo.TaskRow; today: string };
    const upcoming = await repo.upcomingDays(sql, scope, id, result.today);
    return c.json({ task: toTask(result.row), upcoming }, 200);
  });

  // Completion -------------------------------------------------------------------------------------

  app.openapi(completeRoute, async (c) => {
    const child = requireActor(c.get('actor'), 'child');
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const { scope, task } = await visibleTask(child, id);
    const student = await studentOr404(scope, child.childId);
    const today = householdToday(now(), student.timezone);

    const replay = async (): Promise<z.infer<typeof TaskCompleteResponseSchema> | null> => {
      const existing = await repo.completionByClientUuid(sql, input.clientUuid);
      if (!existing) return null;
      if (existing.household_id !== child.householdId || existing.assignment_id !== id) {
        throw new ApiError('CONFLICT', 'This clientUuid was used for another task', {
          reason: 'CLIENT_UUID_REUSED',
        });
      }
      const occurrence = await repo.occurrenceById(sql, scope, existing.occurrence_id);
      return { occurrence: toOccurrence(occurrence!), replayed: true };
    };

    const replayed = await replay();
    if (replayed) return c.json(replayed, 200);

    const day = input.date ?? today;
    let proofContentType: string | null = null;
    if (input.proofPath !== undefined) {
      const ids = { householdId: child.householdId, studentId: child.childId, taskId: id };
      proofContentType = proofContentTypeOf(input.proofPath);
      if (!proofPathBelongsTo(input.proofPath, ids) || !proofContentType) {
        throw invalid('proofPath was not issued for this task', { reason: 'PROOF_INVALID' });
      }
      if (!(await repo.proofObjectExists(sql, TASK_PROOF_BUCKET, input.proofPath))) {
        throw invalid('The photo has not been uploaded', { reason: 'PROOF_NOT_UPLOADED' });
      }
    }

    const outcome = (await sql.begin(async (tx: TxSql) => {
      const occurrence = await repo.lockOccurrence(tx, scope, id, day);
      // A concurrent request with the same clientUuid committed while this one waited for the lock.
      if (await repo.completionByClientUuid(tx, input.clientUuid)) return { replay: true as const };
      const check = canComplete({
        taskStatus: task.status,
        mode: task.verification_mode,
        occurrence: occurrence ? { day, status: occurrence.status } : null,
        today,
        hasProof: input.proofPath !== undefined,
      });
      if (!check.ok) throw completionError(check.error);
      const status = check.value;
      const completionId = await repo.insertCompletion(tx, {
        householdId: child.householdId,
        studentId: child.childId,
        taskId: id,
        occurrenceId: occurrence!.id,
        clientUuid: input.clientUuid,
        status,
      });
      // A concurrent request with the same clientUuid won: answer as a replay after the commit.
      if (!completionId) return { replay: true as const };
      if (input.proofPath !== undefined) {
        await repo.insertProof(tx, {
          householdId: child.householdId,
          studentId: child.childId,
          completionId,
          path: input.proofPath,
          contentType: proofContentType!,
        });
      }
      await repo.setOccurrenceStatus(tx, scope, occurrence!.id, occurrenceStatusFor(status));
      const common = {
        studentId: child.childId,
        taskId: id,
        occurrenceId: occurrence!.id,
        completionId,
        date: day,
        verificationMode: task.verification_mode,
        rewardXp: task.reward_xp,
        required: task.required,
      };
      await writeEvent(tx, {
        type: TASK_EVENT_TYPES.completed,
        householdId: child.householdId,
        aggregateType: 'task_completion',
        aggregateId: completionId,
        payload: {
          ...common,
          eventName: TASK_EVENT_NAMES['task.completed'],
          actorType: 'child',
          actorId: child.childId,
          status,
          hasProof: input.proofPath !== undefined,
        },
        idempotencyKey: completionId,
      });
      if (status === 'APPROVED') {
        // SELF_CHECK: approved by the rule itself, so reward consumers (M04) see one TaskApproved.
        await writeEvent(tx, {
          type: TASK_EVENT_TYPES.approved,
          householdId: child.householdId,
          aggregateType: 'task_completion',
          aggregateId: completionId,
          payload: {
            ...common,
            eventName: TASK_EVENT_NAMES['task.approved'],
            actorType: 'system',
            actorId: null,
            auto: true,
          },
          idempotencyKey: completionId,
        });
      } else {
        for (const userId of await repo.householdParents(tx, child.householdId)) {
          await notifier.notify(tx, {
            userId,
            householdId: child.householdId,
            kind: 'task.approval_requested',
            data: { taskId: id, date: day, studentId: child.childId },
            idempotencyKey: `task-approval:${completionId}:${userId}`,
          });
        }
      }
      return { replay: false as const, occurrenceId: occurrence!.id };
    })) as { replay: true } | { replay: false; occurrenceId: string };

    if (outcome.replay) {
      const again = await replay();
      return c.json(again!, 200);
    }
    const occurrence = await repo.occurrenceById(sql, scope, outcome.occurrenceId);
    return c.json({ occurrence: toOccurrence(occurrence!), replayed: false }, 200);
  });

  // Decisions --------------------------------------------------------------------------------------

  async function decide(
    actor: Actor,
    taskId: string,
    input: { date: string; note?: string | undefined },
    decision: 'APPROVED' | 'REJECTED',
    requestId: string,
  ) {
    const { parent, scope } = await parentScope(actor);
    const task = await repo.task(sql, scope, taskId);
    if (!task) throw new ApiError('NOT_FOUND', 'Task not found');
    const occurrenceId = (await sql.begin(async (tx) => {
      const occurrence = await repo.lockOccurrence(tx, scope, taskId, input.date);
      if (!occurrence) {
        throw new ApiError('NOT_FOUND', 'This task is not scheduled on that day', {
          reason: 'NOT_SCHEDULED',
        });
      }
      const pending = await repo.pendingCompletion(tx, scope, occurrence.id);
      const check = canDecide(occurrence.status, pending?.status ?? null);
      if (!check.ok || !pending) {
        throw new ApiError('CONFLICT', 'Nothing is waiting for approval on that day', {
          reason: 'NOT_PENDING',
          status: occurrence.status,
        });
      }
      const note = input.note?.trim() || null;
      await repo.decideCompletion(tx, scope, pending.id, {
        status: decision,
        by: parent.userId,
        note,
      });
      await repo.setOccurrenceStatus(tx, scope, occurrence.id, occurrenceStatusFor(decision));
      const type = decision === 'APPROVED' ? TASK_EVENT_TYPES.approved : TASK_EVENT_TYPES.rejected;
      await writeEvent(tx, {
        type,
        householdId: task.household_id,
        aggregateType: 'task_completion',
        aggregateId: pending.id,
        payload: {
          eventName: TASK_EVENT_NAMES[type],
          actorType: 'parent',
          actorId: parent.userId,
          studentId: task.assigned_student_id,
          taskId,
          occurrenceId: occurrence.id,
          completionId: pending.id,
          date: input.date,
          verificationMode: task.verification_mode,
          rewardXp: task.reward_xp,
          required: task.required,
          auto: false,
        },
        idempotencyKey: pending.id,
      });
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: parent.userId,
        action: decision === 'APPROVED' ? 'task.approved' : 'task.rejected',
        targetType: 'task_completion',
        targetId: pending.id,
        householdId: task.household_id,
        requestId,
        details: { studentId: task.assigned_student_id, taskId, date: input.date },
      });
      return occurrence.id;
    })) as string;
    const occurrence = await repo.occurrenceById(sql, scope, occurrenceId);
    return { occurrence: toOccurrence(occurrence!) };
  }

  app.openapi(approveRoute, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(await decide(c.get('actor'), id, input, 'APPROVED', c.get('requestId')), 200);
  });

  app.openapi(rejectRoute, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(await decide(c.get('actor'), id, input, 'REJECTED', c.get('requestId')), 200);
  });

  app.openapi(approvalsRoute, async (c) => {
    const { scope } = await parentScope(c.get('actor'));
    const [rows, count] = await Promise.all([
      repo.pendingApprovals(sql, scope),
      repo.pendingApprovalCount(sql, scope),
    ]);
    if (rows.some((r) => r.proof_path) && !deps.storage) {
      throw new ApiError('SERVICE_UNAVAILABLE', 'Storage is not configured');
    }
    const items = await Promise.all(
      rows.map(async (r) => ({
        studentId: r.student_id,
        studentName: r.display_name,
        occurrence: toOccurrence(r),
        proofUrl: r.proof_path
          ? await deps.storage!.createSignedUrl(
              TASK_PROOF_BUCKET,
              r.proof_path,
              PROOF_VIEW_URL_TTL_SECONDS,
            )
          : null,
      })),
    );
    return c.json({ count, items }, 200);
  });

  // Uploads ----------------------------------------------------------------------------------------

  app.openapi(uploadSignRoute, async (c) => {
    const child = requireActor(c.get('actor'), 'child');
    const input = c.req.valid('json');
    const { task } = await visibleTask(child, input.taskId);
    if (task.status !== 'ACTIVE') {
      throw new ApiError('CONFLICT', 'This task was archived', { reason: 'TASK_ARCHIVED' });
    }
    if (!deps.storage) throw new ApiError('SERVICE_UNAVAILABLE', 'Storage is not configured');
    const hits = await rateLimitHit(
      sql,
      proofUploadRateLimitBucket(child.childId),
      PROOF_UPLOAD_RATE_LIMIT.windowSeconds,
    );
    if (isOverLimit(hits, PROOF_UPLOAD_RATE_LIMIT)) {
      const retryAfter = retryAfterSeconds(now(), PROOF_UPLOAD_RATE_LIMIT);
      throw new ApiError(
        'RATE_LIMITED',
        'Too many uploads',
        { retryAfter },
        { 'retry-after': String(retryAfter) },
      );
    }
    const path = proofObjectPath(
      {
        householdId: child.householdId,
        studentId: child.childId,
        taskId: task.id,
        fileId: crypto.randomUUID(),
      },
      input.contentType,
    );
    const uploadUrl = await deps.storage.createSignedUploadUrl(TASK_PROOF_BUCKET, path);
    return c.json(
      {
        path,
        uploadUrl,
        expiresAt: new Date(now().getTime() + PROOF_UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
        maxBytes: MAX_PROOF_BYTES,
      },
      200,
    );
  });
}

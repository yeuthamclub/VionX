// M03 calendar, timetable & task schemas (TASK_PACKS/M03.md). Rules live in @vionx/domain.
import { z } from '@hono/zod-openapi';
import {
  CALENDAR_EVENT_TYPES,
  COMPLETION_STATUSES,
  isSubjectCode,
  isValidDay,
  OCCURRENCE_STATUSES,
  PROOF_CONTENT_TYPES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  VERIFICATION_MODES,
} from '@vionx/domain';

const Uuid = z.uuid().openapi({ example: '3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c' });
const DateTime = z.iso.datetime({ offset: true });
const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidDay, 'Not a calendar date')
  .openapi({ example: '2026-10-13', description: 'Household-local day (YYYY-MM-DD).' });
const Time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .openapi({ example: '07:30', description: 'Household-local wall-clock time (HH:MM).' });
const SubjectCode = z
  .string()
  .refine(isSubjectCode, 'Unknown subject code')
  .openapi({ example: 'TOAN', description: 'GDPT 2018 subject code (GET /v1/subjects).' });
const Title = z.string().trim().min(1).max(80);
const LongText = (max: number) => z.string().trim().max(max);

export const CalendarEventTypeSchema = z.enum(CALENDAR_EVENT_TYPES).openapi('CalendarEventType');
export const TaskTypeSchema = z.enum(TASK_TYPES).openapi('TaskType');
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES).openapi('TaskPriority');
export const VerificationModeSchema = z.enum(VERIFICATION_MODES).openapi('VerificationMode');
export const OccurrenceStatusSchema = z.enum(OCCURRENCE_STATUSES).openapi('OccurrenceStatus');
export const CompletionStatusSchema = z.enum(COMPLETION_STATUSES).openapi('CompletionStatus');

// --- Reference data -------------------------------------------------------------------------------
export const SchoolSubjectSchema = z
  .object({
    code: z.string(),
    nameVi: z.string(),
    nameEn: z.string(),
    gradeFrom: z.int(),
    gradeTo: z.int(),
  })
  .openapi('SchoolSubject');

export const SubjectsResponseSchema = z
  .object({ subjects: z.array(SchoolSubjectSchema) })
  .openapi('SubjectsResponse');

export const TaskTemplateSchema = z
  .object({
    id: Uuid,
    builtIn: z
      .boolean()
      .openapi({ description: 'A VionX starter template (not the household’s).' }),
    type: TaskTypeSchema,
    title: z.string(),
    description: z.string().nullable(),
    durationMinutes: z.int().nullable(),
    priority: TaskPrioritySchema,
    verificationMode: VerificationModeSchema,
    rewardXp: z.int(),
  })
  .openapi('TaskTemplate');
export type TaskTemplate = z.infer<typeof TaskTemplateSchema>;

export const TaskTemplatesResponseSchema = z
  .object({ templates: z.array(TaskTemplateSchema) })
  .openapi('TaskTemplatesResponse');

// --- Path params ------------------------------------------------------------------------------------
export const EntryIdParamSchema = z.object({
  entryId: Uuid.openapi({ param: { name: 'entryId', in: 'path' } }),
});
export const EventIdParamSchema = z.object({
  eventId: Uuid.openapi({ param: { name: 'eventId', in: 'path' } }),
});
export const TaskIdParamSchema = z.object({
  id: Uuid.openapi({ param: { name: 'id', in: 'path' } }),
});

// --- Timetable --------------------------------------------------------------------------------------
export const TimetableEntrySchema = z
  .object({
    id: Uuid,
    studentId: Uuid,
    weekday: z
      .int()
      .min(1)
      .max(7)
      .openapi({ description: 'ISO weekday: 1 = Monday … 7 = Sunday.' }),
    startTime: Time,
    endTime: Time,
    subjectCode: z.string(),
    room: z.string().nullable(),
    note: z.string().nullable(),
    validFrom: Day.nullable(),
    validTo: Day.nullable(),
  })
  .openapi('TimetableEntry');
export type TimetableEntry = z.infer<typeof TimetableEntrySchema>;

export const TimetableEntryCreateSchema = z
  .object({
    weekday: z.int().min(1).max(7),
    startTime: Time,
    endTime: Time,
    subjectCode: SubjectCode,
    room: LongText(40).min(1).nullable().optional(),
    note: LongText(200).nullable().optional(),
    validFrom: Day.nullable().optional(),
    validTo: Day.nullable().optional(),
  })
  .openapi('TimetableEntryCreate');

export const TimetableEntryUpdateSchema =
  TimetableEntryCreateSchema.partial().openapi('TimetableEntryUpdate');

export const TimetableResponseSchema = z
  .object({ studentId: Uuid, entries: z.array(TimetableEntrySchema) })
  .openapi('TimetableResponse');

export const TimetableEntryResponseSchema = z
  .object({ entry: TimetableEntrySchema })
  .openapi('TimetableEntryResponse');

// --- Calendar events ----------------------------------------------------------------------------------
export const CalendarEventSchema = z
  .object({
    id: Uuid,
    studentId: Uuid,
    type: CalendarEventTypeSchema,
    title: z.string(),
    note: z.string().nullable(),
    location: z.string().nullable(),
    subjectCode: z.string().nullable(),
    startsAt: DateTime,
    endsAt: DateTime,
    allDay: z.boolean(),
  })
  .openapi('CalendarEvent');
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const CalendarEventCreateSchema = z
  .object({
    type: CalendarEventTypeSchema,
    title: Title,
    note: LongText(500).nullable().optional(),
    location: LongText(80).nullable().optional(),
    subjectCode: SubjectCode.nullable().optional(),
    startsAt: DateTime,
    endsAt: DateTime,
    allDay: z.boolean().optional(),
  })
  .openapi('CalendarEventCreate');

export const CalendarEventUpdateSchema =
  CalendarEventCreateSchema.partial().openapi('CalendarEventUpdate');

export const CalendarEventResponseSchema = z
  .object({ event: CalendarEventSchema })
  .openapi('CalendarEventResponse');

// --- Tasks ------------------------------------------------------------------------------------------
export const TaskSchema = z
  .object({
    id: Uuid,
    studentId: Uuid,
    templateId: Uuid.nullable(),
    type: TaskTypeSchema,
    title: z.string(),
    description: z.string().nullable(),
    subjectCode: z.string().nullable(),
    startsOn: Day,
    windowStart: Time.nullable(),
    windowEnd: Time.nullable(),
    durationMinutes: z.int().nullable(),
    rrule: z
      .string()
      .nullable()
      .openapi({ description: 'Repeat rule (RRULE subset); null = once on startsOn.' }),
    priority: TaskPrioritySchema,
    required: z.boolean(),
    rewardXp: z.int(),
    verificationMode: VerificationModeSchema,
    status: z.enum(TASK_STATUSES),
    createdAt: DateTime,
    updatedAt: DateTime,
  })
  .openapi('Task');
export type Task = z.infer<typeof TaskSchema>;

const RRuleText = z.string().trim().min(1).max(200).openapi({
  example: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  description:
    'RFC 5545 subset: FREQ=DAILY|WEEKLY, INTERVAL=1..30, BYDAY=MO..SU, COUNT=1..366 or UNTIL=YYYYMMDD.',
});

export const TaskCreateSchema = z
  .object({
    type: TaskTypeSchema,
    title: Title,
    description: LongText(500).nullable().optional(),
    subjectCode: SubjectCode.nullable().optional(),
    startsOn: Day.optional().openapi({ description: 'Defaults to today (household-local).' }),
    windowStart: Time.nullable().optional(),
    windowEnd: Time.nullable().optional(),
    durationMinutes: z.int().min(1).max(600).nullable().optional(),
    rrule: RRuleText.nullable().optional(),
    priority: TaskPrioritySchema.optional(),
    required: z.boolean().optional(),
    rewardXp: z.int().min(0).max(1000).optional(),
    verificationMode: VerificationModeSchema,
    templateId: Uuid.nullable().optional(),
    saveAsTemplate: z
      .boolean()
      .optional()
      .openapi({ description: 'Also save these settings as a household template.' }),
  })
  .openapi('TaskCreate');

export const TaskUpdateSchema = TaskCreateSchema.omit({ templateId: true, saveAsTemplate: true })
  .partial()
  .extend({
    archived: z.boolean().optional().openapi({
      description: 'true archives the task (future open days are removed); false restores it.',
    }),
  })
  .openapi('TaskUpdate');

export const TaskCompletionSchema = z
  .object({
    id: Uuid,
    clientUuid: Uuid,
    status: CompletionStatusSchema,
    completedAt: DateTime,
    decidedAt: DateTime.nullable(),
    decidedByType: z.enum(['parent', 'system']).nullable(),
    decisionNote: z.string().nullable(),
    hasProof: z.boolean(),
  })
  .openapi('TaskCompletion');
export type TaskCompletion = z.infer<typeof TaskCompletionSchema>;

export const TaskOccurrenceSchema = z
  .object({
    id: Uuid,
    taskId: Uuid,
    studentId: Uuid,
    date: Day,
    status: OccurrenceStatusSchema,
    type: TaskTypeSchema,
    title: z.string(),
    description: z.string().nullable(),
    subjectCode: z.string().nullable(),
    windowStart: Time.nullable(),
    windowEnd: Time.nullable(),
    durationMinutes: z.int().nullable(),
    priority: TaskPrioritySchema,
    required: z.boolean(),
    rewardXp: z.int(),
    verificationMode: VerificationModeSchema,
    recurring: z.boolean(),
    completion: TaskCompletionSchema.nullable().openapi({ description: 'The latest completion.' }),
  })
  .openapi('TaskOccurrence');
export type TaskOccurrence = z.infer<typeof TaskOccurrenceSchema>;

export const TaskResponseSchema = z
  .object({
    task: TaskSchema,
    upcoming: z.array(Day).openapi({ description: 'Materialised days from today.' }),
  })
  .openapi('TaskResponse');

export const TaskCompleteRequestSchema = z
  .object({
    clientUuid: Uuid.openapi({
      description: 'Generated by the app per completion; a retry with the same value is a no-op.',
    }),
    date: Day.optional().openapi({ description: 'The day completed; defaults to today.' }),
    proofPath: z
      .string()
      .max(300)
      .optional()
      .openapi({
        description: 'Path returned by POST /v1/uploads/sign (required for PHOTO_PROOF).',
      }),
  })
  .openapi('TaskCompleteRequest');

export const TaskCompleteResponseSchema = z
  .object({
    occurrence: TaskOccurrenceSchema,
    replayed: z
      .boolean()
      .openapi({ description: 'True when this clientUuid was already stored (nothing changed).' }),
  })
  .openapi('TaskCompleteResponse');

export const TaskDecisionRequestSchema = z
  .object({
    date: Day.openapi({ description: 'The day whose pending completion is decided.' }),
    note: LongText(300).optional(),
  })
  .openapi('TaskDecisionRequest');

export const TaskDecisionResponseSchema = z
  .object({ occurrence: TaskOccurrenceSchema })
  .openapi('TaskDecisionResponse');

// --- Calendar ---------------------------------------------------------------------------------------
export const CalendarQuerySchema = z.object({
  from: Day.openapi({ param: { name: 'from', in: 'query' } }),
  to: Day.openapi({
    param: { name: 'to', in: 'query' },
    description: 'Inclusive; at most 62 days after `from`.',
  }),
});

export const TimetableSlotSchema = z
  .object({
    date: Day,
    entryId: Uuid,
    startTime: Time,
    endTime: Time,
    subjectCode: z.string(),
    room: z.string().nullable(),
    note: z.string().nullable(),
  })
  .openapi('TimetableSlot');

export const CalendarResponseSchema = z
  .object({
    studentId: Uuid,
    timezone: z.string(),
    today: Day,
    from: Day,
    to: Day,
    timetable: z.array(TimetableSlotSchema),
    events: z.array(CalendarEventSchema),
    tasks: z.array(TaskOccurrenceSchema),
  })
  .openapi('CalendarResponse');
export type CalendarResponse = z.infer<typeof CalendarResponseSchema>;

// --- Approvals inbox --------------------------------------------------------------------------------
export const ApprovalItemSchema = z
  .object({
    studentId: Uuid,
    studentName: z.string(),
    occurrence: TaskOccurrenceSchema,
    proofUrl: z
      .string()
      .nullable()
      .openapi({ description: 'Signed link to the proof photo, valid for 15 minutes.' }),
  })
  .openapi('ApprovalItem');

export const ApprovalsResponseSchema = z
  .object({ count: z.int(), items: z.array(ApprovalItemSchema) })
  .openapi('ApprovalsResponse');
export type ApprovalsResponse = z.infer<typeof ApprovalsResponseSchema>;

// --- Uploads ----------------------------------------------------------------------------------------
export const UploadSignRequestSchema = z
  .object({
    purpose: z.literal('TASK_PROOF'),
    taskId: Uuid,
    contentType: z.enum(PROOF_CONTENT_TYPES),
  })
  .openapi('UploadSignRequest');

export const UploadSignResponseSchema = z
  .object({
    path: z.string().openapi({ description: 'Pass as `proofPath` when completing the task.' }),
    uploadUrl: z
      .string()
      .openapi({ description: 'PUT the file here with the same Content-Type (no auth header).' }),
    expiresAt: DateTime,
    maxBytes: z.int(),
  })
  .openapi('UploadSignResponse');

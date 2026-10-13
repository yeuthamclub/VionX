// Calendar, timetable & task data access. Every child-data query takes a Scope (CONTRACT §3).
import type {
  CalendarEventType,
  CompletionStatus,
  OccurrenceStatus,
  TaskPriority,
  TaskStatus,
  TaskType,
  VerificationMode,
} from '@vionx/domain';
import type { Sql, TxSql } from '../../_shared/db.ts';
import type { Scope } from '../../_shared/scope.ts';

type Db = Sql | TxSql;

// --- Students -------------------------------------------------------------------------------------

export interface CalendarStudentRow {
  id: string;
  household_id: string;
  display_name: string;
  timezone: string;
}

export async function calendarStudent(
  db: Db,
  scope: Scope,
  id: string,
): Promise<CalendarStudentRow | null> {
  const rows = await db<CalendarStudentRow[]>`
    select s.id, s.household_id, s.display_name, h.timezone
    from app.students s join app.households h on h.id = s.household_id
    where s.id = ${id} and ${scope.where('s.household_id')}`;
  return rows[0] ?? null;
}

/** Parent accounts of a household (approval notifications). */
export async function householdParents(db: Db, householdId: string): Promise<string[]> {
  const rows = await db<{ user_id: string }[]>`
    select user_id from app.household_memberships where household_id = ${householdId}`;
  return rows.map((r) => r.user_id);
}

// --- Reference data --------------------------------------------------------------------------------

export interface SubjectRow {
  code: string;
  name_vi: string;
  name_en: string;
  grade_from: number;
  grade_to: number;
}

export async function subjects(db: Db): Promise<SubjectRow[]> {
  return db<SubjectRow[]>`
    select code, name_vi, name_en, grade_from, grade_to from app.school_subjects order by sort_order`;
}

export interface TemplateRow {
  id: string;
  household_id: string | null;
  type: TaskType;
  title: string;
  description: string | null;
  duration_minutes: number | null;
  priority: TaskPriority;
  verification_mode: VerificationMode;
  reward_xp: number;
}

/** Built-in templates and the household's own. */
export async function templates(db: Db, scope: Scope): Promise<TemplateRow[]> {
  return db<TemplateRow[]>`
    select id, household_id, type, title, description, duration_minutes, priority,
           verification_mode, reward_xp
    from app.task_templates
    where household_id is null or ${scope.where()}
    order by household_id nulls first, created_at, title`;
}

export async function templateVisible(db: Db, scope: Scope, id: string): Promise<boolean> {
  const rows = await db`
    select 1 from app.task_templates where id = ${id} and (household_id is null or ${scope.where()})`;
  return rows.length > 0;
}

export async function insertTemplate(
  db: Db,
  t: {
    householdId: string;
    type: TaskType;
    title: string;
    description: string | null;
    durationMinutes: number | null;
    priority: TaskPriority;
    verificationMode: VerificationMode;
    rewardXp: number;
    createdBy: string;
  },
): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into app.task_templates (household_id, type, title, description, duration_minutes,
                                    priority, verification_mode, reward_xp, created_by)
    values (${t.householdId}, ${t.type}, ${t.title}, ${t.description}, ${t.durationMinutes},
            ${t.priority}, ${t.verificationMode}, ${t.rewardXp}, ${t.createdBy})
    returning id`;
  return row!.id;
}

// --- Timetable -------------------------------------------------------------------------------------

export interface TimetableRow {
  id: string;
  household_id: string;
  student_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  subject_code: string;
  room: string | null;
  note: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

const timetableColumns = (db: Db) => db`
  id, household_id, student_id, weekday, start_time::text as start_time,
  end_time::text as end_time, subject_code, room, note, valid_from::text as valid_from,
  valid_to::text as valid_to`;

export async function timetable(db: Db, scope: Scope, studentId: string): Promise<TimetableRow[]> {
  return db<TimetableRow[]>`
    select ${timetableColumns(db)} from app.school_timetable_entries
    where student_id = ${studentId} and ${scope.where()}
    order by weekday, start_time, id`;
}

export async function timetableEntry(
  db: Db,
  scope: Scope,
  id: string,
): Promise<TimetableRow | null> {
  const rows = await db<TimetableRow[]>`
    select ${timetableColumns(db)} from app.school_timetable_entries
    where id = ${id} and ${scope.where()}`;
  return rows[0] ?? null;
}

export interface TimetableValues {
  weekday: number;
  start_time: string;
  end_time: string;
  subject_code: string;
  room: string | null;
  note: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

export async function insertTimetableEntry(
  db: Db,
  householdId: string,
  studentId: string,
  createdBy: string,
  v: TimetableValues,
): Promise<TimetableRow> {
  const [row] = await db<TimetableRow[]>`
    insert into app.school_timetable_entries (household_id, student_id, created_by, weekday,
      start_time, end_time, subject_code, room, note, valid_from, valid_to)
    values (${householdId}, ${studentId}, ${createdBy}, ${v.weekday}, ${v.start_time},
            ${v.end_time}, ${v.subject_code}, ${v.room}, ${v.note}, ${v.valid_from}, ${v.valid_to})
    returning ${timetableColumns(db)}`;
  return row!;
}

export async function updateTimetableEntry(
  db: Db,
  scope: Scope,
  id: string,
  v: TimetableValues,
): Promise<TimetableRow | null> {
  const rows = await db<TimetableRow[]>`
    update app.school_timetable_entries set
      weekday = ${v.weekday}, start_time = ${v.start_time}, end_time = ${v.end_time},
      subject_code = ${v.subject_code}, room = ${v.room}, note = ${v.note},
      valid_from = ${v.valid_from}, valid_to = ${v.valid_to}
    where id = ${id} and ${scope.where()}
    returning ${timetableColumns(db)}`;
  return rows[0] ?? null;
}

export async function deleteTimetableEntry(db: Db, scope: Scope, id: string): Promise<boolean> {
  const rows = await db`
    delete from app.school_timetable_entries where id = ${id} and ${scope.where()} returning id`;
  return rows.length > 0;
}

// --- Events ----------------------------------------------------------------------------------------

export interface EventRow {
  id: string;
  household_id: string;
  student_id: string;
  type: CalendarEventType;
  title: string;
  note: string | null;
  location: string | null;
  subject_code: string | null;
  starts_at: Date;
  ends_at: Date;
  all_day: boolean;
}

const eventColumns = (db: Db) => db`
  id, household_id, student_id, type, title, note, location, subject_code, starts_at, ends_at,
  all_day`;

export async function eventsBetween(
  db: Db,
  scope: Scope,
  studentId: string,
  from: Date,
  to: Date,
): Promise<EventRow[]> {
  return db<EventRow[]>`
    select ${eventColumns(db)} from app.calendar_events
    where student_id = ${studentId} and ${scope.where()}
      and starts_at < ${to} and ends_at > ${from}
    order by starts_at, id`;
}

export async function calendarEvent(db: Db, scope: Scope, id: string): Promise<EventRow | null> {
  const rows = await db<EventRow[]>`
    select ${eventColumns(db)} from app.calendar_events where id = ${id} and ${scope.where()}`;
  return rows[0] ?? null;
}

export interface EventValues {
  type: CalendarEventType;
  title: string;
  note: string | null;
  location: string | null;
  subject_code: string | null;
  starts_at: Date;
  ends_at: Date;
  all_day: boolean;
}

export async function insertEvent(
  db: Db,
  householdId: string,
  studentId: string,
  createdBy: string,
  v: EventValues,
): Promise<EventRow> {
  const [row] = await db<EventRow[]>`
    insert into app.calendar_events (household_id, student_id, created_by, type, title, note,
      location, subject_code, starts_at, ends_at, all_day)
    values (${householdId}, ${studentId}, ${createdBy}, ${v.type}, ${v.title}, ${v.note},
            ${v.location}, ${v.subject_code}, ${v.starts_at}, ${v.ends_at}, ${v.all_day})
    returning ${eventColumns(db)}`;
  return row!;
}

export async function updateEvent(
  db: Db,
  scope: Scope,
  id: string,
  v: EventValues,
): Promise<EventRow | null> {
  const rows = await db<EventRow[]>`
    update app.calendar_events set
      type = ${v.type}, title = ${v.title}, note = ${v.note}, location = ${v.location},
      subject_code = ${v.subject_code}, starts_at = ${v.starts_at}, ends_at = ${v.ends_at},
      all_day = ${v.all_day}
    where id = ${id} and ${scope.where()}
    returning ${eventColumns(db)}`;
  return rows[0] ?? null;
}

export async function deleteEvent(db: Db, scope: Scope, id: string): Promise<boolean> {
  const rows = await db`
    delete from app.calendar_events where id = ${id} and ${scope.where()} returning id`;
  return rows.length > 0;
}

// --- Tasks -----------------------------------------------------------------------------------------

export interface TaskRow {
  id: string;
  household_id: string;
  assigned_student_id: string;
  template_id: string | null;
  type: TaskType;
  title: string;
  description: string | null;
  subject_code: string | null;
  starts_on: string;
  window_start: string | null;
  window_end: string | null;
  duration_minutes: number | null;
  rrule: string | null;
  priority: TaskPriority;
  required: boolean;
  reward_xp: number;
  verification_mode: VerificationMode;
  status: TaskStatus;
  created_at: Date;
  updated_at: Date;
}

const taskColumns = (db: Db, alias = 'a') => db`
  ${db(alias)}.id, ${db(alias)}.household_id, ${db(alias)}.assigned_student_id,
  ${db(alias)}.template_id, ${db(alias)}.type, ${db(alias)}.title, ${db(alias)}.description,
  ${db(alias)}.subject_code, ${db(alias)}.starts_on::text as starts_on,
  ${db(alias)}.window_start::text as window_start, ${db(alias)}.window_end::text as window_end,
  ${db(alias)}.duration_minutes, ${db(alias)}.rrule, ${db(alias)}.priority, ${db(alias)}.required,
  ${db(alias)}.reward_xp, ${db(alias)}.verification_mode, ${db(alias)}.status,
  ${db(alias)}.created_at, ${db(alias)}.updated_at`;

export async function task(
  db: Db,
  scope: Scope,
  id: string,
  forUpdate = false,
): Promise<TaskRow | null> {
  const rows = await db<TaskRow[]>`
    select ${taskColumns(db)} from app.task_assignments a
    where a.id = ${id} and ${scope.where('a.household_id')}
    ${forUpdate ? db`for update` : db``}`;
  return rows[0] ?? null;
}

export interface TaskValues {
  type: TaskType;
  title: string;
  description: string | null;
  subject_code: string | null;
  starts_on: string;
  window_start: string | null;
  window_end: string | null;
  duration_minutes: number | null;
  rrule: string | null;
  priority: TaskPriority;
  required: boolean;
  reward_xp: number;
  verification_mode: VerificationMode;
}

export async function insertTask(
  db: Db,
  t: TaskValues & {
    householdId: string;
    studentId: string;
    createdBy: string;
    templateId: string | null;
  },
): Promise<TaskRow> {
  const [row] = await db<TaskRow[]>`
    insert into app.task_assignments as a (household_id, assigned_student_id, created_by,
      template_id, type, title, description, subject_code, starts_on, window_start, window_end,
      duration_minutes, rrule, priority, required, reward_xp, verification_mode)
    values (${t.householdId}, ${t.studentId}, ${t.createdBy}, ${t.templateId}, ${t.type},
            ${t.title}, ${t.description}, ${t.subject_code}, ${t.starts_on}, ${t.window_start},
            ${t.window_end}, ${t.duration_minutes}, ${t.rrule}, ${t.priority}, ${t.required},
            ${t.reward_xp}, ${t.verification_mode})
    returning ${taskColumns(db)}`;
  return row!;
}

export async function updateTask(
  db: Db,
  scope: Scope,
  id: string,
  v: TaskValues & { status: TaskStatus },
): Promise<TaskRow | null> {
  const rows = await db<TaskRow[]>`
    update app.task_assignments as a set
      type = ${v.type}, title = ${v.title}, description = ${v.description},
      subject_code = ${v.subject_code}, starts_on = ${v.starts_on},
      window_start = ${v.window_start}, window_end = ${v.window_end},
      duration_minutes = ${v.duration_minutes}, rrule = ${v.rrule}, priority = ${v.priority},
      required = ${v.required}, reward_xp = ${v.reward_xp},
      verification_mode = ${v.verification_mode}, status = ${v.status},
      archived_at = ${v.status === 'ARCHIVED' ? db`coalesce(a.archived_at, now())` : null}
    where a.id = ${id} and ${scope.where('a.household_id')}
    returning ${taskColumns(db)}`;
  return rows[0] ?? null;
}

/**
 * Removes open days from `fromDay` on (no completion ever recorded), so an edited schedule or an
 * archived task stops showing them. Days with a completion are history and stay.
 */
export async function removeOpenOccurrences(
  db: Db,
  scope: Scope,
  taskId: string,
  fromDay: string,
): Promise<number> {
  const rows = await db`
    delete from app.task_occurrences o
    where o.assignment_id = ${taskId} and ${scope.where('o.household_id')}
      and o.occurs_on >= ${fromDay}::date and o.status = 'ASSIGNED'
      and not exists (select 1 from app.task_completions c where c.occurrence_id = o.id)
    returning o.id`;
  return rows.length;
}

export async function upcomingDays(
  db: Db,
  scope: Scope,
  taskId: string,
  fromDay: string,
): Promise<string[]> {
  const rows = await db<{ day: string }[]>`
    select occurs_on::text as day from app.task_occurrences
    where assignment_id = ${taskId} and ${scope.where()} and occurs_on >= ${fromDay}::date
    order by occurs_on limit 31`;
  return rows.map((r) => r.day);
}

// --- Occurrences & completions --------------------------------------------------------------------

export interface OccurrenceRow {
  id: string;
  household_id: string;
  student_id: string;
  assignment_id: string;
  occurs_on: string;
  status: OccurrenceStatus;
  // task fields
  type: TaskType;
  title: string;
  description: string | null;
  subject_code: string | null;
  window_start: string | null;
  window_end: string | null;
  duration_minutes: number | null;
  priority: TaskPriority;
  required: boolean;
  reward_xp: number;
  verification_mode: VerificationMode;
  rrule: string | null;
  // latest completion
  completion_id: string | null;
  client_uuid: string | null;
  completion_status: CompletionStatus | null;
  completed_at: Date | null;
  decided_at: Date | null;
  decided_by_type: 'parent' | 'system' | null;
  decision_note: string | null;
  proof_path: string | null;
}

const occurrenceSelect = (db: Db) => db`
  select o.id, o.household_id, o.student_id, o.assignment_id, o.occurs_on::text as occurs_on,
         o.status, a.type, a.title, a.description, a.subject_code,
         a.window_start::text as window_start, a.window_end::text as window_end,
         a.duration_minutes, a.priority, a.required, a.reward_xp, a.verification_mode, a.rrule,
         c.id as completion_id, c.client_uuid, c.status as completion_status, c.completed_at,
         c.decided_at, c.decided_by_type, c.decision_note, p.storage_path as proof_path
  from app.task_occurrences o
  join app.task_assignments a on a.id = o.assignment_id and a.household_id = o.household_id
  left join lateral (
    select * from app.task_completions c
    where c.occurrence_id = o.id order by c.completed_at desc, c.created_at desc limit 1
  ) c on true
  left join lateral (
    select storage_path from app.task_proofs p where p.completion_id = c.id
    order by p.created_at desc limit 1
  ) p on true`;

export async function occurrencesBetween(
  db: Db,
  scope: Scope,
  studentId: string,
  from: string,
  to: string,
): Promise<OccurrenceRow[]> {
  return db<OccurrenceRow[]>`
    ${occurrenceSelect(db)}
    where o.student_id = ${studentId} and ${scope.where('o.household_id')}
      and o.occurs_on between ${from}::date and ${to}::date
      and (a.status = 'ACTIVE' or o.status <> 'ASSIGNED')
    order by o.occurs_on, a.window_start nulls last, a.priority desc, a.title, o.id`;
}

export async function occurrenceById(
  db: Db,
  scope: Scope,
  id: string,
): Promise<OccurrenceRow | null> {
  const rows = await db<OccurrenceRow[]>`
    ${occurrenceSelect(db)} where o.id = ${id} and ${scope.where('o.household_id')}`;
  return rows[0] ?? null;
}

/** The occurrence of a task on a day, locked for the completion/decision transaction. */
export async function lockOccurrence(
  db: Db,
  scope: Scope,
  taskId: string,
  day: string,
): Promise<{ id: string; status: OccurrenceStatus } | null> {
  const rows = await db<{ id: string; status: OccurrenceStatus }[]>`
    select id, status from app.task_occurrences
    where assignment_id = ${taskId} and occurs_on = ${day}::date and ${scope.where()}
    for update`;
  return rows[0] ?? null;
}

export async function pendingApprovals(
  db: Db,
  scope: Scope,
): Promise<(OccurrenceRow & { display_name: string })[]> {
  return db<(OccurrenceRow & { display_name: string })[]>`
    select q.*, s.display_name from (
      ${occurrenceSelect(db)}
      where ${scope.where('o.household_id')} and o.status = 'PENDING_APPROVAL'
    ) q join app.students s on s.id = q.student_id
    order by q.completed_at, q.id
    limit 100`;
}

export async function pendingApprovalCount(db: Db, scope: Scope): Promise<number> {
  const [row] = await db<{ n: number }[]>`
    select count(*)::int as n from app.task_occurrences o
    where ${scope.where('o.household_id')} and o.status = 'PENDING_APPROVAL'`;
  return row?.n ?? 0;
}

export interface CompletionRow {
  id: string;
  household_id: string;
  student_id: string;
  assignment_id: string;
  occurrence_id: string;
  client_uuid: string;
  status: CompletionStatus;
}

/** A completion by its client UUID (unique across households; scoped on read). */
export async function completionByClientUuid(
  db: Db,
  clientUuid: string,
): Promise<CompletionRow | null> {
  const rows = await db<CompletionRow[]>`
    select id, household_id, student_id, assignment_id, occurrence_id, client_uuid, status
    from app.task_completions where client_uuid = ${clientUuid}`;
  return rows[0] ?? null;
}

/** Inserts a completion; null when the client UUID is already stored (concurrent replay). */
export async function insertCompletion(
  db: Db,
  c: {
    householdId: string;
    studentId: string;
    taskId: string;
    occurrenceId: string;
    clientUuid: string;
    status: CompletionStatus;
  },
): Promise<string | null> {
  const approved = c.status === 'APPROVED';
  const rows = await db<{ id: string }[]>`
    insert into app.task_completions (household_id, student_id, assignment_id, occurrence_id,
      client_uuid, status, decided_at, decided_by_type)
    values (${c.householdId}, ${c.studentId}, ${c.taskId}, ${c.occurrenceId}, ${c.clientUuid},
            ${c.status}, ${approved ? db`now()` : null}, ${approved ? 'system' : null})
    on conflict (client_uuid) do nothing
    returning id`;
  return rows[0]?.id ?? null;
}

export async function insertProof(
  db: Db,
  p: {
    householdId: string;
    studentId: string;
    completionId: string;
    path: string;
    contentType: string;
  },
): Promise<void> {
  await db`
    insert into app.task_proofs (household_id, student_id, completion_id, storage_path, content_type)
    values (${p.householdId}, ${p.studentId}, ${p.completionId}, ${p.path}, ${p.contentType})`;
}

/** The uploaded file exists in the private bucket (the client PUT it to the signed URL). */
export async function proofObjectExists(db: Db, bucket: string, path: string): Promise<boolean> {
  const rows = await db`
    select 1 from storage.objects where bucket_id = ${bucket} and name = ${path}`;
  return rows.length > 0;
}

export async function setOccurrenceStatus(
  db: Db,
  scope: Scope,
  id: string,
  status: OccurrenceStatus,
): Promise<void> {
  await db`update app.task_occurrences set status = ${status} where id = ${id} and ${scope.where()}`;
}

export async function pendingCompletion(
  db: Db,
  scope: Scope,
  occurrenceId: string,
): Promise<CompletionRow | null> {
  const rows = await db<CompletionRow[]>`
    select id, household_id, student_id, assignment_id, occurrence_id, client_uuid, status
    from app.task_completions
    where occurrence_id = ${occurrenceId} and ${scope.where()} and status = 'PENDING_APPROVAL'
    for update`;
  return rows[0] ?? null;
}

export async function decideCompletion(
  db: Db,
  scope: Scope,
  id: string,
  d: { status: 'APPROVED' | 'REJECTED'; by: string; note: string | null },
): Promise<void> {
  await db`
    update app.task_completions set status = ${d.status}, decided_at = now(),
      decided_by_type = 'parent', decided_by = ${d.by}, decision_note = ${d.note}
    where id = ${id} and ${scope.where()}`;
}

/** Proof files older than `olderThanHours` that no completion references (abandoned or purged). */
export async function orphanProofPaths(
  db: Db,
  bucket: string,
  olderThanHours: number,
  limit = 100,
): Promise<string[]> {
  const rows = await db<{ name: string }[]>`
    select o.name from storage.objects o
    where o.bucket_id = ${bucket}
      and o.created_at < now() - make_interval(hours => ${olderThanHours})
      and not exists (select 1 from app.task_proofs p where p.storage_path = o.name)
    order by o.created_at limit ${limit}`;
  return rows.map((r) => r.name);
}

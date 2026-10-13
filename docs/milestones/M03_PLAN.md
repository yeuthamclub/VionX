# M03 Plan — Calendar, timetable & tasks

Branch: `m03-calendar-tasks` from `main` (M00, M01, M02 merged).
Scope: `TASK_PACKS/M03.md`. Refs: Master Spec §13 (event types §13.1, task fields §13.2), §25 (events),
§26 (offline completion merges by client UUID); CONTRACT §3-§4.

## Model
- **Subjects** (`app.school_subjects`): the GDPT 2018 subject list (code, vi/en name, grade range).
  Global reference data, no personal data.
- **Timetable** (`app.school_timetable_entries`): weekly school periods per child (ISO weekday,
  start/end local time, subject, optional room/note, optional validity dates). Expanded into the
  calendar on read (no materialisation needed).
- **Calendar events** (`app.calendar_events`): one-off events per child with a §13.1 type
  (`SCHOOL_CLASS, TUTORING, EXAM, LEARNING_BLOCK, ENGLISH, READING, SPORT, HOUSEHOLD_TASK,
  CREATIVE, FAMILY_EVENT, CUSTOM`), start/end instants, all-day flag.
- **Task templates** (`app.task_templates`): built-in starter templates (household_id null, no
  personal data) and the household's own (saved from the task form).
- **Tasks** (`app.task_assignments`, §13.2 fields): household, assigned student, created_by, type,
  title, description, start date, local time window, duration estimate, repeat rule (`rrule`, a
  small RFC 5545 subset: `FREQ=DAILY|WEEKLY`, `INTERVAL`, `BYDAY`, `COUNT`, `UNTIL`), priority,
  required/optional, reward XP (consumed by M04), verification mode, status (ACTIVE/ARCHIVED).
- **Occurrences** (`app.task_occurrences`): one row per task and local day
  (`unique(assignment_id, occurs_on)`), status `ASSIGNED → PENDING_APPROVAL → COMPLETED`, or
  `REJECTED` (the child may try again). One-off tasks get their single occurrence at creation;
  recurring tasks are materialised for the next 14 days (household-local) at creation/edit and by
  the daily job.
- **Completions** (`app.task_completions`): `client_uuid` unique (idempotency), status
  `PENDING_APPROVAL | APPROVED | REJECTED`, decision by the parent; at most one live (pending or
  approved) completion per occurrence.
- **Proofs** (`app.task_proofs`): `storage_path` in the private bucket `task-proofs`
  (`<household>/<student>/<task>/<uuid>.<ext>`), uploaded with a signed upload URL.

## Rules (`packages/domain/src/calendar`)
- RRULE subset: parse/validate/serialise; occurrences between two local days (pure date arithmetic
  on `YYYY-MM-DD`). Property tests (fast-check): occurrences are sorted, unique, inside the window,
  on allowed weekdays, never before the start or after UNTIL/COUNT.
- Materialisation window: household today + 14 days (`MATERIALISE_DAYS`).
- Verification modes: SELF_CHECK → approved at once; PHOTO_PROOF (proof required) and
  PARENT_APPROVAL → PENDING_APPROVAL; SYSTEM_VERIFIED → the child cannot complete it (M06/M07).
- Completion: only the assigned child, only for an occurrence on or before today (household
  local), not already pending/completed (except a replay of the same `clientUuid`, which returns
  the stored completion and emits nothing). Approve/reject only from PENDING_APPROVAL.
- Children never edit: every write except `complete` and `uploads/sign` is parent-only.

## Steps (CLAUDE.md working-loop order)
1. **Migration** `0007_calendar_tasks.sql`: tables above (composite FKs to
   `app.students (id, household_id)`, cascade on purge), subject list, starter templates, private
   bucket `task-proofs` (10 MB, images), `ops.request_task_materialisation()` + pg_cron
   `vionx-task-materialise` daily at 00:05 ICT (writes a `task.materialise_requested` outbox event,
   one per day by idempotency key); RLS on, no client grants.
2. **Domain**: subjects, event types, task enums, RRULE, occurrences, completion/decision rules,
   window rules. Vitest + fast-check.
3. **API** `supabase/functions/api/calendar` (+ Zod in `packages/contracts/src/calendar.ts`):
   - `GET /v1/subjects`, `GET /v1/task-templates`
   - `GET /v1/students/{id}/calendar?from&to` (parent, or the child for their own id): timetable
     expanded per day, events, task occurrences with the latest completion.
   - Timetable: `GET|POST /v1/students/{id}/timetable`, `PATCH|DELETE /v1/timetable/{entryId}`.
   - Events: `POST /v1/students/{id}/events`, `PATCH|DELETE /v1/events/{eventId}`.
   - Tasks: `POST /v1/students/{id}/tasks`, `PATCH /v1/tasks/{id}` (edit or archive),
     `POST /v1/tasks/{id}/complete {clientUuid, date?, proofPath?}`,
     `POST /v1/tasks/{id}/approve|reject {date, note?}`.
   - `GET /v1/approvals` (parent inbox + badge count, signed proof links).
   - `POST /v1/uploads/sign` (signed upload URL for a task proof).
   - Outbox events `task.assigned`, `task.completed`, `task.approved`, `task.rejected` (Master
     Spec names TaskAssigned/… in the payload `eventName`), idempotency keys per task/completion;
     approval requests write `notification.push_requested` (push stub until M09). Audit logs for
     parent decisions. Cross-household 404 tests for every route; child-cannot-edit tests.
4. **Worker / cron**: handler `task.materialise_requested` (all active recurring tasks, 14 days,
   `on conflict do nothing`); tick maintenance removes proof files with no `task_proofs` row older
   than a day (abandoned uploads, purged children). Export gains the calendar/task sections.
5. **Mobile**: parent week calendar per child (timetable, events, task occurrences), timetable
   editor, task form (repeat, verification mode, template picks), event form, approvals inbox with
   a badge on the parent home; child "today's tasks" with completion and a camera photo
   (expo-image-picker) for PHOTO_PROOF. Loading/empty/error/offline states.
6. **Seed**: demo timetable and tasks for the demo children.
7. **Acceptance** `scripts/acceptance/m03.ts`; Maestro `apps/mobile/.maestro/m03-tasks.yaml`;
   CI runs `pnpm acceptance m03`.
8. Checks: lint, typecheck, unit tests, `pnpm test:api`, openapi check, acceptance m03 (+ m00-m02).
   REPORT, ROADMAP, push.

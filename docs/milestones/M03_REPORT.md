# M03 Report

## Summary
Parents can now plan each child's week. Each child has a week calendar with the school timetable,
one-off events (the 11 Master Spec §13.1 types) and tasks. A task can be one-off, daily, school days
(Mon-Fri) or weekly on chosen days. It has a time window, a reward in XP (stored for M04) and a
verification mode:
- **SELF_CHECK**: done at once.
- **PARENT_APPROVAL**: waits for the parent.
- **PHOTO_PROOF**: the child takes a photo with the camera, then it waits for the parent.

Recurring tasks are materialised for the next 14 days when they are created or edited, and again
every day by a pg_cron job. The child's "today's tasks" screen completes a day. A retried completion
with the same `clientUuid` is stored once. The parent's approvals inbox (with a badge on the parent
home) shows each pending day with its proof photo, and the parent approves it or sends it back.
Children can only complete tasks; every other write is parent-only.

## Changed
- Migration `0007_calendar_tasks.sql`. This is the only M03 migration (0008 is reserved for M05).
  - Tables:
    - `app.school_subjects`: 26 GDPT 2018 subjects with vi/en names and a grade range. Reference
      data with no personal data.
    - `app.school_timetable_entries`: weekly periods, expanded per day when read.
    - `app.calendar_events`: the §13.1 types, start/end instants and an all-day flag.
    - `app.task_templates`: 6 built-in rows (`household_id` null) plus the household's own.
    - `app.task_assignments`: the §13.2 fields, with `rrule`, `window_start`/`window_end`,
      `reward_xp`, `verification_mode`, and status `ACTIVE`/`ARCHIVED`.
    - `app.task_occurrences`: unique on `(assignment_id, occurs_on)`. Statuses are
      `ASSIGNED → PENDING_APPROVAL → COMPLETED`, or `REJECTED`, after which the child may try again.
    - `app.task_completions`: `client_uuid` is unique. A partial unique index allows one live
      (pending or approved) completion per occurrence.
    - `app.task_proofs`: a check ties the path prefix to the household, student and task.
  - Every child table has a composite foreign key to `app.students (id, household_id)` and is
    removed by cascade when M02 purges the child.
  - Private Storage bucket `task-proofs` (10 MB; jpeg, png and webp).
  - `ops.request_task_materialisation(now)` writes one `task.materialise_requested` outbox event per
    household-local day, with idempotency key `materialise:YYYY-MM-DD`. The pg_cron job
    `vionx-task-materialise` runs it daily at 00:05 ICT.
  - RLS is on and there are no client grants.
- Domain (`packages/domain/src/calendar`):
  - Subjects, event types and task enums.
  - Date helpers on `YYYY-MM-DD` day numbers, including the household-timezone day start.
  - An RRULE subset: `FREQ=DAILY|WEEKLY`, `INTERVAL`, `BYDAY`, `COUNT` and `UNTIL`. It is parsed,
    validated, normalised and expanded between two days, with fast-check property tests.
  - The 14-day materialisation window.
  - Completion and decision rules (`canComplete`, `canDecide`, with their reasons).
  - Proof path, content-type and rate-limit rules.
- Contracts: `packages/contracts/src/calendar.ts` (Zod), with the types also exported from
  `@vionx/contracts/client`.
- API routes (`supabase/functions/api/calendar`):
  - Reference data: `GET /v1/subjects` (public) and `GET /v1/task-templates`.
  - Calendar: `GET /v1/students/{id}/calendar?from&to`, for the parent or for the child's own id. It
    returns the expanded timetable, the events and the task days with their latest completion, over
    at most 62 days.
  - Timetable: `GET|POST /v1/students/{id}/timetable` and `PATCH|DELETE /v1/timetable/{entryId}`.
  - Events: `POST /v1/students/{id}/events` and `PATCH|DELETE /v1/events/{eventId}`.
  - Tasks:
    - `POST /v1/students/{id}/tasks`, with an optional template and "save as template".
    - `GET|PATCH /v1/tasks/{id}`, to edit or archive/restore. An edit re-materialises the future
      days that have no completion.
  - Completing: `POST /v1/tasks/{id}/complete {clientUuid, date?, proofPath?}`, child only.
  - Deciding: `POST /v1/tasks/{id}/approve|reject {date, note?}`, parent only.
  - Inbox: `GET /v1/approvals`, the parent inbox and badge count, with signed proof links.
  - Uploads: `POST /v1/uploads/sign` returns a signed upload URL for a task proof. It is limited to
    60 an hour per child.
- Outbox events (all idempotent):
  - `task.assigned` (key: task id).
  - `task.completed` (key: completion id).
  - `task.approved` and `task.rejected` (key: completion id).
  - Each payload carries the Master Spec name (`TaskAssigned` …) in `eventName`.
  - A pending approval also writes `notification.push_requested` with kind
    `task.approval_requested`.
- Audit entries: `task.created`, `task.updated`, `task.archived`, `task.approved`, `task.rejected`
  and `task.materialised`.
- Worker:
  - The `task.materialise_requested` handler tops up every active recurring task to 14 days with
    `on conflict do nothing`.
  - Tick maintenance removes proof files that have no `task_proofs` row and are older than 24 h
    (abandoned uploads, purged children).
  - The privacy export gains `timetable.json`, `calendar_events.json`, `task_templates.json`,
    `tasks.json`, `task_days.json` and `task_completions.json`.
- Shared code:
  - `createSignedUploadUrl` in `_shared/storage.ts`.
  - The `task.approval_requested` kind in `_shared/notify.ts`.
  - `_shared/tasks.ts` (`materialiseTask` and `materialiseAll`).
- Mobile screens:
  - Parent week calendar per child (`open-calendar` on the child screen).
  - Timetable editor.
  - Task form: templates, type, repeat preset or weekdays, start date, time window, verification
    mode, XP, required, save as template, archive/restore.
  - Event form.
  - Approvals inbox, with the badge on the parent home.
  - Child "today's tasks" (`open-child-tasks` on the child home), with completion and a camera proof
    through `expo-image-picker`. Microphone permission is off.
  - Every screen has loading, empty, error and offline states. vi/en strings are included, and task
    error reasons map to messages.
- Seed: Minh (grade 6) gets a 20-period timetable, weekday homework (PARENT_APPROVAL) and a one-off
  PHOTO_PROOF task. Bé An gets a daily SELF_CHECK reading task. All have 14 days materialised.
- CI runs `pnpm acceptance m03`.

## Evidence
All checks ran against local Supabase with the functions served.
- `pnpm lint`, `pnpm typecheck` (including `deno check`) and `pnpm openapi:check`: green.
- `pnpm test`: all passed.

  | Package | Tests (M02 → M03) |
  |---|---|
  | domain | 59 → 78 |
  | functions | 64 → 77 |
  | ai | 20 |
  | admin | 8 |
  | mobile (Vitest) | 22 → 28 |
  | mobile (Jest) | 7 → 12 |
  | tokens | 2 |
  | contracts | 1 |

- `pnpm test:api`: 90/90 passed (72 before, plus 18 new in `tests/integration/calendar.test.ts`).
  They cover:
  - Recurring materialisation and edits.
  - Concurrent completions with the same `clientUuid`, which produce one row.
  - Cross-household 404 on every new child route, including a replayed `clientUuid`.
  - A child answering 403 on every edit, approve and parent route.
  - SELF_CHECK auto-approval.
  - PHOTO_PROOF upload and proof required, plus a foreign proof path refused.
  - Reject and retry.
  - Archive.
  - The materialise job's idempotency.
  - Orphan proof cleanup.
  - Export sections.
  - No client privileges.
- Acceptance:
  - `pnpm acceptance m03`: 7 passed, 0 failed, 1 skipped (Maestro). Scenario: a recurring
    PARENT_APPROVAL task; the child completes it twice with the same `clientUuid`; one completion is
    stored; the parent approves; there is exactly one `task.approved` (TaskApproved) event and the
    worker consumes each event once.
  - Re-runs: `m02` 11 passed with 1 skipped; `m01` 9 passed with 1 skipped; `m00` 7 passed with
    2 skipped.
- Builds:
  - `pnpm --filter @vionx/admin build`: passes.
  - `expo export --platform android`: passes (5.0 MB Hermes bundle).
- Maestro: `apps/mobile/.maestro/m03-tasks.yaml` (new) was not run, because no emulator is available
  here. It covers: parent → child → calendar → daily PARENT_APPROVAL task → child device → complete →
  parent → approvals → approve.
- AI cost: US$0.

## Decisions
- **Event type names.** The outbox check needs lowercase dotted types, so the events are
  `task.assigned`, `task.completed`, `task.approved` and `task.rejected`. The Master Spec names
  (TaskAssigned …) go in the payload `eventName`.
- **Occurrence table.** The spec has assignments and completions only. M03 adds
  `app.task_occurrences` so that recurring days have a state and a unique key, and so that "14 days
  materialised" is concrete.
- **Identifying the day.** Complete, approve and reject name the day by `(task id, date)`, which
  keeps the routes as given in the task pack. `date` defaults to household today for `complete`.
- **SELF_CHECK** completions are approved at once and also emit `task.approved` with `auto: true`,
  so M04 has a single trigger for rewards.
- **Who completes.** Only the child completes; the parent cannot complete on the child's behalf. A
  completion is accepted only for today or an earlier day.
- **SYSTEM_VERIFIED** tasks cannot be completed by hand (`SYSTEM_VERIFIED_ONLY`). M06/M07 practice
  sessions will verify them, and the mobile task form does not offer the mode.
- **Rewards.** `reward_xp` is only stored; M04 consumes the events. M03 has no ledger.
- **Routes beyond the task pack:**
  - `GET /v1/subjects`, `GET /v1/task-templates`, `GET /v1/approvals` and `GET /v1/tasks/{id}`.
  - `GET` for the timetable.
  - The `DELETE` routes for timetable entries and events.
  - Tasks are archived, never deleted, so their history stays.
- **Push** is the outbox stub (`notification.push_requested`) until the push module adds FCM.
- **Export.** The privacy export holds proof metadata (paths and times), not the photo files.
- **Timezone.** The mobile event form and the child screen use the default household timezone
  (Asia/Ho_Chi_Minh), because v1 households have no timezone picker. The API uses each household's
  stored timezone.
- **Daily job.** pg_cron only writes the outbox event; the worker expands the dates with the same
  TypeScript RRULE code as the API, so the rules live in one place.

## Privacy & security impact
- New personal data: timetables, events, tasks, completions and proof photos. It is all
  household-scoped through `scoped(ctx)`, and none of it is in the library tables.
- Proof photos are kept in a private bucket and handled as follows:
  - Uploads use a signed URL whose path the domain rules tie to the child's household, student and
    task. A path for another child is refused.
  - The parent sees each photo through a short-lived signed link.
  - Orphan files are removed after 24 h.
- Camera use is requested only when a PHOTO_PROOF task is completed. No new consent type is needed
  under the M02 rules: the camera is not in the AI, microphone, health or competition group.
- Parent decisions and task changes are written to the audit log, with the child id in
  `target_id`/payload so that the M02 purge scrub finds them.

## Owner actions
- None required for this module.

## Known issues / follow-ups
- Maestro flow not verified (no emulator). It relies on regex ids (`complete-.*`, `approve-.*`) for
  the first task card, so a parent account with older pending items will approve the oldest first.
- Proof photos are not resized on the device beyond the picker's quality setting (0.6).
- The calendar shows days in the default household timezone on the device; per-household timezones
  need the settings work planned for later modules.

## What the next module can rely on
- M04 rewards: consume `task.approved` (payload: `taskId`, `occurrenceId`, `completionId`,
  `studentId`, `date`, `rewardXp`, `auto`). The idempotency key is the completion id. `task.rejected`
  means no reward.
- `materialiseTask(db, task, today)` and `materialiseAll(db, now)` in `_shared/tasks.ts`.
- Domain: `canComplete`, `occurrencesBetween`, `householdToday` and `zonedDayStart` in
  `@vionx/domain`.
- Proof uploads: `POST /v1/uploads/sign` and `createSignedUploadUrl` in `_shared/storage.ts`.

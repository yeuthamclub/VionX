# M07 Report

## Summary
A child's home screen is now Today: the day's cards in priority order, each with its duration and a
reward hint, a time bar for the day and the XP cap bar. Tasks from the parent, homework, reading and
activity tasks, exam preparation, weak prerequisite skills, due reviews and the next step of the
curriculum all appear in one list. Learning cards open a practice session and are marked done by the
system when the session finishes; coming back to the home screen shows that without a manual
reload. A parent sees the same list with the reasons behind every priority, can pin an item to the
top, remove one for the day and set how many minutes a day Today may ask for.

## Changed
- Migration `0012_today_planner.sql` (0011 is taken by the unmerged Toán 5 profile branch):
  `app.planner_config` (versioned JSON, version 1 seeded), `app.planner_settings` (minutes a day
  per child), `app.today_plans`, `app.today_plan_items`; `app.calendar_events.skill_ids`;
  `ops.request_today_plans()` + pg_cron `vionx-today-plans` (minute 10 of every hour). Household
  id + index, cascade from the student, RLS on, no client grants.
- Domain (`packages/domain/src/planner`): config, the §11 priority with `reasons[]`, 8 candidate
  generators (ParentTasks, Homework, ReadingGoal, ActivityGoal, ExamPrep, WeakPrerequisite,
  DueReview, NextSkill), session length by grade, free time and daily budget, the merge with the
  day's pins/skips/removals, item action rules. 30 tests, 9 with fast-check.
- Contracts: `packages/contracts/src/planner.ts`; `skillIds` on calendar events; client types.
- API (`supabase/functions/api/planner`):
  - `GET /v1/students/{id}/today` (parent, or the child for their own id).
  - `POST /v1/students/{id}/today/recalculate`.
  - `POST /v1/today-items/{id}/start|complete|skip` (child).
  - `POST /v1/today-items/{id}/pin|remove` (parent, audited).
  - `PUT /v1/students/{id}/today/settings` (parent, audited).
  - `POST|PATCH` calendar events accept and return `skillIds`.
- Worker: `planner.day_start_requested` (plans for children without one today);
  `task.assigned|completed|approved|rejected` and `learning.session_finished` regenerate the
  child's plan.
- Privacy export gains `today_plans.json` and `planner_settings.json`; `calendar_events.json` gains
  `skill_ids`.
- Mobile, child: `child-home.tsx` is Today (`TodayCard`, time bar, cap bar, start / done / skip,
  reload on focus); `practice.tsx` accepts `skillIds`.
- Mobile, parent: `today/[id].tsx` (reasons, pin, remove, minutes a day), button on the child
  page; the event form offers subject and topics for an exam.
- Maestro: `apps/mobile/.maestro/m07-today.yaml`. Acceptance: `scripts/acceptance/m07.ts`.
- Repo `CLAUDE.md`: the commands line no longer lists `db:start | db:reset` (open item of M06).

## Evidence
Everything ran on 2026-11-17 on the two Supabase Cloud projects in Singapore, with the functions
of this branch served on the Mac by Deno. Migration 0012 was applied to both with
`scripts/db-migrate.ts`.

- `pnpm check:static` (lint, typecheck incl. `deno check`, unit tests, openapi diff): exit code 0,
  run again after the last change.

  | Package | Tests (M06 → M07) |
  |---|---|
  | domain | 169 → 199 |
  | functions (unit) | 110 → 110 |
  | mobile (Vitest) | 45 → 53 |
  | mobile (Jest) | 32 → 37 |

- `PORT=54341 node --env-file=.env.test scripts/cloud.mjs pnpm check` on the **test project**:
  exit code 0. Integration: 8 files, 158 tests (141 before, +17 in the new
  `tests/integration/planner.test.ts`).
- `pnpm cloud pnpm acceptance m07` on the **development project** (real Toán 6, 500 items):
  9 passed, 0 failed, 1 skipped (Maestro). The first run had 1 failure caused by the scenario
  itself (it read a column `amount` that `app.xp_ledger` does not have); the query was corrected
  and the whole scenario run again. That second output is below.
- Maestro `m07-today.yaml`: written, **not run** (no emulator). No evidence.
- The screens (`child-home.tsx`, `today/[id].tsx`, the exam part of `event-form.tsx`) were **never
  rendered on a device or emulator**. `TodayCard` and the helpers have Jest/Vitest tests; the
  screens themselves only pass the typecheck. No evidence that they look or behave right.
- Android build: **not built.** No evidence. (M07 adds no native module.)
- The M07 functions are **not deployed**; the development project still runs the M06 build.
- AI cost: US$0. The module makes no model call.

### Result lines (copied from the runs)

`pnpm check:static`:
```
 Tasks:    8 successful, 8 total
OpenAPI document and client types are up to date.
```

`pnpm check` on the test project, integration part:
```
 Test Files  8 passed (8)
      Tests  158 passed (158)
   Start at  18:10:13
   Duration  719.10s (tests 99%, import 1%)
```

`tests/integration/planner.test.ts` alone (before the full run):
```
 Test Files  1 passed (1)
      Tests  17 passed (17)
   Duration  86.30s (tests 99%, import 1%)
```

`pnpm cloud pnpm acceptance m07`:
```
Acceptance M07 — Today planner

PASS  Toán 6 library is present; two Grade 6 children and one Grade 2 child sign in (94866 ms)
      Toán 6: 500 items; exam topic "Phân số và so sánh phân số"
PASS  A day with nothing assigned still has a plan; every item has reasons; session length by grade (23044 ms)
      Grade 6: 1 item(s), 25' each, budget 75'; Grade 2: 2 item(s), 15' each, budget 45'; first item: NEXT_SKILL "Nhận biết trục đối xứng của hình phẳng" 10 [NEXT_IN_CURRICULUM 10]
PASS  A. An exam in 3 days on 2 skills → exam-prep items rank above optional tasks (30522 ms)
      order: EXAM_PREP 66 > EXAM_PREP 66 > HOMEWORK 40 > PARENT_TASK 32 > READING_GOAL 22 > ACTIVITY_GOAL 12 > NEXT_SKILL 10; exam prep: EXAM_PREP "Phân số có tử hoặc mẫu là số nguyên âm" 66 [EXAM_SOON 24, NEXT_IN_CURRICULUM 10, EXAM_RELEVANT 32]
PASS  B. Finishing a session refreshes Today without a manual recalculation (88620 ms)
      3 answers → "Phân số có tử hoặc mẫu là số nguyên âm" DONE on the next read (version 2 → 3), +15 XP once; other exam skill now 65.8 (-0.2 workload)
PASS  Tasks through Today: complete (idempotent), required tasks cannot be skipped (43881 ms)
      homework DONE once (replay stored nothing), required skip → 409 REQUIRED_ITEM, optional "Đá bóng" SKIPPED; done 35'
PASS  Time budget: timetable free time and the parent setting (48732 ms)
      free 930' → 660' with school 07:00-11:30; setting 20' → required task fits, 3 optional item(s) "if there is time"; default again 45'
PASS  Parent sees reasons, pins an item to the top and removes one for the day (54355 ms)
      pinned "Đọc truyện" → first for parent and child; removed "Hỗn số dương" → hidden from the child, REMOVED for the parent; both undone; 4 audit rows
PASS  Day start: the hourly job writes the plan of a child that has none (14238 ms)
      plan written by the worker (version 1, 1 item(s), request 1); pg_cron "vionx-today-plans" at 10 * * * *
PASS  Another household gets 404 on every Today route (7251 ms)
      9 calls with another household’s parent or child → 404 each
SKIP  Maestro flow apps/mobile/.maestro/m07-today.yaml (child home = Today, parent pin) (0 ms)
      needs an Android emulator with the development build (not available here)

9 passed, 0 failed, 1 skipped
```

## Decisions
- **The plan is derived data.** One function (`api/planner/regenerate.ts`) reads the facts of a
  child, runs the pure rules and stores the plan in place; `version` grows only when the content
  changed. It runs at day start, on the task and session events (worker), on `recalculate`, on
  every item action, and on `GET …/today` when the stored plan is stale: a source row (task day,
  task, finished session, skill state, calendar event, timetable, setting) changed after
  `generated_at`, or the plan is older than 15 minutes. That read path is what makes a finished
  session show at once; the app does not wait for the worker.
- **No query library in the app.** The app has no react-query; "query invalidation" is the home
  screen reading Today again when it regains focus (the pattern the calendar screen already uses).
- **Priority (§11)**, weights in `planner_config`: urgency 30, prerequisite gap 20, forgetting
  risk 20, curriculum importance 10, exam relevance 40, parent priority 20, workload penalty 15.
  A required task due today has urgency 1, an optional one 0.4. Exam closeness is
  `1 − days / 15` and counts for urgency and exam relevance. Ties: kind order, then the item key.
- **Exam skills.** `calendar_events.skill_ids` (`skillIds` in the API, at most 50). An exam
  without a list prepares the 2 weakest skills of its subject. School subject codes map to
  library subjects in `LIBRARY_SUBJECT_OF` (TOAN → math, TIENG_VIET → viet, NGU_VAN → lit,
  TIENG_ANH → eng, KHTN → sci, TNXH → natsoc). Skill ids are not checked against the library; an
  unknown id is ignored.
- **Routes beyond the task pack list**: `pin`, `remove`, `PUT …/today/settings`. The task pack's
  UI section needs them.
- **Generator beyond the task pack list**: `NEXT_SKILL`, the next step of the learning path per
  subject (curriculum progress is a §11 input). Without it a child with no task and nothing due
  has an empty Today.
- **Complete.** `POST /v1/today-items/{id}/complete` hands task items to
  `POST /v1/tasks/{id}/complete` inside the api, so proof checks, idempotency, events and
  notifications have one owner. Learning items answer 409 `SYSTEM_VERIFIED_ONLY`.
- **A learning item is done when a session finished today covers its skill** (at least one
  answer; a review item: a REVIEW session of the subject). There is no link column between a
  session and an item, so a session started from the Learn screen completes the item too.
- **Budget.** Parent setting or 3 sessions (G1-3 45', G4-6 75', G7-9 105', G10-12 135'), never
  above the free time of 06:00-21:30 minus timetable and timed calendar events. Required and
  pinned items always fit; the others fit in priority order. Items beyond the budget stay in the
  list as "if there is time". At most 6 learning items are proposed.
- **Session length** 15/25/35/45 minutes is the planning length of a learning item. The M06
  session keeps its own limit (15 or 25 minutes); Grade 7-12 sessions are therefore shorter than
  the card says.
- **Skip** is for optional items and lasts the day; **remove** is the parent's and hides the item
  from the child for the day. Neither touches the task or the skill. A removed task that the child
  then completes through the task list shows as done again.
- **Parent reads of Today are not audit-logged**, the same as the knowledge map (M06) and the
  wallet (M04). Pin, remove and the setting are.
- **Day start** runs in one transaction for up to 500 children a run (comment in
  `generateMissingPlans`); enough for the alpha, to be split per child later.

## Privacy & security impact
- New personal data: Today plans and items (titles of the family's own tasks and exams, skill ids,
  status), the minutes-a-day setting, exam skill ids on calendar events. All household-scoped,
  removed with the child (cascade), included in the household export.
- No consent gate: the planner is core service and calls no AI.
- Another household gets 404 on all 8 routes (integration test with 10 calls, acceptance with 9).
  A child cannot pin, remove or change the setting (403); a parent cannot start, skip or complete.
- The development project now has pg_cron `vionx-today-plans`. Its deployed worker is the M06
  build, which acknowledges `planner.day_start_requested` without doing anything.

## Owner actions
- On an Android phone or emulator: rebuild the development build, run
  `maestro test apps/mobile/.maestro/m07-today.yaml`, and look at the child home and the parent
  Today screen. Nothing in this module was seen on a screen.
- Deploy `api` and `worker` of this branch to the development project when the branch is accepted
  (not done here). Until then the installed app cannot call the Today routes there.
- `m06-practice` and `m07-today-planner` are local branches: not pushed, no PR.

## Known issues / follow-ups
- The workload penalty counts the real minutes of finished sessions (a 1-minute test session lowers
  the other items by 0.2), while `doneMinutes` counts the planned 25 minutes of the card. Both are
  defensible; they should be shown to the owner before parents read the numbers.
- A plan kept by `maxAgeMinutes` only: deleting a calendar event or a timetable entry leaves no
  changed row, so Today can show its exam prep for up to 15 minutes.
- On a project whose deployed worker is older than M07, that worker can take a
  `planner.day_start_requested` event before the local one; the acceptance step sends the request
  again in that case (it needed 1 request in the run above).
- Skipped items come back the next day with no memory of the skip.
- The worker handlers of M07 have no unit test of their own; the integration test and the
  acceptance cover day start and the session event through the served worker.
- English plan, Health Connect activity and reading logs are task-based here (M16/M18).
- Still open from M06: `pnpm acceptance m05` fails one step on this Mac (`pnpm -s`); the one-off of
  three failing consent tests in `privacy.test.ts` did not show in this run (158 of 158).

## What the next module can rely on
- `GET /v1/students/{id}/today` for the parent dashboard (M08): items with `kind`, `status`,
  `minutes`, `priority`, `reasons[]`, `plannedMinutes`, `doneMinutes`, `budgetMinutes`.
- `app.today_plans` / `app.today_plan_items` keep one plan per child and day (history of what was
  planned and done).
- `regenerateToday(tx, householdId, studentId, at)` for any new event that should change Today.
- `calendar_events.skill_ids` for exams; `LIBRARY_SUBJECT_OF` for school subject ↔ library subject.

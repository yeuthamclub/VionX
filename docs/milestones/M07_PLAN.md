# M07 Plan — Today planner

Branch `m07-today-planner` (from `m06-practice` at 53b1577; M06 is not merged). Scope:
`TASK_PACKS/M07.md`, Master Spec §11. No AI calls.

## Assumptions
- **Migration 0012** (0011 is taken by the unmerged `x02-math5-profile`).
- **The plan is derived data.** One function (`api/planner/regenerate.ts`) reads the facts of a
  child, runs the pure rules (`packages/domain/src/planner`) and stores the plan in place. It is
  called on day start (pg_cron hourly → `planner.day_start_requested`), by the worker on
  `task.assigned|completed|approved|rejected` and `learning.session_finished`, by
  `POST …/today/recalculate`, and by `GET …/today` when the stored plan is stale (a source row
  changed after `generated_at`, or the plan is older than `maxAgeMinutes`). The last one is what
  makes a finished session show without waiting for the worker.
- **Exam skills.** `app.calendar_events` gets `skill_ids uuid[]` (`skillIds` in the event API). An
  exam without a list prepares the 2 weakest skills of its subject. School subject codes map to
  library subjects in `LIBRARY_SUBJECT_OF` (TOAN → math …).
- **Extra routes beyond the task pack list**, needed by its own UI section: parent
  `POST /v1/today-items/{id}/pin|remove`, `PUT /v1/students/{id}/today/settings` (daily minutes).
- **Extra generator `NEXT_SKILL`** (curriculum progress is a §11 input; without it a child with no
  tasks and nothing due has an empty Today).
- **Complete.** `POST /v1/today-items/{id}/complete` forwards task items to
  `POST /v1/tasks/{id}/complete` (one owner of proof checks, idempotency, events). Learning items
  answer 409 `SYSTEM_VERIFIED_ONLY`; they become DONE when a session finished today covers them.
- **Session length** (15/25/35/45 minutes by grade band) is the planning length of a learning
  item. The M06 session itself still uses its own limit (15 or 25 minutes); not changed here.
- **Budget** = parent setting, or 3 sessions, never above the free time of the day window
  (06:00-21:30 minus timetable and timed events). Required and pinned items always fit.

## Steps (`step → verify`)
1. Migration `0012_today_planner.sql` → applied on the test project. **Done.**
2. `packages/domain/src/planner` → 30 tests, 9 fast-check properties, green. **Done.**
3. Contracts, `api/planner` (8 routes), calendar `skillIds`, worker handlers, privacy export,
   `pnpm openapi` → typecheck (tsc + deno check) green. **Done, not yet exercised against a
   database.**
4. `tests/integration/planner.test.ts` (config equals the domain default, RLS/grants, lifecycle,
   exam ranking, session → DONE, pin/remove/skip, cross-household 404 on every route) and unit
   tests for the worker handlers. **To do.**
5. Mobile: child home = Today cards (duration, reward hint, cap bar), query invalidation after a
   session; parent Today with reasons, pin/remove, daily minutes; exam skills in the event form;
   i18n vi/en; Jest/Vitest. **To do.**
6. `apps/mobile/.maestro/m07-today.yaml`, `scripts/acceptance/m07.ts`. **To do.**
7. `pnpm check:static`; `pnpm check` on the test project; `pnpm db:migrate` + `pnpm acceptance m07`
   on the development project. **To do** (0012 is not applied on the development project yet).
8. `M07_REPORT.md`, ROADMAP DONE, repo `CLAUDE.md` commands line. **To do.**

## Out of scope
Parent dashboard and gradebook (M08), offline queue and push (M09), English plan, Health Connect
activity and reading logs (M16/M18: task-based here), AI tutor.

## Status (2026-11-17, session 1)
Stopped at step 3 (usage limit of the session). Not run yet: lint/prettier, the full unit suite,
any API call against a database. ROADMAP stays TODO.

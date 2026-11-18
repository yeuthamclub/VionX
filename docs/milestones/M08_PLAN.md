# M08 Plan — Parent dashboard & gradebook

Branch `m08-parent-dashboard` (from `m07-today-planner` at 6e3e4c9; M06 and M07 are not merged).
Scope: `TASK_PACKS/M08.md`, Master Spec §7, §12. No AI calls. Started on the owner's word
("làm việc tiếp theo") on 2026-11-17.

## Assumptions
- **Migration 0014** (0011 is the unmerged Toán 5 profile, 0012-0013 are M07).
- **Never merged.** School grades and app mastery are returned in separate fields and in
  `sideBySide` as two objects per subject. No rule or query combines them into one number, and a
  grade never changes mastery.
- **Sufficiency labels** (`INSUFFICIENT|LOW|OK`) come from `app.dashboard_config`: per skill 3/8
  answers, per subject 10/30 answers, grades 2/4 entries, activity 3/7 active days.
- **Improving / at risk** uses what M06 stores per skill (there is no mastery history): recent
  accuracy against overall accuracy (+0.10 improving, −0.15 at risk), or forgetting risk ≥ 0.6 on
  a skill the child has learned. Skills with INSUFFICIENT data are in neither list.
- **Streak** = consecutive household-local days with a completed task or a finished practice
  session; today without activity does not break it yet.
- **Summary table.** `app.student_day_summaries` (one row per child and day). The worker
  rebuilds the day of a task or session event; the dashboard rebuilds days that have no row yet
  and today before reading, so it is correct without the worker.
- **School grades in the dashboard** are those of the current school year (September to August),
  whatever the `range`; the range applies to tasks, practice, Coin and XP.
- **Attachments**: private bucket `assessment-files`, signed upload, signed 15-minute link on
  read. No OCR.
- **Chart: `react-native-svg`, not `victory-native`.** victory-native needs Skia, Reanimated and
  gesture-handler (three native modules); nothing native can be built or seen here (no
  emulator). A line of points drawn with the already installed `react-native-svg` shows the same
  trend. The owner confirmed keeping the SVG chart on 2026-11-17.
- **§43 flow**: the acceptance script runs it through the API (parent → 3 children → timetable
  and tasks → child → task and practice → XP → Coin within the cap → dashboard). The Maestro
  suite on two emulators is written but cannot be run here.

## Steps (`step → verify`)
1. Migration `0014_dashboard_gradebook.sql` → applied on the test project. **Done.**
2. `packages/domain/src/dashboard` → 16 tests, 4 fast-check properties. **Done.**
3. Contracts, `api/dashboard` (7 routes), worker summary refresh, orphan attachment cleanup,
   privacy export, `pnpm openapi` → typecheck green, 122 unit tests. **Done.**
4. `tests/integration/dashboard.test.ts` (config, RLS/grants, gradebook CRUD + audit, child
   cannot read or edit, dashboard numbers, side by side, cross-household 404). **Done.**
5. Mobile parent: home cards per child, child detail with 4 tabs, fast grade entry, trend chart;
   i18n; Jest/Vitest. **Done.**
6. `apps/mobile/.maestro/m08-*.yaml`, `scripts/acceptance/m08.ts`. **Done.**
7. `pnpm check:static`; `pnpm check` on the test project; `pnpm db:migrate` +
   `pnpm acceptance m08` on the development project. **Done.**
8. `M08_REPORT.md`, ROADMAP. **Done.**

## Out of scope
Offline queue and push (M09), OCR of test photos (backlog), admin analytics (M14), AI summaries
of progress, a child view of school grades.

## Status (2026-11-17)
All steps done on `m08-parent-dashboard`. Not built in the app: attachment picker, skill mapping
and editing or deleting a grade (API only). What ran and what could not be verified (the Maestro
suite, every screen, the Android build) is in `M08_REPORT.md`. Not pushed, no PR, functions not
deployed.

# M08 Report

## Summary
A parent now has a dashboard. The home screen shows one card per child: how much of Today is
done, the streak of active days, Coin today and this week, whether skills are improving or need
attention, and the next exam. A child's page has four tabs: Overview, Learning, School, Tasks &
rewards. School grades are entered with a short form (subject, kind of test, score) and appear
with their trend, and beside the app's own mastery of the same subject; the two are never
blended into one number. Every figure that interprets data says how much data it stands on
(not enough, little, enough). Only a parent can enter or change grades, and every change is
logged.

## Changed
- Migration `0014_dashboard_gradebook.sql`: `app.dashboard_config` (versioned JSON, version 1
  seeded), `app.school_assessments` (§12 fields), `app.school_assessment_skill_mappings`,
  `app.student_day_summaries`; private bucket `assessment-files`. Household id + index, cascade
  from the student, RLS on, no client grants.
- Domain (`packages/domain/src/dashboard`): sufficiency labels, ranges, school term of a day,
  grade percent and trend, streak, completion rate, skills improving / at risk, mastery per
  subject, attachment paths. 16 tests, 4 with fast-check.
- Contracts: `packages/contracts/src/dashboard.ts`; client types.
- API (`supabase/functions/api/dashboard`), parent only:
  - `GET|POST /v1/students/{id}/school-assessments`
  - `PATCH|DELETE /v1/school-assessments/{id}`
  - `POST /v1/students/{id}/school-assessments/upload-sign`
  - `GET /v1/students/{id}/dashboard?range=7d|30d|90d`
  - `GET /v1/household/overview`
- Worker: task and session events also rebuild the child's daily summary; tick maintenance
  removes attachment files no grade references after a day.
- Planner (M07 code): `freshPlan()` extracted from the Today route so the dashboard reads the
  same plan.
- Privacy export gains `school_assessments.json` and `day_summaries.json`.
- Mobile, parent: overview card per child on the home screen (`ChildOverviewCard`);
  `dashboard/[id].tsx` (four tabs, range chips, sufficiency badges, trend chart);
  `grade-form.tsx` (fast grade entry, "save and add another"); button on the child page.
- Maestro: `m08-parent.yaml`, `m08-child.yaml`, `m08-parent-after.yaml`,
  `subflows/m08-parent-sign-in.yaml`. Acceptance: `scripts/acceptance/m08.ts`.

## Evidence
Everything ran on 2026-11-17 on the two Supabase Cloud projects in Singapore, with the functions
of this branch served on the Mac by Deno. Migration 0014 was applied to both.

- `pnpm check:static` (lint, typecheck incl. `deno check`, unit tests, openapi diff): exit code 0.

  | Package | Tests (M07 → M08) |
  |---|---|
  | domain | 199 → 215 |
  | functions (unit) | 120 → 122 |
  | mobile (Vitest) | 53 → 57 |
  | mobile (Jest) | 37 → 41 |

- `PORT=54341 node --env-file=.env.test scripts/cloud.mjs pnpm check` on the **test project**:
  exit code 0, first run. Integration: 9 files, 175 tests (159 before, +16 in the new
  `tests/integration/dashboard.test.ts`). The function server logged no error during the run.
  This run also covers the final M07 code, for which no full green run existed (M07_REPORT).
- `pnpm cloud pnpm acceptance m08` on the **development project** (real Toán 6, 500 items):
  8 passed, 0 failed, 1 skipped (Maestro), first run. Output below.
- Maestro suite (three files, two devices): written, **not run** (no emulator). No evidence.
- The screens (`dashboard/[id].tsx`, `grade-form.tsx`, the cards on `parent.tsx`) were **never
  rendered on a device or emulator**. The card, badge, figure and chart components and the
  helpers have Jest/Vitest tests; the screens themselves only pass the typecheck. No evidence
  that they look or behave right.
- The §43 flow was run through the API by the acceptance script, not on phones.
- Attachments: upload through the signed URL, download through the signed link and removal with
  the grade ran in the integration test against Supabase Storage. Picking a photo in the app is
  not built (see Known issues).
- Android build: **not built.** No evidence. (M08 adds no native module.)
- The M08 functions are **not deployed**; the development project still runs the M06 build.
- AI cost: US$0. The module makes no model call.

### Result lines (copied from the runs)

`pnpm check:static`:
```
 Tasks:    8 successful, 8 total
OpenAPI document and client types are up to date.
```

`pnpm check` on the test project, integration part:
```
 Test Files  9 passed (9)
      Tests  175 passed (175)
   Duration  782.99s (tests 99%, import 1%)
```

`tests/integration/dashboard.test.ts` alone (before the full run):
```
 Test Files  1 passed (1)
      Tests  16 passed (16)
   Duration  62.08s (tests 99%, import 1%)
```

`pnpm cloud pnpm acceptance m08`:
```
Acceptance M08 — Parent dashboard & gradebook

PASS  §43: a parent signs up and creates 3 children, each with a Child ID and PIN (147989 ms)
      3 children signed in with vx-6guayv, vx-gtejbd, vx-6dpq47; overview has one card each; Toán 6: 500 items
PASS  §43: the parent adds a timetable and tasks; the child sees them in Today (35194 ms)
      timetable 07:00-11:30, 4 tasks → Today: PARENT_TASK, HOMEWORK, READING_GOAL, ACTIVITY_GOAL, NEXT_SKILL; dashboard tasks 0/4
PASS  §43: the child completes tasks and a practice session; mastery and XP are recorded (137663 ms)
      3 tasks done, 3 correct answers → mastery 17.79 on the skill; XP 3015 lifetime, 2000 rewardable (4 ledger rows)
PASS  §43: XP converts to Coin within the daily cap, and the dashboard shows it (42406 ms)
      3015 XP → 20 Coin (cap 20); dashboard: tasks 3/4, 1 session at 100%, streak 1, Today 4/5, Coin balance 20; siblings unchanged
PASS  B. A grade entry appears next to mastery, side by side and never merged (29445 ms)
      Toán: 4 grades, average 76.3% (UP, OK) beside app mastery 17.8/100 on 1 practised skill (INSUFFICIENT); mastery unchanged by the grades
PASS  Every interpretive figure carries a data sufficiency label (25224 ms)
      busy child: streak INSUFFICIENT, tasks INSUFFICIENT, practice INSUFFICIENT, Toán grades OK; idle Grade 2 child: all INSUFFICIENT, accuracy null
PASS  Only parents edit grades; every edit is audited (13556 ms)
      5 child calls → 403; 11/10 → 400; parent corrected one grade and deleted one; audit: created 4, deleted 1, updated 1
PASS  Another household gets 404 on every dashboard and gradebook route (18693 ms)
      6 calls with another household’s parent → 404 each; its overview lists only its own child
SKIP  Maestro suite on two emulators (apps/mobile/.maestro/m08-parent.yaml, m08-child.yaml) (0 ms)
      needs two Android emulators with the development build (not available here)

8 passed, 0 failed, 1 skipped
```

## Decisions
- **Started on the owner's word** ("làm việc tiếp theo") while M06 and M07 are unmerged; the
  branch is cut from `m07-today-planner`.
- **Never merged.** Grades and mastery are separate fields; `sideBySide` holds two objects per
  subject (`school`, `mastery`). Entering a grade changes no mastery row (integration test and
  acceptance check it).
- **Sufficiency thresholds** (`app.dashboard_config`): a skill 3 / 8 answers, a subject 10 / 30
  answers, grades 2 / 4 entries, activity 3 / 7 active days (LOW / OK). Below LOW the label is
  INSUFFICIENT and the home card says "not enough data" instead of showing skill counts.
- **Improving / at risk** uses what M06 stores per skill (there is no mastery history): recent
  accuracy at least 0.10 above the overall accuracy and practised inside the range = improving;
  0.15 below = at risk; a learned skill with forgetting risk ≥ 0.6 = at risk. At most 5 per list.
- **Streak**: consecutive household-local days with a completed task or a finished practice
  session, looked up over the last 30 days. Today without activity does not break it yet.
- **Grades in the dashboard** are those of the current school year (September to August)
  whatever the range; trend = mean of the newer half minus the mean of the older half, FLAT below
  5 percent points. Scores are compared as percent of their maximum, so 18/20 and 9/10 are equal.
- **School year and semester default from the date** (HK1 September to mid January, HK2 to the
  end of May, then summer); the parent can send other values.
- **Daily summaries.** `app.student_day_summaries` is derived data. The worker rebuilds the day
  of a task or session event; the dashboard rebuilds days without a row and today before reading.
  A late change to a past day (a task of yesterday approved today) reaches the summary through the
  worker event only.
- **Coin today** is the projection the wallet's cap bar already shows; Coin of the week and of
  the range are the day-end conversions in the Coin ledger.
- **Chart: `react-native-svg`, not `victory-native`** (a deviation from the task pack).
  victory-native needs Skia, Reanimated and gesture-handler, three native modules that cannot be
  built or seen here. The chart is a line of dots drawn with the already installed
  `react-native-svg`. To be confirmed by the owner.
- **Overview** builds the 7-day dashboard of each child, one child after the other; fine for a
  family, to be slimmed if a household ever has many children.
- **A child has no access** to grades, the dashboard or the overview (403).
- **Parent reads are not audit-logged**, as in M04, M06 and M07; grade create, update and delete
  are.

## Privacy & security impact
- New personal data: school grades with teacher comments and optional photos or PDFs of tests,
  daily activity totals. Household-scoped; removed with the child (cascade; orphan files are
  removed by the worker within a day); included in the household export.
- Attachments live in a private bucket with no storage policies; the app only gets signed URLs
  (upload 2 hours, download 15 minutes). A path is accepted only if it was issued for that child
  and the file exists. No OCR, nothing is sent to an AI.
- Another household gets 404 on all 7 routes (integration test with 6 calls plus the overview,
  acceptance with 6); a child gets 403.
- No consent gate: grades are entered by the parent and the dashboard shows data the app already
  holds under CORE_SERVICE.

## Owner actions
- On two Android emulators or phones: rebuild the development build and run the three Maestro
  files in the order given at the top of `m08-parent.yaml`. Look at the parent home, the four
  tabs and the grade form: nothing in this module was seen on a screen.
- Decide on the chart library (keep the SVG chart, or add victory-native with its native
  modules).
- Deploy `api` and `worker` of this branch to the development project when the branches are
  accepted. Until then the installed app cannot call the dashboard routes there.
- `m06-practice`, `m07-today-planner` and `m08-parent-dashboard` are local branches: not pushed,
  no PR. Each is cut from the one before.

## Known issues / follow-ups
- The grade form has no attachment picker yet: the API, storage and cleanup are done and tested,
  the app cannot yet choose a photo or PDF. Mapping a grade to skills (`skillIds`) and topic tags
  are also API-only.
- Grades can be entered and listed in the app, but not corrected or deleted there (API only).
- The overview costs about one dashboard per child (15 queries each); on the remote development
  database that is a few seconds for three children.
- "Improving / at risk" needs several answers per skill before it says anything; with the
  launch libraries a new family sees "not enough data" for the first days. That is intended, but
  the thresholds are first guesses.
- The connection from this Mac to the cloud databases stalled several times earlier the same
  evening (M07_REPORT); the M08 runs did not hit it.
- Still open from M06: `pnpm acceptance m05` fails one step on this Mac (`pnpm -s`).

## What the next module can rely on
- `GET /v1/household/overview` and `GET /v1/students/{id}/dashboard` for notifications and
  offline caching (M09).
- `app.student_day_summaries` and `refreshDaySummaries(db, student, days)` for anything that
  needs daily totals.
- `app.school_assessments` with skill mappings; `schoolTermOf(day)`, `sufficiency()`,
  `gradeTrend()` in `@vionx/domain`.
- `freshPlan(sql, student, at)` for today's plan from any route.

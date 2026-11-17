# M06 Report

## Summary
A child can now practise. From the new Learn screen they see the knowledge map of their grade
(subject → topics → skills, each with a mastery state), start a topic and answer items one by one.
The first session on a topic is a 10-item diagnostic that places every skill of the topic; later
sessions give 70% of their slots to the current skills and 30% to reviews that are due. Each item has
a ladder of 4 pre-written hints, feedback for the wrong option chosen and a worked solution; none of
this calls AI. TEMPLATE items show new numbers every time and are judged against the seed that was
served. Grade 1-3 children get large buttons, an on-screen number pad, tap-to-order and tap-to-match,
sessions of 10 items / 15 minutes, encouraging feedback and read-aloud by default. A finished session
gives XP once. Parents see the state of every skill of their child.

## Changed
- Migration `0010_learning.sql` (0011 is taken by the unmerged Toán 5 profile branch). Schema `app`:
  `mastery_config` (versioned JSON, version 1 seeded), `learning_sessions`, `answer_attempts`,
  `student_skill_states` (§10.1 fields), `review_schedule`, `mistake_patterns`,
  `student_item_history`. Every child-data table has `household_id` + index and a cascading foreign
  key to the student; RLS on; no client grants. `ops.learning_nightly()` + pg_cron
  `vionx-learning-nightly` (18:30 UTC).
- Domain (`packages/domain/src/mastery`): `MasteryStrategy` interface and
  `WeightedMasteryStrategy` (`delta = correctness × difficulty × independence × recency`), display
  states, Mastered/Retained marks, diagnostic placement, session shape and XP, slot plan (70/30),
  skill and item selection, new seeds, SM-2-like review schedule, forgetting risk, answer judging for
  the 10 practice item types, learning path. 32 tests with 10 fast-check properties.
- Contracts: `packages/contracts/src/learning.ts`; types exported from `@vionx/contracts/client`.
- API (`supabase/functions/api/learning`):
  - `POST /v1/learning/sessions` (child; idempotent by `clientUuid`; DIAGNOSTIC, PRACTICE or REVIEW).
  - `GET /v1/learning/sessions/{id}/next` (same item until answered; never contains the answer).
  - `POST …/answers` (idempotent by `clientUuid`; 409 when not the current item; 400 when the
    response does not fit the item type), `POST …/hint`, `POST …/finish` (idempotent).
  - `GET /v1/students/{id}/knowledge-map`, `GET /v1/students/{id}/learning-path` (parent, or the
    child for their own id).
  - `POST /v1/items/{id}/report` (stores reason and seed, never who reported).
- Rewards: `_shared/rewards.ts` now has one shared grant path (`grantXp`) used by the M04 task grant
  and the new `grantSessionXp`. Worker handler `learning.session_finished`.
- Privacy export gains `learning_sessions.json`, `answer_attempts.json`, `skill_states.json`,
  `mistake_patterns.json`, `item_history.json`.
- Mobile, child: `learn.tsx` (knowledge map, due reviews, next step), `practice.tsx` (item, hint
  ladder, feedback, report, summary), button on the child home. Components in `src/ui/practice/`:
  `ItemView` (renderers for single/multi/picture/spelling choice, true/false, numeric keypad, fill
  blank, word bank, ordering, matching), `GroupStimulus` (collapsible passage), `RichText` (KaTeX),
  `Media` (SVG), `SpeakButton`, `StateBadge`. Parent: `mastery/[id].tsx` (per-skill state list) and a
  button on the child screen. vi/en strings. Loading, empty, error and offline states through the
  existing `StateView`.
- Mobile dependencies: `expo-speech`, `react-native-svg`, `react-native-webview`, `katex@0.18.9`.
  These are native modules: the development build has to be rebuilt.
- Test tooling: `scripts/lib/learning-solver.ts`; `scripts/lib/library-reset.ts` now also removes the
  learning rows of the scope it resets (they reference its items and skills).
- Maestro: `apps/mobile/.maestro/m06-practice.yaml`.
- Development environment (ADR-002, own commit): `pnpm cloud`, `pnpm fn:serve` (Deno, port 54331),
  `pnpm db:migrate`; `db:start`, `db:stop`, `db:reset` removed; `resetLibraryScope` refuses a
  grade-subject with more than 50 items.

## Evidence
Environment: local Supabase (Docker) stopped answering during the work and the product owner dropped
Docker for development (ADR-002). Everything below ran on 2026-11-17 against the **Supabase Cloud
development project in Singapore** (Free plan, empty before this work, migrations 0001-0010 and
`seed.sql` applied), with the functions of this branch served on the Mac by Deno (`pnpm fn:serve`).
The database content changed during the day, so each result says what it ran on:

1. real Toán 6 (500 items) + M05 fixtures for Toán 2 (6 items) and Tiếng Việt 2 (7 items);
2. M05 fixtures only (the Toán 6 copy was removed for the full `pnpm check`, then imported again);
3. the four reviewed libraries, imported through `POST /v1/admin/library/import` (dry-run, then
   apply; no warnings). Counted with SQL afterwards, all APPROVED:

   | Library | Items | TEMPLATE |
   |---|---|---|
   | Toán 2 | 510 | 231 |
   | Tiếng Việt 2 | 500 | 50 |
   | Toán 5 | 500 | 225 |
   | Toán 6 | 500 | 200 |

   Toán 5 has no subject profile on this branch (it is on `x02-math5-profile`); the import does not
   need one, the admin coverage screen does.

- `pnpm check:static` (lint, typecheck incl. `deno check`, unit tests, openapi diff): exit code 0.
  ```
  Tasks:    8 successful, 8 total
  OpenAPI document and client types are up to date.
  ```

  | Package | Tests (M05 → M06) |
  |---|---|
  | domain | 137 → 169 |
  | functions | 96 → 110 |
  | mobile (Vitest) | 34 → 45 |
  | mobile (Jest) | 15 → 32 |

- API integration, `tests/integration/learning.test.ts` (new, 15 tests): green on content 1 and 2.
  Covers the stored config, RLS and grants, no student ids in schema `library`, session lifecycle,
  hint ladder, idempotent answers and finish, 409/400 cases, consent off → no per-answer rows,
  item reports, the nightly aggregate, session XP through the worker (once, also after a replayed
  event), and 404 for another household on all 8 child-data calls.
- Acceptance `pnpm acceptance m06`: 8 passed, 0 failed, 2 skipped, on content 1 and again on content 3
  (the real Toán 2 and Tiếng Việt 2 libraries). Both outputs are below.
- `pnpm check` as one command: run once, on content 2. **Exit code 1**: 140 of 141 integration tests
  pass; the one failure is the phone-OTP sign-in test, which needs a setting of the cloud project
  (below). `tests/integration/library.test.ts` and `pnpm acceptance m05` import fixtures into
  Toán 6, Toán 2 and Tiếng Việt 2, so they only run on a database without those reviewed libraries.
- `pnpm check` on a second, empty cloud project made for tests (`.env.test`, migrations and seed
  applied with `pnpm db:migrate` / `db:seed`): the first run showed a real defect, since
  `learning.test.ts` runs before `library.test.ts` and found no Toán 6 items on a fresh database (15
  tests skipped; CI would have hit the same). The test now imports the M05 Toán 6 fixture when the
  library is empty. Second run from an empty library: again 140 of 141, only the phone-OTP test
  fails. Duration 553.72 s.
- Guard: with content 3 in place, `resetLibraryScope(sql, 6, 'math')` was called once. It refused
  ("holds 500 items, more than a test fixture (50)") and the counts did not change.
- Maestro `m06-practice.yaml`: written, **not run** (no emulator). No evidence.
- Read-aloud: the app calls `expo-speech` with `vi-VN` / `en-US` (Jest checks the call); the
  acceptance checks that every served Grade 2 item has Vietnamese text to read. **The voice itself
  was not heard on a device.** No evidence.
- Android build with the three new native modules: **not built.** No evidence.
- AI cost: US$0. The module makes no model call (`ops.ai_runs` stayed empty during the acceptance).

### Result lines (copied from the runs)

`pnpm check:static`:
```
 Tasks:    8 successful, 8 total
OpenAPI document and client types are up to date.
```

`tests/integration/learning.test.ts` alone, content 1:
```
 Test Files  1 passed (1)
      Tests  15 passed (15)
   Duration  350.35s (tests 100%)
```

`pnpm acceptance m06`, content 3 (four reviewed libraries):
```
Acceptance M06 — Practice sessions, mastery, T0 hints, template variants, Grade 1-3 mode

PASS  Libraries are present; three Grade 6 children and one Grade 2 child sign in (122266 ms)
      math 2: 510 items, viet 2: 475 items, math 6: 500 items
PASS  Diagnostic on "Phân số" → 10 correct answers → Proficient (142988 ms)
      "Phân số và so sánh phân số" (6 skills): 10/10 → PROFICIENT, score 80; xp 50; next session is PRACTICE
PASS  With hints, the mastery delta is smaller (43253 ms)
      no hint +4.8, 4 hints +0.96; worked solution only at level 4; AI runs in the last 10 min: 0
PASS  A TEMPLATE item shows different numbers on retry and is judged against that seed (58589 ms)
      seed 541726974: "Một thửa đất hình thang có hai đáy 9 m và 4 m, chi" → seed 3494826971: "Một thửa đất hình thang có hai đáy 10 m và 5 m, ch"; the old answer is judged wrong, correctAnswer follows the new seed
PASS  A due review appears the next day (140396 ms)
      interval 1 day; after one day the path starts with REVIEW_DUE and item 4 of 10 was the review (1 review slot used, then none due)
PASS  XP is granted once per session (112468 ms)
      10 correct → 50 XP in one ledger row; second finish and a replayed event add nothing; wallet lifetime XP 50
PASS  A Grade 2 child completes a Toán 2 session using only taps; every item can be read aloud in Vietnamese (137980 ms)
      "Số và phép tính": 10/10 by taps (picture_choice×2, numeric×5, matching×2, ordering×1); stem and options of every item have Vietnamese read-aloud text. The voice itself needs a device (see the skipped step).
PASS  A passage group shows its passage and 3 linked items (55750 ms)
      "Chiếc lá còn xanh" (417 characters): 4 linked items served consecutively, each with the passage (positions 1, 2, 3, 4 of 4)
SKIP  Read-aloud voice on a device (expo-speech, Vietnamese TTS) (0 ms)
      needs an Android device or emulator with a Vietnamese TTS voice (not available here)
SKIP  Maestro flow apps/mobile/.maestro/m06-practice.yaml (1 ms)
      needs an Android emulator with the development build (not available here)

8 passed, 0 failed, 2 skipped
```

`pnpm acceptance m06`, content 1 (real Toán 6, fixtures for Grade 2):
```
Acceptance M06 — Practice sessions, mastery, T0 hints, template variants, Grade 1-3 mode

PASS  Libraries are present; three Grade 6 children and one Grade 2 child sign in (120002 ms)
      math 2: 6 items, viet 2: 6 items, math 6: 500 items
PASS  Diagnostic on "Phân số" → 10 correct answers → Proficient (142146 ms)
      "Phân số và so sánh phân số" (6 skills): 10/10 → PROFICIENT, score 80; xp 50; next session is PRACTICE
PASS  With hints, the mastery delta is smaller (43503 ms)
      no hint +8, 4 hints +0.96; worked solution only at level 4; AI runs in the last 10 min: 0
PASS  A TEMPLATE item shows different numbers on retry and is judged against that seed (120852 ms)
      seed 689108311: "Sân hình chữ nhật dài 18 m, rộng 11 m. Cần bao nhi" → seed 1033807078: "Sân hình chữ nhật dài 14 m, rộng 9 m. Cần bao nhiê"; the old answer is judged wrong, correctAnswer follows the new seed
PASS  A due review appears the next day (140298 ms)
      interval 1 day; after one day the path starts with REVIEW_DUE and item 4 of 10 was the review (1 review slot used, then none due)
PASS  XP is granted once per session (120163 ms)
      10 correct → 50 XP in one ledger row; second finish and a replayed event add nothing; wallet lifetime XP 50
PASS  A Grade 2 child completes a Toán 2 session using only taps; every item can be read aloud in Vietnamese (147746 ms)
      "Số và phép tính": 10/10 by taps (single_choice×4, true_false×1, ordering×1, numeric×3, picture_choice×1); stem and options of every item have Vietnamese read-aloud text. The voice itself needs a device (see the skipped step).
PASS  A passage group shows its passage and 3 linked items (45180 ms)
      "Buổi sáng trong vườn" (346 characters): 3 linked items served consecutively, each with the passage (positions 1, 2, 3 of 3)
SKIP  Read-aloud voice on a device (expo-speech, Vietnamese TTS) (0 ms)
      needs an Android device or emulator with a Vietnamese TTS voice (not available here)
SKIP  Maestro flow apps/mobile/.maestro/m06-practice.yaml (0 ms)
      needs an Android emulator with the development build (not available here)

8 passed, 0 failed, 2 skipped
```

`pnpm cloud pnpm check` (one command; for this run the database held only the M05 fixtures, see
below). Static part green, then the 7 integration files:
```
 ❯ tests/integration/identity.test.ts (25 tests | 1 failed) 282361ms
   ❯ parent authentication (3)
     × phone OTP (local test number) yields a JWT the api accepts 1095ms
Error: auth otp 400: {"code":400,"error_code":"phone_provider_disabled","msg":"Unsupported phone provider"}
 Test Files  1 failed | 6 passed (7)
      Tests  1 failed | 140 passed (141)
   Duration  2970.01s (tests 100%)
```
The one failure is the environment, not the code: the cloud project has no phone provider and no
test phone numbers (they were part of `supabase/config.toml` of the local stack). `pnpm check`
therefore exits 1 on this project until the owner sets them (Owner actions).

`pnpm cloud pnpm acceptance m05` (same database):
```
FAIL  `pnpm library:validate` accepts the fixtures and rejects the cycle (18 ms)
      gdpt2018/6-math: exit 2
error: unexpected argument '-s' found
7 passed, 1 failed, 0 skipped
```
That step calls `pnpm -s`, which the pnpm on this Mac does not accept. It is M05 code and was not
changed here (Known issues). `tsx scripts/library-validate.ts` itself accepts all four real packages.

## Decisions
- **Dependencies.** ROADMAP listed X01 IN_PROGRESS and X02 TODO; the product owner ordered M06 anyway.
- **`EDUCATION_ANALYTICS` off.** The session, its counters, the skill state and the review schedule
  are still stored (practice cannot work without them). `answer_attempts`, `mistake_patterns` and
  `student_item_history` are not written, so "prefer unseen items" then only holds inside one session
  and those children do not feed `library.item_stats`.
- **Diagnostic.** Answers do not move the score one by one. At finish every skill of the topic is
  placed at `80 × accuracy` (tested skills: half own, half topic accuracy; untested skills: topic
  accuracy × 0.75). 80 is below Mastered, so a diagnostic alone never gives Mastered.
- **Server time decides recency.** Answers on one skill less than 20 s apart count from 25% up. Tests
  and the acceptance move time by shifting the stored timestamps of their own throwaway students
  (one minute between answers, one day for the review), the way M04 chose event times. There is no
  test-clock switch in the API.
- **XP.** Rule id `LEARNING_CORRECT_ANSWER` (ledger format of the task pack's
  `learning.correct_answer`), 5 XP per correct answer, at most 100 per session and 10 rewarded
  sessions per day, from `mastery_config`. It is not part of the household reward rules, so parents
  cannot change it yet.
- **One attempt per item.** After a wrong answer the child sees the option's feedback and the
  explanation, then moves on. The worked solution appears after hint level 4, or in the summary.
- **Review schedule.** A correct answer before the review is due does not stretch the interval; a
  wrong answer always resets it to 1 day.
- **Ordering and matching by tapping, not dragging.** Tap the options in order; tap a left box, then
  its partner. This keeps Grade 1-3 children on taps only and needs no gesture library. A drag gesture
  can be added later without changing the API.
- **Math: KaTeX → MathML in a WebView.** `react-native-math-view` is unmaintained and has no New
  Architecture support. KaTeX runs in JS and outputs MathML, which Android WebView draws itself, so no
  KaTeX CSS or fonts are bundled. Text without `$` never opens a WebView.
- **A TEMPLATE item may return in the same session with a new seed** when every item of the session's
  skills has been served.
- **A session covers one subject and only the child's own grade.**
- **Parent reads of the knowledge map are not audit-logged**, the same as the M04 wallet read.

## Privacy & security impact
- New personal data: sessions, per-answer rows (only with `EDUCATION_ANALYTICS`), skill states, review
  schedule, mistake patterns, item history. All household-scoped through `scoped()`; sessions are
  reachable only by the child who owns them (404 otherwise, tested). All are removed with the child
  (cascade) and included in the household export.
- `library.item_stats` receives counts and rates only; `library.item_reports` has no reporter. An
  integration test checks that schema `library` has no student, household, session or user id column.
- The item sent to the app has no answer, feedback or solution (OpenAPI test and integration test).
- No consent gate blocks practice (core service); `EDUCATION_ANALYTICS` only controls what is stored.
  Revoking it later does not delete rows already stored (follow-up below).
- Speech stays on the device (`expo-speech`).
- Development project: besides the seed accounts it holds only throwaway test families
  (`…@vionx.test`), deleted at the end of each run. Three such accounts from interrupted runs are
  still there. Email confirmation is off there so the scripts can sign up; turn it on before any real
  user. The service-role key is in the git-ignored `.env.cloud` only.

## Owner actions
- Run on an Android phone or emulator: rebuild the development build, `maestro test
  apps/mobile/.maestro/m06-practice.yaml`, and listen to the Vietnamese voice on a Grade 2 item.
- Supabase dashboard of the development project, Authentication → Phone: enable the provider and add
  the test phone numbers of the README (OTP `123456`). Until then one identity test fails and
  `pnpm check` exits 1 there.
- Create a second (test) project for `pnpm check`, or rely on CI: the development project now holds
  the reviewed libraries, and the library tests refuse to run there.
- Deploy the functions (no Supabase CLI login exists on this Mac, so this was not done):
  `pnpm exec supabase login`, `pnpm exec supabase link --project-ref <ref>`, then the two commands
  under "Development" in the README. **Before deploying, replace the service secret**: the value in
  `seed.sql` is public in this repository, and a deployed worker would accept it. Set a new
  `VIONX_SERVICE_SECRET` with `supabase secrets set`, and the Vault entries `vionx_service_secret`
  and `vionx_worker_url` (SQL in the README).
- The seed accounts (`admin@vionx.local` and the demo family) exist on the cloud project with the
  passwords of the README. Delete them or change the passwords before any real family signs up.
- Merge `x02-math5-profile` (Toán 5 subject profile, migration 0011) when ready, then `pnpm db:migrate`.
- The old local Docker volume still holds its copy of the 2,010 items. It was not touched.

## Known issues / follow-ups
- **A full `pnpm check` needs a database without reviewed libraries.** `library.test.ts` and
  `pnpm acceptance m05` import fixtures into Toán 6, Toán 2 and Tiếng Việt 2. Since this module
  `resetLibraryScope` refuses a grade-subject with more than 50 items, so they fail fast instead of
  deleting a library. Giving the fixtures a grade-subject of their own needs a subject profile row
  (a new migration), so it was left for a decision.
- `pnpm acceptance m05`: the step that calls `pnpm -s library:validate` fails on this Mac
  ("unexpected argument '-s'"). M05 code, not changed here.
- Free plan: the project pauses after about a week without activity and has no backups. Not met
  during this work. The database is 27 MB of the 500 MB limit with the four libraries.
- Library import is slow on a remote database (row-by-row inserts in one transaction): 500 items took
  about 8 minutes from the Mac, and the first try lost its connection. Deployed next to the database
  it will be faster, but it should batch.
- The reviewed Toán 2 library has no `fill_blank` items, so a Grade 2 child never has to type there.
  Nothing stops a later package from adding some; the taps-only rule is not enforced at import.
- Media that is not inline SVG (`ICON`, `IMAGE` with a storage path) shows its description text only.
- Revoking `EDUCATION_ANALYTICS` does not delete earlier attempts, history and mistake patterns.
- `m06` is not in `ci.yml`: the CI database only has the small fixtures and the scenario needs a
  "Phân số" topic with 2 skills; that was not tried on fixtures alone.
- No Jest test renders the two screens themselves (components and helpers are tested).
- Offline: an answer that fails to send can be retried (same `clientUuid`), but nothing is queued
  while offline (M09).

## What the next module can rely on
- `GET /v1/students/{id}/learning-path` gives the ordered next steps (`REVIEW_DUE`, `CONTINUE`,
  `START`) that the Today planner (M07) can turn into tasks; `POST /v1/learning/sessions` with
  `nodeId` or `mode: 'REVIEW'` starts them.
- Event `learning.session_finished` (`eventName: LearningSessionFinished`; `studentId`, `sessionId`,
  `mode`, `subject`, `answeredCount`, `correctCount`, `hintsCount`, `xp`, `finishedAt`), idempotency
  key = session id. The XP grant emits the usual `xp.granted` with `sourceType: learning_session`.
- `app.student_skill_states` + `review_schedule` are the source for dashboards (M08); display states
  come from `displayState(config, state)` in `@vionx/domain`.
- To change weights or thresholds, insert the next version into `app.mastery_config`; to change the
  model, implement `MasteryStrategy`.

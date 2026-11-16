# M06 Plan — Practice sessions, mastery, T0 hints, template variants, Grade 1-3 mode

Branch `m06-practice` (from `main` at df9e0b3). Scope: `TASK_PACKS/M06.md`. No AI calls.

## Assumptions
- **Dependencies.** ROADMAP still lists X01 IN_PROGRESS and X02 TODO. The product owner ordered M06
  anyway on 2026-11-16: local Supabase already holds 2,010 APPROVED items imported through
  `POST /v1/admin/library/import` (Toán 2: 510, Toán 5: 500, Toán 6: 500, Tiếng Việt 2: 500). M06
  reads whatever APPROVED/PUBLISHED items exist; it does not need PR #10 or `x02-math5-profile`.
- **Migration number 0010.** `x02-math5-profile` (unmerged) already uses 0011, so 0010 is free.
- **Never reset the local database** and never run `pnpm acceptance m05` on it: both clear the real
  libraries. `pnpm acceptance m06` uses the libraries that are there and only creates throwaway
  families.
- **Clock.** Domain rules take `now` as an argument (unit tests inject it). The API tests and the
  acceptance script run against served functions, so they move time the M04 way: by shifting stored
  timestamps of their own throwaway student (`last_attempt_at`, `due_at`) back by a chosen amount.
  No test-clock header in production code.
- **`EDUCATION_ANALYTICS` off** means: the session, its counters and the per-skill state
  (`student_skill_states`, `review_schedule`) are kept, because practice cannot work without them;
  per-answer rows (`answer_attempts`), `mistake_patterns` and `student_item_history` are not written.
  "Prefer unseen" then only holds inside one session.
- **XP.** Rule id `LEARNING_CORRECT_ANSWER` (the ledger's `rule_id` format; task pack name
  `learning.correct_answer`), one ledger row per session (`source_type = learning_session`), amount
  `correct × xpPerCorrect` capped by `maxXpPerSession`, at most `maxSessionGrantsPerDay` sessions a
  day. Caps live in `mastery_config`, so household reward rules (M04) are untouched.
- **Math rendering: WebView KaTeX** (`react-native-webview` + bundled KaTeX), not
  `react-native-math-view`. Reasons: `react-native-math-view` is unmaintained (last release 2021, no
  New Architecture support, RN 0.86 here); KaTeX in a WebView renders exactly what the admin preview
  renders (same `katex` version), and stems without `$` skip the WebView entirely (plain `Text`), so
  Grade 2 screens stay light.

## Design
- **Mastery (§10.3).** `delta = correctness × difficulty × independence × recency`.
  correctness = `+gainCorrect` / `−lossIncorrect`; difficulty weight by item difficulty 1-5;
  independence = `max(minIndependence, 1 − hintPenalty × hints)`; recency = `recencyFloor … 1` linear
  in the time since the previous answer on that skill, full weight at `minIntervalSec`. Score 0-100.
  States (§10.2) from thresholds; Mastered sets `last_mastered_at`; Retained when a correct answer
  arrives ≥ `retentionMinDays` after that, lost when the score falls below Mastered.
- **Diagnostic.** First session on a topic, 8-12 items (default 10), difficulty steps ±1 with each
  answer, skills taken round-robin. Answers do not move the score one by one; at finish each skill of
  the topic is placed at `placementCeiling × accuracy` (tested skills: half own, half topic accuracy;
  untested skills: topic accuracy × `untestedFactor`). The ceiling is below Mastered.
- **Selection.** Slot i is a due review when `floor((i+1)·0.3) > floor(i·0.3)` and a review is due
  (exactly 30%); otherwise the weakest current skill. Item: difficulty within ±1 of the target (widen
  if empty), never-seen first, then TEMPLATE (new seed), then least recently seen; an item of a group
  pulls the rest of its group next, in order. `written` items are never served.
- **Review.** SM-2-like: quality 5/4/3 by hints, 1 when wrong; intervals `[1, 3]` days then
  `× ease`; `forgetting_risk = 1 − 0.5^(elapsed/interval)`.
- **API** (`supabase/functions/api/learning/`): the 8 routes of the task pack. The served item never
  contains its answer. The session row keeps the item being served (id, seed, hints used), so the
  answer is judged against the stored seed. Answers and session creation are idempotent by
  `clientUuid`.
- **Nightly** `ops.learning_nightly()` (pg_cron 18:30 UTC): `answer_attempts` → `library.item_stats`
  (counts and rates only), refresh `forgetting_risk`.

## Steps (`step → verify`)
1. Migration `0010_learning.sql` → applies on local Supabase; RLS on; no client grants.
2. `packages/domain/src/mastery` → `pnpm --filter @vionx/domain test` (unit + fast-check).
3. Contracts + `api/learning` + worker XP handler + privacy export → `pnpm openapi`, integration
   tests `tests/integration/learning.test.ts` incl. cross-household 404.
4. Mobile child: Learn tab → knowledge map → session → summary; parent per-skill list → Jest/Vitest.
5. `scripts/acceptance/m06.ts` (7 criteria) + `.maestro/m06-practice.yaml`.
6. `pnpm check`, `pnpm acceptance m06`.
7. `M06_REPORT.md`, ROADMAP, commit. No push, no PR.

## Out of scope
AI tutor T1-T3 (M15), `written` items (M17), Today planner (M07), parent dashboard/gradebook (M08),
offline queue (M09), admin screens for item stats/reports (M14).

## Status (2026-11-16, session 1)
Done and committed on `m06-practice`: steps 1-5 as code; `pnpm check:static` green (lint, typecheck,
unit tests: domain 169, functions 110, mobile 45 + 32, openapi up to date).

Not run yet, because local Supabase stopped answering during the session (Docker engine not
running; the session may not restart it):
1. Apply `0010_learning.sql` to local Supabase.
2. Serve the functions of this worktree and run `tests/integration/learning.test.ts`, then the other
   integration files. **Do not run `tests/integration/library.test.ts` or `pnpm acceptance m05` on a
   database that holds real libraries**: both call `resetLibraryScope` for Toán 6, Toán 2 and
   Tiếng Việt 2 and delete those items. So `pnpm check` as a whole (it includes `pnpm test:api`) must
   run on a database with fixtures only.
3. `pnpm acceptance m06`; fix what the real library shows (e.g. `fill_blank` items in Toán 2 would
   break the taps-only criterion).
4. `M06_REPORT.md`, ROADMAP → DONE.

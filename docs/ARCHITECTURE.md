# VionX Architecture v4: Android app + Supabase + shared content library

This version supersedes the infrastructure in Master Spec v1.3 (§3, §4, §30, §37, §46-51) and the earlier execution packs (Mac mini, cloud web).
Product rules in the Master Spec still apply (roles, consent, rewards, mastery, curriculum, privacy) except where this document or `CONTRACT.md` changes them.
Decisions were agreed with the product owner on 2026-10-07 (ADR-000 in CONTRACT §1).

## 1. Big picture

```
 ┌───────────────────────────┐        ┌──────────────────────────┐
 │ VionX Android app (Expo)  │        │ Admin web (Vite + React) │
 │  Parent mode | Child mode │        │ Cloudflare Pages         │
 │  offline SQLite queue     │        │ content review, library  │
 │  on-device TTS / STT      │        │ PDF split + text layer   │
 └────────────┬──────────────┘        └────────────┬─────────────┘
              │ HTTPS (one API)                    │
              ▼                                    ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ Supabase (Singapore)                                         │
 │  Edge Function "api" (Deno + Hono, REST + OpenAPI)           │
 │  Edge Functions "worker", "ai-batch" (jobs)                  │
 │  Postgres (pgvector only by ADR) ── schemas:                 │
 │     app.*      family data (household-scoped)                │
 │     library.*  shared content library (no personal data)     │
 │     ops.*      outbox, jobs, ai_runs, audit                  │
 │  pgmq queues + pg_cron schedules                             │
 │  Auth (parents: Google, phone OTP)   Storage (private)       │
 └──────────────────────────────┬───────────────────────────────┘
                                │
                     ┌──────────▼──────────┐
                     │ Claude API          │
                     │ Haiku 4.5 /         │
                     │ Sonnet 5.5 /        │
                     │ Opus 5.5 (by task)  │
                     │ Batch API for       │
                     │ content building    │
                     └─────────────────────┘
 GitHub: code repository only (Claude Code works on it). Nothing in production runs on GitHub.
```

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Mobile app | **Expo (React Native, TypeScript), expo-router**, Android-first | One app with **Parent mode** and **Child mode** chosen at first launch. Development builds (not Expo Go) for native modules. |
| Local storage | expo-sqlite + Drizzle (mobile) | Offline packs and action queue. |
| Push | expo-notifications (FCM) | Today reminders, approval requests. |
| Speech | Android on-device TTS (`expo-speech`) and on-device speech recognition through a maintained Expo module (chosen by ADR in M17) | Zero runtime cost. |
| Health | `react-native-health-connect` (M18, activity only) | No heart rate, no routes. |
| Admin | **Vite + React + TypeScript SPA** on Cloudflare Pages | TanStack Router/Query. PDF splitting, page previews and text-layer extraction run **in the admin's browser** (pdf.js, pdf-lib). |
| API | **Supabase Edge Function `api`** (Deno, Hono, zod-openapi) | The only entry point for app and admin. Authorization happens here. |
| Domain logic | `packages/domain` (pure TypeScript, no framework imports) | Shared by Edge Functions, mobile (offline previews) and admin. |
| Database | Supabase Postgres (Singapore), SQL migrations in `supabase/migrations` | RLS on, deny-by-default for client roles; the API uses a server role with household scoping. |
| Jobs | Outbox table → **pgmq** queues → **pg_cron** calls the `worker` function every minute | Reward conversion at day end, Today regeneration, notifications, exports, AI batch polling. |
| Files | Supabase Storage, private buckets, signed URLs | Books, proofs, exports, generated audio if any. |
| AI | Claude API through `packages/ai` `AiGateway` | Model per task (§4); Batch API for every content-building task. |
| Search | Postgres full-text (`unaccent`) filtered by skill | Embeddings (pgvector) only if the retrieval eval needs it (ADR). |
| Builds & updates | EAS Build (cloud) or local Gradle; EAS Update for JS-only OTA fixes | Alpha via Google Play internal testing. |
| Code | GitHub repository; GitHub Actions CI for lint, typecheck and unit tests (from M00) | Repo on GitHub is required for Claude Code on the web. |
| Errors | Sentry (mobile, admin, functions) | |

## 3. Shared content library (agreed item 7)

Learning content is a **global library** separate from family data. It is generated and reviewed once, then reused by every student in that grade/subject. Its cost does not grow with the number of users.

- Schema `library`: no `household_id`, no personal data, read-only to clients through the API.
- Items attach to **GDPT 2018 skills** (`curriculum_nodes` of level SKILL), never to a user or a textbook series.
- Item kinds:
  - `STATIC` question: stem, options/answer, explanation.
  - `TEMPLATE` question (mainly Math, Physics, Chemistry): parameter spec + constraints + answer expression evaluated by math.js. The app renders a deterministic variant from `(template_id, seed)`; the seed is stored with each attempt. One template gives unlimited variants at zero AI cost.
- Additional structures needed by language subjects and young learners:
  - `item_groups`: a shared stimulus (reading passage, poem excerpt, dialogue, picture scene) with several items attached. Used for Tiếng Việt, Ngữ văn and Tiếng Anh reading/listening.
  - `WRITTEN` items: open writing tasks (đoạn văn, bài văn ngắn, English sentences/paragraphs) with a rubric; scored by AI feedback (M17), never auto-approved as correct/incorrect.
  - Media per item/option: `image` (icon set or Claude-generated SVG for counting/shapes/diagrams), `tts_text` + `tts_lang` (read aloud on device), `audio_script` for listening.
  - Item types beyond choice/numeric: picture choice, drag-to-order (words in a sentence, steps), matching pairs, fill-in-the-blank with word bank, spelling choice (s/x, ch/tr, d/gi/r), true/false.
- Every item ships with pre-generated help, which is **tutor tier T0**: a 4-step hint ladder, a worked solution, feedback for each wrong option (linked to misconception tags), and source page refs.
- **Initial size: 500 items per grade-subject** (agreed 2026-10-07). Allocation rule (M14/X01–X08, adjusted by subject profile):
  1. Coverage first: every active skill gets ≥2 items, at least one L1-L2 and one L3+.
  2. The remainder is spread by skill weight (exam relevance, lesson count).
  3. In Math, ≥40% of items are TEMPLATE (Toán 2: ≥50%).
  4. If 2 × skills > 500, the coverage rule wins and the report flags it.
- **Launch scope (agreed 2026-10-07): Grade 2 and Grade 6 first, 8 libraries × 500 items.** See `docs/CONTENT_PLAN_vi.md`.

  | Grade | Libraries (GDPT 2018 subject names) |
  |---|---|
  | 2 | Toán, Tiếng Việt, Tiếng Anh, Tự nhiên và Xã hội (the Grade 1-3 science subject) |
  | 6 | Toán, Ngữ văn, Tiếng Anh, Khoa học tự nhiên |

  Other grades and subjects wait until these 8 pass review and alpha feedback.
- **Subject profiles** (`library.subject_profiles`) drive the generator and the planner: TEMPLATE share, item-type mix, group/passage share, read-aloud default, image needs, writing-task share. Defaults are in `CONTENT_PLAN_vi.md`.
- **Grade 1-3 UX rule**: every child-facing stem, option and hint has `tts_text` and is read aloud by default (on-device Vietnamese/English TTS); answers favour tapping pictures and big buttons over typing.
- **Tutor Q&A library** (`library.tutor_answers`): answers to free-form questions from T2/T3, anonymised and approved by an admin, are reused by T1 for later students.
- **Quality loop**: per-item stats (attempts, p-correct, median time, hint usage, error reports) recalculated nightly. Outliers (too easy or too hard for the tagged level, report rate above threshold) go back to the review queue. Calibrated difficulty replaces the generated difficulty after N attempts.
- **Top-up**: when a skill's unseen pool for an active student falls below a threshold, the skill is queued for the weekly top-up batch.
- **Versioning**: items have `version`; a curriculum change flags only items of affected skills.

## 4. AI model policy (defaults in `ai_task_config`, changeable without code)

| Task | Default model | Mode |
|---|---|---|
| Page extraction (pages without a good text layer, formulas, tables; every page of the image-only 2026-2027 SGK set) | `claude-haiku-4-5` | Batch |
| Page re-read after failed validation | `claude-sonnet-5-5` | Batch |
| TOC/structure, skill backbone, lesson → skill mapping | `claude-sonnet-5-5` | Batch |
| Item generation (questions, templates, hints, distractor feedback) | `claude-sonnet-5-5` | Batch |
| Item verification | `claude-haiku-4-5` + deterministic checks | Batch |
| Disputed items (verifier disagrees) | `claude-opus-5-5` | Batch, ≤5% of items |
| Tutor T2 (free-form question not in library) | `claude-haiku-4-5` | Realtime, streaming |
| Tutor T3 (escalation, low confidence or third follow-up) | `claude-sonnet-5-5` | Realtime |
| Writing feedback (Tiếng Việt, Ngữ văn, English) | Haiku 4.5 (G1-9), Sonnet 5.5 (G10-12) | Realtime or nightly batch |
| Original reading passages / dialogues for item groups | `claude-sonnet-5-5` | Batch |
| Simple SVG illustrations (counting objects, shapes, diagrams) | `claude-sonnet-5-5` | Batch, then render check |
| Parent weekly summary | `claude-haiku-4-5` | Weekly batch |

Expected cost per grade-subject library (500 items): roughly US$8-12 in AI for Math and US$10-15 for language and science subjects, plus about 8-12 hours of human review (about US$80-110 and 75-85 hours for the 8 launch libraries). Reading the scanned SGK pages with Haiku 4.5 adds about US$5 in total (about US$10 with SGV). Details are in `docs/COST_OPTIONS_vi.md`.

## 5. Tutor tiers (agreed item 5)
T0 pre-generated help on every item, at zero runtime cost → T1 approved Q&A library lookup (full-text within the skill), near zero → T2 Haiku 4.5 with cached system prompt and skill sources → T3 Sonnet 5.5. Daily free-form quota per child (default 5), visible to parents.

## 6. Privacy and residency
- Family data lives in Supabase Singapore. Vietnamese personal-data law requires a cross-border transfer impact assessment and disclosure in the consent texts (M02, M22).
- Library data contains no personal data. Tutor prompts carry a pseudonymous student ref, grade and skill state only.
- Speech is processed on the device; no audio leaves the phone in v1.

## 7. Environments
| Env | App | Backend | AI |
|---|---|---|---|
| local | Expo dev build on emulator/phone | `supabase start` (Docker) + `supabase functions serve` | `FakeAiProvider`, or a real key with a low spend limit |
| staging | EAS preview build (internal track) | Supabase staging project | Real, low limits |
| production | Play internal → closed → production tracks | Supabase production project | Real, Anthropic workspace spend limit |

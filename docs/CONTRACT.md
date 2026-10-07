# VionX Engineering Contract v4

Precedence: tests / migrations / OpenAPI > this contract > ARCHITECTURE.md > task pack > Master Spec v1.3 (product reference only).

## 1. Decisions (ADR-000, agreed with product owner 2026-10-07)
| # | Decision |
|---|---|
| D1 | **Android app built with Expo (React Native, TypeScript).** One app with Parent mode and Child mode. No parent web app in v1. |
| D2 | **Backend = Supabase only** (Postgres, Auth, Storage, Edge Functions, pgmq, pg_cron). Admin is a small Vite React SPA on Cloudflare Pages. No Vercel, Inngest, NestJS, Docker production stack, Mac mini or local LLM. |
| D3 | GitHub hosts the code only (Claude Code works on it). GitHub Actions runs CI only (lint, typecheck, tests). Production does not run on GitHub. |
| D4 | Alpha = Master Spec §43 flow in the Android app, with the Toán 6 (X01) and Toán 2 (X02) libraries. |
| D5 | Skill backbone = GDPT 2018 "yêu cầu cần đạt". Textbooks map onto it. |
| D6 | **Shared content library**: items attach to skills, are global, contain no personal data, and are reused by all users. **Initial target 500 items per grade-subject.** TEMPLATE items for numeric subjects. **Launch scope: Grade 2 and Grade 6 only, 8 libraries** (Toán, Tiếng Việt/Ngữ văn, Tiếng Anh, TN&XH/KHTN; `docs/CONTENT_PLAN_vi.md`). Other grades/subjects need a new ADR. |
| D7 | **Cost-tiered AI**: per-task model defaults in ARCHITECTURE §4 (Haiku 4.5 / Sonnet 5.5 / Opus 5.5 for disputes); every content-building task uses the Batch API; tutor tiers T0-T3 with a daily quota. |
| D8 | Pages with a healthy PDF text layer are extracted without AI. The 2026-2027 SGK PDFs are image-only scans, so every page of that set is read by Haiku 4.5 (Batch). |
| D9 | No embeddings in v1; Postgres full-text filtered by skill. pgvector only by ADR when the retrieval eval requires it. |
| D10 | Out of v1 (`docs/BACKLOG.md`): eye tracking, heart rate, multiplayer Arena, coding sandbox, music/art, IELTS/TOEIC, competition crawling, test-photo extraction, on-device LLM. |
| D11 | Admin permissions: `SUPER_ADMIN, CONTENT_ADMIN, CURRICULUM_EDITOR, CONTENT_REVIEWER, LIBRARIAN, SUPPORT, ANALYST`, checked by permission name. |

## 2. Repository layout
```
vionx/
  apps/mobile/            Expo app: app/(parent)/..., app/(child)/..., app/(onboarding)/...
  apps/admin/             Vite React SPA
  supabase/
    migrations/           SQL (schemas app, library, ops)
    functions/api/        Hono router, one folder per module: routes.ts, schemas.ts
    functions/worker/     queue consumers + cron handlers
    functions/ai-batch/   submit/poll Claude batches
    functions/_shared/    db, auth, household scope, errors, ai gateway (Deno build)
    seed.sql
  packages/domain/        pure TS business rules + tests (Vitest)
  packages/contracts/     Zod schemas, OpenAPI generation, typed API client for mobile/admin, seed/library JSON schemas
  packages/ai/            AiGateway, providers (Anthropic, Fake), task config types, prompts/*.md, output schemas
  packages/tokens/        VionX design tokens (shared by mobile + admin)
  scripts/acceptance/     one scenario per module (Deno or Node, hits the API)
  docs/  TASK_PACKS/  CLAUDE.md
```
pnpm workspaces + Turborepo. TypeScript strict. ESLint + Prettier. Vitest. Mobile e2e with Maestro flows in `apps/mobile/.maestro/`.

## 3. Data conventions
- Schemas: `app` (family data), `library` (shared content), `ops` (outbox, queues metadata, ai_runs, audit, rate_limits).
- UUID PKs, `created_at/updated_at timestamptz`. Soft delete only where history matters.
- Every `app.*` child-data table has `household_id` + index. The API resolves the actor, then every query goes through `scoped(ctx)` which injects the household filter. Cross-household integration tests are mandatory.
- RLS enabled on all tables; client roles (`anon`, `authenticated`) get no direct table access. All reads/writes go through the `api` function.
- XP/Coin are integers. Ledgers append-only (trigger rejects UPDATE/DELETE); corrections by reversal. Multi-ledger writes in one transaction (`sql.begin`).
- `idempotency_key` unique per (household, kind); client actions carry client UUIDs.
- Outbox `ops.domain_events` written in the same transaction → trigger enqueues to pgmq `events` → `worker` consumes; consumers record processed `event_id`.
- `ops.audit_logs` for parent/admin access to child data and every admin mutation.
- UTC storage; reward "local day" uses household timezone (default `Asia/Ho_Chi_Minh`).

## 4. API conventions
- Base `/functions/v1/api/v1/...`. JSON. Cursor pagination (`limit` ≤100).
- Errors `{code, message, details?, requestId}`, stable codes (`CONSENT_REQUIRED`, `REWARD_CAP_REACHED`, `FORBIDDEN_HOUSEHOLD`, `TUTOR_QUOTA_REACHED`...).
- Actors: `parent` (Supabase Auth JWT), `child` (VionX child session token, opaque, hashed in `app.child_sessions`), `admin` (parent account + `ops.admin_permissions`), `system` (cron/worker with service secret).
- Every route has Zod request/response schemas; `pnpm openapi` writes `docs/api/openapi.json`; `packages/contracts` exports a typed client used by mobile and admin.

## 5. Consent & privacy
v1 consent types: `CORE_SERVICE, EDUCATION_ANALYTICS, AI_PERSONALIZATION, MICROPHONE_SPEAKING, HEALTH_CONNECT_ACTIVITY, COMPETITION_AREA`. Versioned against `app.policy_versions`, revocable, with `child_assent_status` (required at age ≥7 for AI, microphone, health). Revocation is immediate and cancels queued jobs of that scope.
Privacy texts disclose processing in Singapore and by Anthropic (AI). Speech stays on device.

## 6. AI rules
- `AiGateway.run({task, promptVersion, input, studentRef?, sourceRefs?})`, `AiGateway.submitBatch(task, items)`, `AiGateway.collectBatch(id)`. Model, effort and max tokens come from `ops.ai_task_config` (defaults: ARCHITECTURE §4).
- Structured output via JSON Schema in `packages/ai/schemas`. Always check `stop_reason` (`refusal`, `max_tokens`) before parsing; Sonnet/Opus 5.5 requests set the server-side refusal fallback (`fallbacks: "default"`).
- Prompt caching: stable prefix (system prompt, schema, style guide, skill backbone) first, item-specific input last.
- Every call logs `ops.ai_runs` (task, model, prompt version, input/output/cache tokens, cost estimate, latency, status, source refs).
- Content items need: deterministic checks + independent verifier + human or rule-based approval. A model never approves its own output.
- Tests use `FakeAiProvider`; real calls only with `AI_LIVE=1`.

## 7. Definition of done (per module)
Required: migration; domain unit tests for every rule; API integration tests incl. cross-household denial; OpenAPI updated; mobile/admin screens with loading/empty/error/offline states; seed updated; acceptance script passes; Maestro flow for the module's main path; REPORT written.
When relevant: consent check, audit log, domain event, analytics event.

## 8. Testing
- `packages/domain`: Vitest, property tests (fast-check) for rewards/mastery/planner.
- API: Vitest against local Supabase (`supabase start`, `supabase functions serve`).
- Mobile: Jest for components/hooks, Maestro e2e on an Android emulator.
- Admin: Vitest + Playwright smoke.

## 9. Git workflow
Branch per module `m<NN>-<slug>`, one PR per module, product owner reviews and merges. Migrations are never edited after merge. `ci.yml` (added in M00): lint, typecheck, unit tests; `supabase start` + API tests when they fit the CI time budget.

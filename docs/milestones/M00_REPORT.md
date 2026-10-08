# M00 Report

## Summary
VionX now has a runnable, empty foundation. The Android app (Expo SDK 57) opens on a first-launch
screen where the family chooses "Phụ huynh" or "Con", and it shows the live status of the backend.
Behind it, the Supabase `api` Edge Function answers `GET /v1/health` (database, storage, queue, AI key)
and publishes its OpenAPI document; domain events written to the outbox are delivered by a
pg_cron → pg_net → `worker` pipeline exactly once; and every future model call has one path,
`AiGateway`, with per-task models from `ops.ai_task_config`. The admin SPA builds with the §33.1
navigation shell and a live health card.

## Changed
- Migrations: `supabase/migrations/0001_base.sql` — schemas `app`, `library`, `ops`; extensions `pgmq`,
  `pg_cron`, `pg_net`, `unaccent`; tables `ops.domain_events` (append-only outbox, idempotency index),
  `ops.processed_events` (consumer idempotency), `ops.audit_logs` (append-only), `ops.ai_task_config`
  (14 rows, ARCHITECTURE §4), `ops.ai_runs` (append-only), `ops.rate_limits`, `ops.analytics_events`;
  trigger `domain_events → pgmq "events"`; queues `events`, `events_dlq`; RLS on every table, no
  grants to `anon`/`authenticated`; `ops.invoke_worker()` + cron job `vionx-worker-tick` (every minute).
- API routes: `GET /functions/v1/api/v1/health`, `GET /functions/v1/api/v1/openapi.json`. Request id
  (`x-request-id`), error shape `{code, message, details?, requestId}`, CORS allow-list, actor resolver
  skeleton (`system` via service secret; parent/child/admin in M01), `requireActor` guard.
- Worker / cron jobs: `worker` function — pgmq batch read with visibility timeout, handler + processed-event
  record + archive in one transaction, dead-letter to `events_dlq` after 5 reads, up to 10 batches per
  tick; handler registry in `worker/handlers.ts` (`system.ping`). `ai-batch` function — submit/collect
  through `AiGateway` (service secret).
- Packages: `@vionx/domain` (layout + `localDay` household-timezone rule, fast-check property test),
  `@vionx/tokens`, `@vionx/ai` (`AiGateway.run/submitBatch/collectBatch`, `AnthropicProvider` on
  `@anthropic-ai/sdk`, `FakeAiProvider`, cost estimate, stop_reason checks, refusal fallback
  `fallbacks: "default"` for realtime Sonnet/Opus 5.5, cached system prefix, `ai:check`),
  `@vionx/contracts` (Zod schemas → OpenAPI → `openapi-typescript` types → `openapi-fetch` client).
- Mobile screens: `app/(onboarding)/welcome.tsx` (role choice + health card with loading/ok/degraded/
  offline states), placeholders `(parent)/parent.tsx`, `(child)/child.tsx`; vi strings with en fallback;
  theme from tokens; Sentry (DSN optional); `eas.json` development/preview/production; Maestro flow
  `.maestro/m00-health.yaml`.
- Admin screens: login placeholder, sidebar with all §33.1 entries (stub pages naming the owning
  module), dashboard health card; Cloudflare Pages config (`wrangler.toml`, `_redirects`, `_headers`).
- Config / env vars / ai_task_config: see README "Environment variables". New: `VIONX_SERVICE_SECRET`,
  `ALLOWED_ORIGINS`, `APP_VERSION`, Vault `vionx_worker_url` / `vionx_service_secret`,
  `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SENTRY_DSN`, `VITE_API_URL`, `VITE_SENTRY_DSN`.
- CI: `.github/workflows/ci.yml` — job `check` (lint, typecheck incl. `deno check`, unit tests,
  openapi diff, admin build, Android JS bundle) and job `api` (`supabase start`, `functions serve`,
  `pnpm test:api`, `pnpm acceptance m00`).

## Evidence
- `pnpm check:static` (lint + Prettier, typecheck incl. `deno check`, unit tests, OpenAPI diff): green.
  Unit tests: domain 5, tokens 2, ai 20, contracts 1, functions 18, admin 2, mobile 4.
- `pnpm test:api` (local Supabase): 8/8 passed (one earlier run had a single ai-batch failure right
  after file edits triggered an Edge Runtime hot reload; three later runs green).
- Acceptance script output (`pnpm acceptance m00`): 7 passed, 0 failed, 2 skipped —
  health OK; served OpenAPI matches the committed document; schemas/extensions/14 ai tasks/RLS/no grants;
  outbox UPDATE rejected; worker 401 without secret; inserted `domain_events` row consumed by the cron
  tick, duplicate redelivery ignored (1 processed row, 2 archived messages); admin build passes.
  Skipped: `ai:check` (no key here), Android dev build (needs emulator).
- `npx expo export --platform android`: bundle produced (4.2 MB Hermes bytecode).
- Maestro flow result + screenshots: not run (no emulator in this environment).
- Build link (EAS / Play internal): none (no Expo account).
- AI cost of this module's runs: US$0 (no real model calls; tests use FakeAiProvider).

## Decisions
- TypeScript 6.0 instead of 7.0: `typescript-eslint` supports `<6.1`.
- Mobile pins React 19.2.3 / React Native 0.86.3 / `@sentry/react-native` ~7.11 (Expo SDK 57's
  `bundledNativeModules.json`); admin uses React 19.3.
- Migration file is named `0001_base.sql` as the task pack says (the Supabase CLI accepts it).
- `ai_task_config` gains an `ai_check` row (Haiku 4.5, 64 tokens) for `pnpm ai:check`; effort is `null`
  for Haiku 4.5 (the model does not accept it). Writing feedback is split into `writing_feedback_g1_9`
  (Haiku) and `writing_feedback_g10_12` (Sonnet).
- Added `ops.processed_events` (not listed in the task pack) to make consumption idempotent per
  CONTRACT §3.
- `/v1/health` is 200 when db, storage and queue pass; a missing AI key is reported as a non-critical
  warning so local development without a key stays green. 503 when a critical check fails.
- All three functions use `verify_jwt = false` and authorize themselves (child sessions are opaque
  tokens, system calls use `x-vionx-service-secret`).
- The api uses `SUPABASE_DB_URL` (role `postgres`) until M01 introduces the scoped server role.
- Without `ANTHROPIC_API_KEY`, Edge Functions fall back to `FakeAiProvider` (never spend by accident).
- The Batches API rejects `fallbacks`, so only realtime Sonnet/Opus 5.5 calls set it.
- Turborepo's auto-generated `AGENTS.md` is disabled (`agentGuidance: false`).

## Privacy & security impact
No personal data stored yet. `ops.ai_runs.student_ref` is pseudonymous by contract. Client roles have no
table access (RLS on, grants revoked, `auto_expose_new_tables = false`); pgmq is not exposed. System
endpoints require the service secret (constant-time compare). `ops.audit_logs` exists, append-only;
first writers arrive in M01/M02. No consent checks yet (M02).

## Known issues / follow-ups
- Not verifiable here: `pnpm ai:check` with a real key, the Android dev build + Maestro flow, CI on the PR.
- Local environment quirk (this sandbox only): Docker images had to come from Docker Hub
  (`SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`) and the Edge Runtime's Deno cache was pre-filled from
  the host because of a TLS-intercepting proxy (README "Behind a TLS-intercepting proxy").
- Sentry for Edge Functions and source-map upload (`@sentry/cli` build script is not approved in pnpm)
  are left for M09.
- `ai-batch` collect relies on the provider holding batch state; with the FakeAiProvider that state is
  per isolate. Real collection via cron polling arrives with X01/M10.
- Mobile component tests (Jest/jest-expo) start with the first real screens (M01).

## What the next module can rely on
- `createApp(deps)` in `supabase/functions/api/app.ts`: add `api/<module>/{routes,schemas}.ts` and
  register them; throw `ApiError(code, …)`; use `requireActor(c.get('actor'), …)`. Extend
  `SkeletonActorResolver` for parent JWT / child session / admin permissions (M01).
- Outbox: insert into `ops.domain_events` in the same transaction; register handlers in
  `worker/handlers.ts` (they receive the transaction); consumption is exactly once per consumer.
- `AiGateway` via `createGateway(sql, apiKey)` in `_shared/ai.ts`; models change in `ops.ai_task_config`.
- `localDay()` and `DEFAULT_HOUSEHOLD_TIMEZONE` in `@vionx/domain`.
- Typed client `createApiClient` from `@vionx/contracts/client`; run `pnpm openapi` after adding routes.
- `scripts/acceptance/lib.ts` for new acceptance scenarios (`scripts/acceptance/<module>.ts`).

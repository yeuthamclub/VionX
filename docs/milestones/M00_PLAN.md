# M00 Plan — Foundation

Branch: `m00-foundation`. Dependencies: none (ROADMAP: M00 depends on –).

## Steps (CLAUDE.md working-loop order)
1. Monorepo skeleton: pnpm workspaces, Turborepo, TS strict base config, ESLint (flat config) + Prettier, Vitest. Root scripts from the CLAUDE.md command list that apply in M00.
2. SQL migration `0001_base.sql`: schemas `app`/`library`/`ops`; extensions `pgmq`, `pg_cron`, `pg_net`, `unaccent`; tables `ops.domain_events`, `ops.processed_events`, `ops.audit_logs`, `ops.ai_runs`, `ops.ai_task_config` (seeded per ARCHITECTURE §4), `ops.rate_limits`, `ops.analytics_events`; outbox trigger → pgmq `events`; dead-letter queue `events_dlq`; pg_cron job calling the `worker` function via `pg_net` every minute (URL + secret from Vault); RLS on, no client grants. `config.toml`, `seed.sql`.
3. `packages/domain`: module layout + sample pure rule (`localDay`, household-timezone local day) with Vitest + fast-check tests.
4. `packages/tokens`: colour/type/spacing/radius tokens.
5. `packages/ai`: `AiGateway` (run / submitBatch / collectBatch), `AnthropicProvider`, `FakeAiProvider`, task-config source + ai_runs logger interfaces, cost estimate, `stop_reason` handling, `ai:check` script.
6. `packages/contracts`: shared Zod schemas (error, health), generated OpenAPI types, typed `openapi-fetch` client.
7. `supabase/functions`: `_shared` (env, db, errors, request id, actor resolver skeleton, AI wiring), `api` (Hono + zod-openapi, `GET /v1/health`, `/v1/openapi.json`), `worker` (pgmq consumer: batch read, visibility timeout, archive on success, DLQ after N attempts, processed-event idempotency), `ai-batch` stub. App construction runtime-neutral so Vitest (Node) can test handlers; Deno entrypoints stay thin. Import map in `supabase/functions/deno.json`.
8. `pnpm openapi` → `docs/api/openapi.json` + `packages/contracts/src/generated/openapi.ts`; `openapi:check` diff guard.
9. `apps/admin`: Vite + React + TanStack Router/Query, login placeholder, §33.1 nav stubs, dashboard health card, Cloudflare Pages config, Sentry (optional DSN).
10. `apps/mobile`: Expo SDK 57 + expo-router, theme from tokens, vi strings with en fallback, first-launch "Phụ huynh / Con" screen showing API health, `eas.json` development profile, Sentry (optional DSN), Maestro flow.
11. `scripts/acceptance/m00.ts`, API integration tests (`supabase/functions/tests/integration`), CI workflow, README.
12. Run lint/typecheck/test/build/acceptance; write `M00_REPORT.md`; set ROADMAP M00 status.

## Remaining steps
All implementation steps above are done and green locally. Remaining acceptance items need the
owner's accounts/devices (details in M00_REPORT.md):
- `pnpm ai:check` with a real `ANTHROPIC_API_KEY`.
- Android development build on an emulator showing the health status (`maestro test apps/mobile/.maestro`).
- CI workflow run on the PR (first push to GitHub).
Then set M00 to DONE in ROADMAP.

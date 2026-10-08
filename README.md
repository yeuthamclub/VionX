# VionX

Student & Family OS for Vietnamese students (Grade 1-12): an Android app (Expo) with Parent and
Child modes, a Supabase backend, a shared content library built with Claude, and a small admin SPA.

Start with [`CLAUDE.md`](CLAUDE.md), [`docs/CONTRACT.md`](docs/CONTRACT.md) and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Module scopes are in [`TASK_PACKS/`](TASK_PACKS),
progress in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Repository

```
apps/mobile          Expo (SDK 57) + expo-router Android app
apps/admin           Vite + React + TanStack Router/Query admin SPA (Cloudflare Pages)
supabase/            config.toml, migrations, seed.sql
supabase/functions   Edge Functions: api (Hono + zod-openapi), worker (pgmq consumer), ai-batch
packages/domain      pure business rules + Vitest
packages/contracts   Zod schemas, generated OpenAPI types, typed API client (openapi-fetch)
packages/ai          AiGateway, Anthropic + Fake providers, task config, prompts, schemas
packages/tokens      VionX design tokens
scripts/acceptance   one acceptance scenario per module
```

Edge Functions import workspace packages through the import map in `supabase/functions/deno.json`
(npm packages as `npm:` specifiers), so packages used there have no Node built-ins and no build step.

## Accounts to create

| Account | Used for | When |
|---|---|---|
| **Supabase** | Two projects in Singapore (`ap-southeast-1`): staging and production. Pro plan before alpha. | M00 |
| **Anthropic Console** | API key for `ANTHROPIC_API_KEY`; set a workspace spend limit. | M00 (`pnpm ai:check`) |
| **Expo (EAS)** | Android development/preview builds, EAS Update. | M00 |
| **Cloudflare** | Pages project `vionx-admin` for the admin SPA. | M00 |
| **Google Play Console** | Internal testing track (US$25 one-off). | M09 |
| Sentry (optional) | Crash reporting for mobile and admin (`*_SENTRY_DSN`). | any time |
| Google Cloud | OAuth client for parent Google sign-in. | M01 |

## Environment variables

| Where | Variable | Notes |
|---|---|---|
| `supabase/functions/.env` (local; copy `.env.example`) / Supabase secrets (remote) | `VIONX_SERVICE_SECRET` | Shared secret for system calls (pg_cron → worker, ai-batch). |
| | `ANTHROPIC_API_KEY` | Optional locally (FakeAiProvider is used without it). |
| | `ALLOWED_ORIGINS` | Comma-separated admin origins for CORS. |
| | `APP_VERSION` | Reported by `/v1/health`. |
| Supabase Vault (remote) | `vionx_worker_url`, `vionx_service_secret` | Read by the pg_cron job that calls the worker. `seed.sql` sets local values. |
| `apps/mobile/.env.local` | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SENTRY_DSN` | Bundled into the app; never secrets. |
| `apps/admin/.env.local` / Pages env | `VITE_API_URL`, `VITE_SENTRY_DSN` | |
| Shell | `ANTHROPIC_API_KEY` | For `pnpm ai:check`. |

`SUPABASE_URL`, `SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions
by Supabase. Remote setup:

```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/worker', 'vionx_worker_url');
select vault.create_secret('<same value as VIONX_SERVICE_SECRET>', 'vionx_service_secret');
```

```sh
supabase secrets set VIONX_SERVICE_SECRET=... ANTHROPIC_API_KEY=... ALLOWED_ORIGINS=https://<admin-domain>
supabase db push && supabase functions deploy api worker ai-batch
```

## Local development

Prerequisites: Node 22, pnpm 10, Docker, Android Studio (emulator), optionally Maestro.

```sh
pnpm install
cp supabase/functions/.env.example supabase/functions/.env
pnpm db:start          # supabase start (Postgres, Auth, Storage, Edge Runtime) + migrations + seed
pnpm fn:serve          # serves api, worker, ai-batch on http://127.0.0.1:54321/functions/v1
curl http://127.0.0.1:54321/functions/v1/api/v1/health
pnpm dev:admin         # http://localhost:5173
```

pg_cron calls the worker every minute through pg_net (local URL from `seed.sql`).

### Android emulator

1. Create a Pixel emulator in Android Studio and start it.
2. Build and install the development client once: `cd apps/mobile && npx expo run:android`
   (local Gradle), or `eas build --profile development --platform android` and install the APK.
3. `cp apps/mobile/.env.example apps/mobile/.env.local` (the emulator reaches the host's Supabase
   at `10.0.2.2`), then `pnpm dev:mobile` and open the app. The first screen shows
   "Phụ huynh / Con" and the API health status.
4. On a physical phone use your machine's LAN IP in `EXPO_PUBLIC_API_URL`.
5. e2e: `maestro test apps/mobile/.maestro`.

## Commands

| Command | |
|---|---|
| `pnpm lint` / `typecheck` / `test` | ESLint + Prettier, `tsc` (+ `deno check` for functions), Vitest |
| `pnpm openapi` | Regenerate `docs/api/openapi.json` and the typed client types |
| `pnpm check` | lint, typecheck, unit tests, OpenAPI diff, API integration tests (needs local Supabase) |
| `pnpm acceptance m00` | Module acceptance scenario against local Supabase |
| `pnpm ai:check` | One tiny real Claude call (needs `ANTHROPIC_API_KEY`) |
| `pnpm db:start` / `db:reset` / `db:migrate` / `db:seed` | Local database |
| `pnpm dev:mobile` / `dev:admin` / `fn:serve` | Dev servers |

### Behind a TLS-intercepting proxy

If `supabase start` cannot pull from `public.ecr.aws`, set `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`.
If the Edge Runtime cannot download npm packages (certificate errors), pre-fill its Deno cache from
the host: `cd supabase/functions && DENO_CERT=<proxy-ca.pem> DENO_DIR=$(docker volume inspect -f '{{.Mountpoint}}' supabase_edge_runtime_vionx) ./node_modules/.bin/deno install --node-modules-dir=none --config deno.json --entrypoint api/index.ts worker/index.ts ai-batch/index.ts`.

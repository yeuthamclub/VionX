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
| Google Cloud | OAuth clients for parent Google sign-in: a **Web** client (its id goes to Supabase Auth and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`) and an **Android** client for package `vn.vionx.app` with the signing certificate SHA-1 (debug, EAS and Play). | M01 |
| SMS provider | Real phone OTP on staging/production (Supabase Auth → Phone). Locally only test OTP numbers work. | M22 |

## Environment variables

| Where | Variable | Notes |
|---|---|---|
| `supabase/functions/.env` (local; copy `.env.example`) / Supabase secrets (remote) | `VIONX_SERVICE_SECRET` | Shared secret for system calls (pg_cron → worker, ai-batch). |
| | `ANTHROPIC_API_KEY` | Optional locally (FakeAiProvider is used without it). |
| | `ALLOWED_ORIGINS` | Comma-separated admin origins for CORS. |
| | `APP_VERSION` | Reported by `/v1/health`. |
| | `SUPABASE_JWT_SECRET` | Optional. Only for a project still signing user tokens with the legacy HS256 secret; otherwise parent JWTs are verified against the project JWKS. |
| | `SUPABASE_JWKS_URL` | Optional override of `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. |
| | `VIONX_PUBLIC_SUPABASE_URL` | Public base URL used in signed data-export download links (`https://<project-ref>.supabase.co`; locally `http://127.0.0.1:54321`, or `http://10.0.2.2:54321` to open links from the emulator). |
| Supabase Vault (remote) | `vionx_worker_url`, `vionx_service_secret` | Read by the pg_cron job that calls the worker. `seed.sql` sets local values. |
| `apps/mobile/.env.local` | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_SENTRY_DSN` | Bundled into the app; never secrets (the publishable key grants no table access). |
| `apps/admin/.env.local` / Pages env | `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SENTRY_DSN` | |
| Shell | `ANTHROPIC_API_KEY` | For `pnpm ai:check`. |

`SUPABASE_URL`, `SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions
by Supabase. Remote setup:

```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/worker', 'vionx_worker_url');
select vault.create_secret('<same value as VIONX_SERVICE_SECRET>', 'vionx_service_secret');
```

```sh
supabase secrets set VIONX_SERVICE_SECRET=... ANTHROPIC_API_KEY=... ALLOWED_ORIGINS=https://<admin-domain> \
  VIONX_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
supabase db push && supabase functions deploy api worker ai-batch
```

### Privacy (M02)

- Data exports are written to the private Storage bucket `privacy-exports` (created by migration
  `0003_consent_privacy.sql`); links are signed for the remaining 24 h.
- Deletion requests are purged after 30 days by the pg_cron job `vionx-privacy-purge`.
- Public account-deletion page for Google Play: `https://<admin-domain>/delete-account` (no admin
  login; the parent signs in with phone OTP or Google).
- Legal drafts: `docs/legal/` (vi + en, DRAFT, need legal review); version 1 is loaded by migration
  `0004_policy_v1.sql`.

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

### Local accounts (seed, local only)

| Who | Sign in |
|---|---|
| SUPER_ADMIN (admin SPA) | `admin@vionx.local` / `vionx-admin-local` |
| Demo parent (app) | phone `0900000001` (`+84900000001`), OTP `123456` |
| Demo children | `vx-demy22` (grade 2), `vx-demy66` (grade 6), `vx-demy99` (grade 9), PIN `2468` |
| Test parents | `+84900000002` (acceptance), `+84900000003` (integration tests, Maestro M01), `+84900000004` (Maestro M02), OTP `123456` |

Test OTPs and the placeholder SMS provider live in `supabase/config.toml` and must never be configured
on staging/production.

### Parent Google sign-in (staging/production)

1. Google Cloud console → OAuth consent screen, then create a **Web application** client and an
   **Android** client (package `vn.vionx.app`, SHA-1 of each signing key: `eas credentials` / Play).
2. Supabase dashboard → Authentication → Providers → Google: enable, paste the Web client id and
   secret; add the Android client id to "Authorized Client IDs"; keep "Skip nonce check" on for
   native sign-in.
3. Set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (Web client id) for the app build. The Android code path
   is `apps/mobile/src/state/google.ts` (`@react-native-google-signin/google-signin` →
   `supabase.auth.signInWithIdToken`); no `google-services.json` is needed.
4. For local Google testing, uncomment `[auth.external.google]` in `supabase/config.toml` and export
   `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET` (never committed).

### Android emulator

1. Create a Pixel emulator in Android Studio and start it.
2. Build and install the development client once: `cd apps/mobile && npx expo run:android`
   (local Gradle), or `eas build --profile development --platform android` and install the APK.
3. `cp apps/mobile/.env.example apps/mobile/.env.local` (the emulator reaches the host's Supabase
   at `10.0.2.2`) and paste the publishable key from `pnpm exec supabase status` into
   `EXPO_PUBLIC_SUPABASE_ANON_KEY`, then `pnpm dev:mobile` and open the app. The first screen shows
   "Phụ huynh / Con" and the API health status.
4. On a physical phone use your machine's LAN IP in `EXPO_PUBLIC_API_URL`.
5. e2e: `maestro test apps/mobile/.maestro`.

## Commands

| Command | |
|---|---|
| `pnpm lint` / `typecheck` / `test` | ESLint + Prettier, `tsc` (+ `deno check` for functions), Vitest |
| `pnpm openapi` | Regenerate `docs/api/openapi.json` and the typed client types |
| `pnpm check` | lint, typecheck, unit tests, OpenAPI diff, API integration tests (needs local Supabase) |
| `pnpm acceptance m00` / `m01` / `m02` | Module acceptance scenario against local Supabase |
| `pnpm ai:check` | One tiny real Claude call (needs `ANTHROPIC_API_KEY`) |
| `pnpm db:start` / `db:reset` / `db:migrate` / `db:seed` | Local database |
| `pnpm dev:mobile` / `dev:admin` / `fn:serve` | Dev servers |

### Behind a TLS-intercepting proxy

If `supabase start` cannot pull from `public.ecr.aws`, set `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`.
If the Edge Runtime cannot download npm packages (certificate errors), pre-fill its Deno cache from
the host: `cd supabase/functions && DENO_CERT=<proxy-ca.pem> DENO_DIR=$(docker volume inspect -f '{{.Mountpoint}}' supabase_edge_runtime_vionx) ./node_modules/.bin/deno install --node-modules-dir=none --config deno.json --entrypoint api/index.ts worker/index.ts ai-batch/index.ts`.

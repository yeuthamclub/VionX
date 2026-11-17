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
- Deletion requests are purged after the 14-day grace period (cancellable until then) by the pg_cron job `vionx-privacy-purge`.
- Public account-deletion page for Google Play: `https://<admin-domain>/delete-account` (no admin
  login; the parent signs in with phone OTP or Google).
- Legal drafts: `docs/legal/` (vi + en, DRAFT, need legal review); version 1 is loaded by migration
  `0004_policy_v1.sql`.

## Development

Development uses a Supabase Cloud project, not Docker
([ADR-002](docs/adr/0002-develop-against-supabase-cloud.md)). The functions you are editing run on
your machine with Deno and talk to that project.

Prerequisites: Node 22, pnpm 10, Android Studio (emulator), optionally Maestro. No Docker.

```sh
pnpm install
cp .env.example .env.cloud   # fill in the 4 values from the Supabase dashboard; never commit it
pnpm db:migrate              # applies supabase/migrations/*.sql that the project does not have yet
pnpm db:seed                 # first time only: supabase/seed.sql (demo accounts, Vault entries)
pnpm fn:serve                # api, worker, ai-batch on http://127.0.0.1:54331/functions/v1
curl http://127.0.0.1:54331/functions/v1/api/v1/health
pnpm dev:admin               # http://localhost:5173
```

Tests and acceptance scenarios read the same file through `pnpm cloud`:

```sh
pnpm cloud pnpm test:api          # needs `pnpm fn:serve` in another terminal
pnpm cloud pnpm acceptance m06
```

- Each query crosses the network (about 0.2 s), so these runs take minutes.
- Tests create throwaway families (`…@vionx.test`) and remove them. In the dashboard, Authentication →
  Sign In / Providers → Email: turn "Confirm email" off for the development project, or sign-up
  returns no session.
- `library.test.ts` and `pnpm acceptance m05` import fixtures into Toán 6, Toán 2 and Tiếng Việt 2.
  They refuse to run when one of those holds a reviewed library (more than 50 items). Use a second
  project with fixtures only (another `.env` file: `node --env-file=.env.test scripts/cloud.mjs pnpm check`), or CI.
- Tests that sign in by phone need Authentication → Phone → "Test phone numbers" for the numbers
  below (OTP `123456`); otherwise they fail at sign-in.
- pg_cron calls the worker through pg_net at the Vault entry `vionx_worker_url`. That only works once
  the worker is deployed; with functions on your machine the tests call the worker directly.
- Free plan: the project pauses after about a week without activity (resume it in the dashboard);
  500 MB database; no backups.

Deploy to the project (needs `supabase login` and `supabase link --project-ref <ref>` once):

```sh
pnpm exec supabase secrets set VIONX_SERVICE_SECRET=... ALLOWED_ORIGINS=... VIONX_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
pnpm exec supabase functions deploy api worker ai-batch
```

### Seed accounts (development project only)

| Who | Sign in |
|---|---|
| SUPER_ADMIN (admin SPA) | `admin@vionx.local` / `vionx-admin-local` |
| Demo parent (app) | phone `0900000001` (`+84900000001`), OTP `123456` |
| Demo children | `vx-demy22` (grade 2), `vx-demy66` (grade 6), `vx-demy99` (grade 9), PIN `2468` |
| Test parents | `+84900000002` (acceptance), `+84900000003` (integration tests, Maestro M01), `+84900000004` (Maestro M02), OTP `123456` |

These passwords, the test OTPs and the seed value of `vionx_service_secret` are in this repository.
They are acceptable only while the project holds no real family: before any real user, set a new
service secret, delete the seed accounts and remove the test phone numbers. `supabase/config.toml`
is only used by CI (a throwaway local Supabase per run).

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
3. `cp apps/mobile/.env.example apps/mobile/.env.local` (the emulator reaches `pnpm fn:serve` on the
   host at `10.0.2.2`) and fill in the project URL and publishable key from `.env.cloud`, then `pnpm dev:mobile` and open the app. The first screen shows
   "Phụ huynh / Con" and the API health status.
4. On a physical phone use your machine's LAN IP in `EXPO_PUBLIC_API_URL`.
5. e2e: `maestro test apps/mobile/.maestro`.

## Commands

| Command | |
|---|---|
| `pnpm lint` / `typecheck` / `test` | ESLint + Prettier, `tsc` (+ `deno check` for functions), Vitest |
| `pnpm openapi` | Regenerate `docs/api/openapi.json` and the typed client types |
| `pnpm check:static` | lint, typecheck, unit tests, OpenAPI diff (no database) |
| `pnpm cloud pnpm check` | The above plus API integration tests against the project of `.env.cloud` |
| `pnpm cloud pnpm acceptance <module>` | Module acceptance scenario against that project |
| `pnpm ai:check` | One tiny real Claude call (needs `ANTHROPIC_API_KEY`) |
| `pnpm db:migrate` / `db:seed` | Apply new migrations / `seed.sql` to that project. There is no reset command. |
| `pnpm dev:mobile` / `dev:admin` / `fn:serve` | Dev servers |

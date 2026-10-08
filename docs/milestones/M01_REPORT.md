# M01 Report

## Summary
Parents can now sign in to the VionX app with a phone OTP (or native Google Sign-In once the owner
configures Google), create their household and add children. Each child gets a one-time login card
(`vx-` id + PIN) that the parent can share as an image. On the child's phone the child signs in with
the remembered ID and a large PIN keypad; 5 wrong PINs lock the login for 15 minutes and the parent can
reset the PIN, sign the child out everywhere or turn the login off. A parent only ever sees their own
household: any other child id answers 404. Admins sign in to the admin SPA with a parent account that
holds `ops.admin_permissions`.

## Changed
- Migrations: `0002_identity.sql` — `app.profiles`, `app.households(timezone)`,
  `app.household_memberships(OWNER|GUARDIAN)`, `app.students`, `app.child_credentials` (unique login id,
  argon2id `pin_hash`, `failed_attempts`, `locked_until`), `app.child_sessions` (sha-256 `token_hash`,
  `device_id`, `expires_at`, `revoked_at`), `ops.admin_permissions` (D11 names). Composite FKs keep
  credentials/sessions inside the student's household. `ops.rate_limit_hit()` (fixed windows on
  `ops.rate_limits`), `ops.cleanup_identity()` + pg_cron `vionx-identity-cleanup` (03:17 ICT). RLS on,
  no client grants.
- API routes (`/functions/v1/api/v1`): `GET /me`, `POST/GET /household`, `POST /students`,
  `GET/PATCH /students/{id}`, `POST /students/{id}/reset-pin|revoke-sessions|disable`,
  `POST /auth/child/login`, `POST /auth/child/logout`, `GET /auth/child/session`. Security schemes
  `bearerAuth` (parent Supabase JWT) and `childSession` (`x-vionx-child-session`). New error codes
  `INVALID_CREDENTIALS` (401), `ACCOUNT_LOCKED` (423), `ACCOUNT_DISABLED` (403); `RATE_LIMITED` sends
  `Retry-After`.
- Shared: `LiveActorResolver` (service secret → system; child token → child; Supabase JWT verified with
  `jose` against the project JWKS, optional legacy HS256 secret → parent), `requirePermission`
  (admin = parent + permission, SUPER_ADMIN implies all), `scoped()` household filter, argon2id via
  `hash-wasm` (WASM; m=19 MiB, t=2, p=1), 32-byte child tokens.
- Events / audit: `identity.household_created`, `identity.child_created` (outbox; consumed as no-ops by
  the worker until a subscriber exists); audit `student.pin_reset`, `student.sessions_revoked`,
  `student.disabled`, `student.enabled`.
- Worker / cron jobs: no new queue handlers; daily identity cleanup cron (SQL).
- Domain (`packages/domain/src/identity`): login id, PIN, lockout, sliding session, student profile,
  household, admin permissions, child-login rate limits.
- Mobile screens: bootstrap router (child-device mode / child session / parent session), parent
  sign-in (OTP + Google), create household, children list, add child, credential card (share as PNG via
  `react-native-view-shot` + `expo-sharing`), child detail (reset PIN with optional chosen PIN, sign out
  everywhere, turn off/on), "use this phone for my child"; child login (remembered ID + keypad), child
  home placeholder + sign-out. Token in `expo-secure-store`; parent session in AsyncStorage (Supabase).
- Admin screens: real sign-in (email/password for the local SUPER_ADMIN, Google OAuth button), shell
  gated on `GET /v1/me` admin permissions, sign-out.
- Config / env vars: `supabase/config.toml` phone sign-up, test OTPs `84900000001..3 = 123456`, placeholder
  SMS provider (local only), raised local auth rate limits, commented Google provider. New env:
  `SUPABASE_JWT_SECRET`, `SUPABASE_JWKS_URL` (optional, functions); `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`. Seed: SUPER_ADMIN `admin@vionx.local`, demo parent `+84900000001` with
  children `vx-demy22/66/99` (grades 2/6/9, PIN 2468). CI runs `pnpm acceptance m01`.

## Evidence
- `pnpm lint`, `pnpm typecheck` (incl. `deno check`), `pnpm openapi:check`: green.
- `pnpm test`: domain 31, tokens 2, ai 20, contracts 1, functions 41, admin 5, mobile 13 (Vitest)
  + 4 (Jest component tests) — all passed.
- `pnpm test:api` (local Supabase after `supabase db reset`): 33/33 (8 M00 + 25 M01), including
  cross-household 404 on GET/PATCH/reset-pin/revoke-sessions/disable for a foreign parent and a parent
  without a household, phone OTP JWT, lockout, disable, sliding/expired sessions, rate limits (429 +
  Retry-After), no client privileges on the new tables.
- argon2id in the Edge Runtime: PIN hashing/verification runs through the served `api` function
  (login ≈ 0.1-0.3 s end to end locally); `deno check` passes with `npm:hash-wasm@4.12.0`.
- `pnpm acceptance m01`: 9 passed, 0 failed, 1 skipped (Maestro). `pnpm acceptance m00` re-run: 7 passed,
  0 failed, 2 skipped (unchanged: `ai:check` without key, Android emulator).
- `pnpm --filter @vionx/admin build`: passes. `expo export --platform android`: 5 MB Hermes bundle.
- Maestro flow result + screenshots: not run (no emulator here). Flow: `apps/mobile/.maestro/m01-identity.yaml`.
- Build link: none. AI cost: US$0 (no model calls in M01).

## Decisions
- Added `GET /v1/me` (needed to route a signed-in parent and to gate the admin SPA) and
  `GET /v1/auth/child/session` (the app validates a stored child token at start; also extends the
  sliding expiry). Not in the task pack's endpoint list.
- One household per parent in v1: `POST /v1/household` answers 409 when the parent already belongs to
  one; `GET /v1/household` returns the household and its children (the children list). GUARDIAN exists
  in the schema; invites are a later module.
- `POST /students/{id}/disable` takes optional `{ "disabled": false }` to re-enable (no separate enable
  route). Disabling revokes all sessions. `reset-pin` takes an optional `pin` (otherwise a 6-digit,
  non-trivial PIN is generated) and optional `revokeSessions`.
- Lock rule: the 5th consecutive wrong PIN locks for 15 minutes and resets the counter; attempts during
  the lock are refused without counting; a correct PIN or a parent reset clears it. Wrong PIN on a
  disabled login still reads as a wrong PIN; `ACCOUNT_DISABLED` only follows a correct PIN.
- Rate limits: 30 attempts / 15 min per device id, 12 / 15 min per login id (above the lock threshold),
  in `ops.rate_limits`. Unknown login ids run a dummy argon2 verification (timing parity).
- Login ids are lower case, alphabet `23456789abcdefghjkmnpqrstuvwxyz` (no 0/o/1/i/l); input is
  normalised (`VX DEMY22` → `vx-demy22`).
- The api keeps using `SUPABASE_DB_URL` (role `postgres`); isolation is enforced by `scoped()` and the
  cross-household tests. A dedicated low-privilege DB role is deferred (pooler compatibility of
  `SET ROLE` needs checking on the hosted project) to M09/M22.
- Parent JWTs are verified locally with the JWKS (asymmetric keys, the default for new projects); the
  legacy HS256 path is opt-in via `SUPABASE_JWT_SECRET`.
- Google Sign-In on Android uses autolinking only; the library's Expo config plugin is not added (it
  requires Firebase files or an iOS URL scheme, and the app is Android-only).
- Mobile component tests use Jest 29 + jest-expo 57 + Testing Library 13 (`*.test.tsx`); pure helpers
  stay on Vitest (`*.test.ts`).
- M00 test fix: the `ai-batch` integration test now matches its row by prompt version too (fake batch
  ids restart per isolate, which made repeated runs fail). M00 Maestro flow now expects the parent
  sign-in screen instead of the M00 placeholder.

## Privacy & security impact
New personal data: parent profile (display name), household name/timezone, child display name, birth
year, grade, avatar preset; no child email/phone/photo. PINs are stored only as argon2id hashes, child
tokens only as sha-256; the PIN is shown once on the credential card and is never kept in app storage or
route params. Audit logs for PIN reset, session revoke, disable/enable. RLS on all new tables, no
client grants; library tables untouched. No consent checks yet (M02); no AI, microphone, health or
competition features touched.

## Known issues / follow-ups
- Not verifiable here: Maestro flow on an emulator, native Google Sign-In (needs OAuth clients and an
  Android dev build), real SMS delivery (M22), CI run on the PR.
- Admin SPA has no Playwright smoke yet (contract §8); sign-in was verified through the API
  (`/v1/me` returns `SUPER_ADMIN` for the seeded admin) and the build.
- Local auth rate limits are raised in `config.toml`; hosted defaults stay.
- GUARDIAN invitations, household rename, child deletion (privacy centre) are later modules.

## What the next module can rely on
- Actors in every route: `c.get('actor')` → `parent {userId, phone, email}` / `child {childId,
  householdId, sessionId}` / `system`; guards `requireActor`, `requirePermission(actor, deps.admins, …)`.
- `scopeFor(sql, actor)` / `scoped(sql, ids)` and `scope.where('alias.household_id')` for every
  child-data query; return 404 for rows outside the scope.
- Tables `app.households` (timezone for `localDay`), `app.students` (`grade`, `birth_year` for age-based
  consent in M02), `app.household_memberships`.
- Events `identity.household_created`, `identity.child_created` in the outbox.
- `repo.writeAudit` / `repo.writeEvent` helpers (`supabase/functions/api/identity/repo.ts`).
- Mobile: `parentApi` / `childApi` typed clients, `useLoad` + `StateView` for screen states,
  `describeError` for user-facing errors. Test helpers `scripts/lib/local-supabase.ts`.

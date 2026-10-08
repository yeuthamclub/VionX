# M01 Plan — Identity & household

Branch: `m01-identity`, stacked on `m00-foundation` (PR #1, green, awaiting owner-side checks; the owner
asked to proceed, so M00 is treated as done for dependency purposes).
Scope: `TASK_PACKS/M01.md`. Refs: Master Spec §2, §6.1, §24, §27.

## Steps (CLAUDE.md working-loop order)
1. **Migration `0002_identity.sql`**: `app.profiles`, `app.households`, `app.household_memberships`
   (OWNER|GUARDIAN), `app.students`, `app.child_credentials` (login id unique, argon2id `pin_hash`,
   `failed_attempts`, `locked_until`), `app.child_sessions` (sha-256 `token_hash`, `device_id`,
   `expires_at`, `revoked_at`), `ops.admin_permissions` (D11 names). Composite FKs keep
   credentials/sessions in the student's household. `ops.rate_limit_hit()` (fixed-window counter on
   `ops.rate_limits`), `ops.cleanup_identity()` + daily pg_cron job. RLS on, no client grants.
   Local auth config: phone sign-up, test OTPs (`+84900000001..3` / `123456`), placeholder SMS provider,
   Google provider documented (disabled locally).
2. **Domain `packages/domain/src/identity`**: login id (`vx-` + 6 unambiguous chars, unbiased
   generator, normaliser), PIN (4-8 digits, generator avoiding trivial PINs), lockout (5 failures →
   15 min), child session (32-byte token, 30-day sliding expiry), student profile validation (name,
   birth year, grade, avatar), household (timezone, roles), admin permissions (D11, SUPER_ADMIN
   implies all), rate-limit windows. Vitest + fast-check property tests.
3. **API** (`supabase/functions/api/identity`, Zod schemas in `packages/contracts`):
   - Actor resolver: parent = Supabase JWT verified with `jose` against the project JWKS (optional
     HS256 legacy secret); child = opaque `x-vionx-child-session` token (sha-256 lookup, sliding
     expiry); system = service secret (M00). Admin = parent + `ops.admin_permissions` (`requirePermission`).
   - `scoped(ctx)` household filter used by every child-data query; cross-household → 404.
   - Routes: `GET /v1/me`, `POST/GET /v1/household`, `POST /v1/students`, `GET/PATCH /v1/students/:id`,
     `POST /v1/students/:id/{reset-pin,revoke-sessions,disable}`, `POST /v1/auth/child/login`,
     `POST /v1/auth/child/logout`.
   - argon2id via `hash-wasm` (WASM, runs in Deno Edge Runtime and Node).
   - Outbox event `identity.child_created`; audit logs for PIN reset, session revoke, disable.
   - Rate limits per device and per login id on child login.
   - Unit tests (Node, fakes) + integration tests against local Supabase incl. cross-household 404s.
   - `pnpm openapi`.
4. **Worker / cron**: no queue consumer needed for M01 events (no subscriber yet); daily
   `vionx-identity-cleanup` pg_cron job prunes old rate-limit windows and long-expired sessions.
5. **Admin**: real sign-in through Supabase Auth (email + password for the seeded local SUPER_ADMIN,
   Google OAuth button for hosted), `GET /v1/me` permission gate on the shell, sign-out.
6. **Mobile**: Supabase Auth client (phone OTP, native Google Sign-In code path + config), parent
   screens (sign in, create household, children list, add child, one-time credential card shared as
   an image, child detail with reset PIN / revoke sessions / disable, switch device to child mode),
   child screens (ID + PIN keypad, remembered ID, home, logout), child token in `expo-secure-store`.
   Loading / empty / error / offline states. Unit tests for pure helpers; Jest component tests.
7. **Seed**: SUPER_ADMIN user (local email/password), demo parent `+84900000001` with household and
   3 children (grades 2, 6, 9).
8. **Acceptance** `scripts/acceptance/m01.ts`: parent OTP → household → 3 children → child login →
   5 wrong PINs lock → parent resets PIN → child login OK (+ cross-household 404, audit/event rows).
   Maestro flow `apps/mobile/.maestro/m01-identity.yaml`.
9. Checks: lint, typecheck, unit tests, admin build, `expo export`, `pnpm test:api`,
   `pnpm acceptance m01` and `m00`. REPORT, ROADMAP, push.

## Remaining steps
All implementation steps are done and green locally (see M01_REPORT.md). Remaining items need the
owner's devices or accounts:
- Run `maestro test apps/mobile/.maestro/m01-identity.yaml` on an emulator with a development build.
- Create the Google OAuth clients and enable the Google provider (README) to exercise native Google Sign-In.
- CI run on the PR.

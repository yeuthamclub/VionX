# M02 Report

## Summary
Before a child can use VionX, the parent now reads and accepts the privacy policy and terms (version 1,
DRAFT) and turns on "core service" for each child; without that consent the child's ID + PIN login
answers `CONSENT_REQUIRED`. Each child has a consent screen with the six consent types, the full
history, and an assent card on the child's home for AI, microphone and health features when the child
is 7 or older. Revoking a consent takes effect at once (guarded calls answer `CONSENT_REQUIRED`, queued
jobs of that scope are dropped; revoking core service signs the child out). The Privacy Center lets a
parent download the household's data as a zip (24 h link), delete a child or the whole account; the
child is disabled at once and hard-deleted after 30 days. Google Play's account-deletion URL is the
public admin page `/delete-account`.

## Changed
- Migrations:
  - `0003_consent_privacy.sql`:
    - Tables:
      - `app.policy_versions`: append-only.
      - `app.policy_acceptances`.
      - `app.consent_records`: §6.1 fields. A guard trigger allows only status, revocation and assent
        transitions, and an ended record is final. A unique index allows one active grant per child
        and type.
      - `app.privacy_requests`.
      - `app.data_export_jobs`.
      - `app.data_deletion_jobs`.
    - Functions:
      - `app.policy_min_accepted_version()`.
      - `ops.cancel_consent_jobs()`, with the `ops.consent_job_queues` registry and the pgmq queue
        `ai_jobs`.
      - Ledger hook: `ops.ledger_registry`, `ops.ledger_append_only()` and
        `ops.anonymise_ledgers()`, for the M04 ledgers.
      - `ops.purge_due_deletions()`, run by the pg_cron job `vionx-privacy-purge` daily at 03:37 ICT.
    - Other:
      - Column `app.households.deletion_requested_at`.
      - Private Storage bucket `privacy-exports`.
      - RLS on all new tables; no client grants.
  - `0004_policy_v1.sql`: policy version 1 (vi and en), taken verbatim from `docs/legal`. A unit test
    keeps the two in sync.
- API routes:
  - Policies:
    - `GET /v1/policies/current` (public; adds acceptance state when a parent is signed in).
    - `POST /v1/policies/accept`.
  - Consents:
    - `GET /v1/students/{id}/consents`.
    - `POST …/consents/{type}/grant`, `…/revoke` and `…/child-assent`.
    - `GET /v1/child/consents/{type}`: the feature guard.
  - Export:
    - `POST /v1/privacy/export`: 202; limited to 3 a day.
    - `GET /v1/privacy/export/{jobId}`.
  - `GET /v1/privacy/overview`.
  - Deletion:
    - `POST /v1/students/{id}/delete-request`.
    - `POST /v1/account/delete-request`.
  - Child login now gates on CORE_SERVICE.
  - New error code `CONSENT_REQUIRED` (403), with `details.consentType` and `details.reason`.
  - `Student` gains `coreServiceConsent` and `deletionScheduledFor`.
- Worker / cron jobs:
  - `consent.revoked` cancels the queued jobs of that consent's scope.
  - `privacy.export_requested`:
    - Builds a zip with fflate (JSON per section, a README and a manifest).
    - Uploads it to the private bucket and marks the job READY for 24 h.
    - Calls the push notifier stub, which writes `notification.push_requested` to the outbox.
  - `privacy.deletion_requested` writes an audit entry.
  - Tick maintenance expires old exports and removes their files.
  - The purge itself runs as SQL through pg_cron.
- Mobile screens:
  - Policies screen, shown after sign-in when acceptance is needed.
  - Consent step after adding a child: CORE_SERVICE must be granted before the credential card
    appears.
  - Child consents screen with history and "delete child".
  - Privacy Center: consents per child, accepted policy versions, export with download, delete
    account.
  - Child assent screen and an assent card on the child's home.
- Admin screens: the public `/delete-account` route, outside the admin shell, with phone OTP or Google
  verification.
- Config / env vars:
  - `VIONX_PUBLIC_SUPABASE_URL` (functions): the base URL for signed download links.
  - Test OTP `84900000004` (Maestro M02).
  - Seed: the demo parent has accepted v1, and the demo children have CORE_SERVICE.
  - CI runs `pnpm acceptance m02`.
- Legal: `docs/legal/{privacy-policy,terms}.{vi,en}.md`, marked DRAFT. They disclose Supabase hosting
  in Singapore and AI processing by Anthropic.

## Evidence
All checks ran after `supabase db reset`.
- `pnpm lint`, `pnpm typecheck` (including `deno check`) and `pnpm openapi:check`: green.
- `pnpm test`: all passed.

  | Package | Tests |
  |---|---|
  | domain | 48 |
  | functions | 53 |
  | ai | 20 |
  | admin | 8 |
  | mobile (Vitest) | 19 |
  | mobile (Jest) | 7 |
  | tokens | 2 |
  | contracts | 1 |

- `pnpm test:api`: 62/62 passed. Coverage:
  - Cross-household 404 on every new child endpoint.
  - Re-consent after a new policy version.
  - Assent rules.
  - Revoke drops AI jobs.
  - Export contents and private bucket.
  - Rate limit.
  - Deletion and purge with ledger anonymisation.
  - Account ban.
  - No client privileges.
- Acceptance:
  - `pnpm acceptance m02`: 9 passed, 0 failed, 1 skipped (Maestro).
  - `m00` re-run: 7 passed, 2 skipped.
  - `m01` re-run: 9 passed, 1 skipped.
- Builds:
  - `pnpm --filter @vionx/admin build`: passes.
  - `expo export --platform android`: passes (4.9 MB Hermes bundle).
- Maestro: not run, because no emulator is available here. Flows:
  - `apps/mobile/.maestro/m02-consent.yaml` (new).
  - `m01-identity.yaml` and `subflows/m01-add-child.yaml`, updated for the policy and consent steps.
- AI cost: US$0.

## Decisions
- Consents are recorded against the PRIVACY_POLICY version. Grants must use the current version, or
  the API answers 409. A version marked `requires_reconsent` makes older grants ineffective with
  reason `RECONSENT_REQUIRED`.
- Child assent:
  - Required for AI_PERSONALIZATION, MICROPHONE_SPEAKING and HEALTH_CONNECT_ACTIVITY.
  - Applies when age ≥ 7, where age = household-local year − birth year (the upper bound, so the app
    asks rather than skips).
  - Until the child answers, the consent is not effective.
- Policy acceptance is enforced by the app flow, not by the API.
- Deletion:
  - A deletion request cannot be cancelled in v1, and a child scheduled for deletion cannot be
    re-enabled (409).
  - Account deletion disables the household, bans the parent's auth user and deletes their sessions.
    The purge deletes the household and any auth users left without one.
- Ledgers are anonymised in place: ids are replaced by `md5(id || random salt)`, and the salt is
  discarded.
- The push notifier is an outbox-event stub until the push module adds FCM.

## Privacy & security impact
- New data: policy acceptances (with a hashed device id), consent records, privacy requests, and
  export/deletion jobs. None of it is in the library tables.
- Exports cover only the caller's household. PIN hashes, token hashes and secrets are excluded.
- Every grant, revoke, assent, export request, link issue and deletion is written to the audit log
  (`consent.*`, `privacy.*`).
- `privacy_requests` is kept after the purge as proof of fulfilment.

## Known issues / follow-ups
- **Owner:**
  - Legal review of the drafts under Vietnamese PDP law, including the cross-border transfer impact
    assessment.
  - Fill in the bracketed placeholders (legal entity, contact email, URLs).
  - Set `VIONX_PUBLIC_SUPABASE_URL` on hosted functions.
  - Register `https://<admin-domain>/delete-account` in Play Console.
- The account purge and ban write to `auth.users` and `auth.sessions` with SQL. This needs a check on
  hosted Supabase; if it is refused, move it to the Auth admin API.
- After a purge, `ops.domain_events` and `ops.audit_logs` still hold raw ids. Decide on retention and
  scrubbing in the ops/observability module.
- EDUCATION_ANALYTICS and COMPETITION_AREA guards exist (`requireConsent`), but no feature uses them
  yet. `ai_jobs` has no consumer until the AI tutor module.
- Not verified here: the Maestro flows, real push delivery, and the emulator download link (needs
  `VIONX_PUBLIC_SUPABASE_URL=http://10.0.2.2:54321`).

## What the next module can rely on
- Consent checks:
  - `requireConsent(db, scope, studentId, type, now)` in `_shared/consent.ts` (throws `CONSENT_REQUIRED`).
  - `assertConsent` / `evaluateConsent` in `@vionx/domain`.
  - Call these before AI, microphone, health or competition features.
- Queues: register consent-scoped pgmq queues in `ops.consent_job_queues`, and put `student_id` in
  each message.
- Ledgers: register append-only ledgers in `ops.ledger_registry` with the `ops.ledger_append_only()`
  trigger.
- Exports: add data sections to `EXPORT_SECTIONS` in `supabase/functions/worker/privacy-export.ts`.
- Events: `consent.granted`, `consent.revoked`, `consent.child_assent_recorded`,
  `privacy.export_requested`, `privacy.deletion_requested`, `notification.push_requested`.
- Shared helpers: `ObjectStorage` (`_shared/storage.ts`) and `ParentNotifier` / `OutboxPushNotifier` (`_shared/notify.ts`).

# M02 Report

## Summary
Before a child can use VionX, the parent now reads and accepts the privacy policy and terms (version 1,
DRAFT), turns on "core service" for each child and then, as its own step, consents to the transfer of
the child's data abroad (`CROSS_BORDER_TRANSFER`); without both consents the child's ID + PIN login
answers `CONSENT_REQUIRED`. Each child has a consent screen with the seven consent types, the full
history, and an assent card on the child's home for AI, microphone and health features when the child
is 7 or older. Revoking a consent takes effect at once (guarded calls answer `CONSENT_REQUIRED`, queued
jobs of that scope are dropped; revoking core service signs the child out). The Privacy Center lets a
parent download the household's data as a zip (24 h link), delete a child or the whole account; the
child is disabled at once and hard-deleted after 14 days. Until then the parent can cancel the
request ("Hủy yêu cầu xóa" in the Privacy Center, with the days left). After a purge, audit logs and
domain events keep only pseudonymous ids for 1 year and are then deleted. Google Play's
account-deletion URL is the public admin page `/delete-account`.

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
    keeps the two in sync. Edited in place for the follow-up below (v1 has not shipped; PR #3 is
    unmerged).
  - `0005_deletion_cancel_retention.sql` (follow-up):
    - `app.data_deletion_jobs`: `restore_state`, `cancelled_at`, `cancelled_by`; CANCELLED iff
      `cancelled_at` is set.
    - `ops.audit_logs` / `ops.domain_events`: `purged_at`. Their append-only trigger becomes
      `ops.retained_log_guard()`: only the privacy functions below may change details/payload and
      `purged_at`, or delete.
    - `ops.strip_personal_fields(jsonb)`, `ops.scrub_purged_logs()`, and `ops.purge_due_deletions()`
      redefined to scrub and mark the retained rows.
    - `ops.delete_expired_purged_logs()`, run by the pg_cron job `vionx-purged-log-retention` daily at
      03:47 ICT, deletes them 365 days after the purge.
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
    - `POST /v1/students/{id}/delete-request/cancel` and `POST /v1/account/delete-request/cancel`
      (follow-up): 200 with the CANCELLED job; 404 when nothing is pending (including after the
      purge) or for another household; 409 once the purge is due. Audited
      (`privacy.*_deletion_cancelled`); emit `privacy.deletion_cancelled`.
  - While an account deletion is pending, every route except `GET /v1/me`,
    `GET /v1/policies/current`, `GET /v1/privacy/overview`, the account delete-request and its cancel
    answers 403 `ACCOUNT_DISABLED` with `details.reason = DELETION_PENDING`. `Me` gains
    `pendingAccountDeletion`; `DeletionJob` gains `cancelledAt`.
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
    account, and pending deletions with the days left and "Hủy yêu cầu xóa". A parent whose account
    deletion is pending is routed there after sign-in and sees only that section.
  - Child assent screen and an assent card on the child's home.
- `0006_cross_border_consent.sql` (legal review 2026-10-08): adds `CROSS_BORDER_TRANSFER` to the
  consent type checks of `app.consent_records` and `ops.consent_job_queues`; `ops.cancel_consent_jobs`
  treats it like CORE_SERVICE (revoking it drops every queued job of the child).
- Cross-border consent (code): `REQUIRED_FOR_CHILD_LOGIN`, `CONSENT_PREREQUISITES`,
  `requiredConsentsFor`, `evaluateWithPrerequisites` in `@vionx/domain`; `ConsentState.missingPrerequisite`
  and `Student.crossBorderTransferConsent` in contracts; child login and `requireConsent` check every
  required consent; the grant route refuses AI_PERSONALIZATION (403 `CONSENT_REQUIRED`) until
  CROSS_BORDER_TRANSFER is granted; the mobile consent step shows both required rows and Continue
  needs both.
- Admin screens: the public `/delete-account` route, outside the admin shell, with phone OTP or Google
  verification. Its text says the request can be cancelled in the app within 14 days.
- Config / env vars:
  - `VIONX_PUBLIC_SUPABASE_URL` (functions): the base URL for signed download links.
  - Test OTP `84900000004` (Maestro M02).
  - Seed: the demo parent has accepted v1, and the demo children have CORE_SERVICE and
    CROSS_BORDER_TRANSFER.
  - CI runs `pnpm acceptance m02`.
- Legal: `docs/legal/{privacy-policy,terms}.{vi,en}.md`, marked DRAFT. They disclose Supabase hosting
  in Singapore and AI processing by Anthropic. Follow-up edits are limited to: cancellation during
  the grace period and 1-year retention of pseudonymous logs (privacy policy, section 6), and 30 → 14
  days (privacy policy and terms). Then, per the legal review (`VionX_ra_soat_phap_ly_vi.md`, sections
  2-3): a table of every recipient abroad (Supabase, Anthropic, Google, [SMS provider], Sentry) with
  purpose, data, country and safeguards; the separate cross-border consent; possibly sensitive data
  (Health Connect, learning analytics) and its separate consents; response deadlines for data-subject
  requests; 72-hour breach notice to MPS and to parents; a DPO placeholder; the right to complain to
  MPS; "pseudonymised" instead of "anonymous" for logs; AI-content labelling; in the terms, a liability
  clause that does not exclude mandatory liability, notice of changes, consumer complaint channels,
  and "the version more favourable to you applies" between vi and en. Nothing about moving data to
  Vietnam (pending decision). Migration 0004 holds the same text.

## Evidence
All checks ran after `supabase db reset`.
- `pnpm lint`, `pnpm typecheck` (including `deno check`) and `pnpm openapi:check`: green.
- `pnpm test`: all passed.

  | Package | Tests |
  |---|---|
  | domain | 59 |
  | functions | 64 |
  | ai | 20 |
  | admin | 8 |
  | mobile (Vitest) | 22 |
  | mobile (Jest) | 7 |
  | tokens | 2 |
  | contracts | 1 |

- `pnpm test:api`: 72/72 passed. Coverage:
  - Cross-household 404 on every new child endpoint.
  - Re-consent after a new policy version.
  - Assent rules.
  - Revoke drops AI jobs.
  - Export contents and private bucket.
  - Rate limit.
  - Deletion and purge with ledger anonymisation.
  - Account deletion: sign-out, ACCOUNT_DISABLED gate, sign-in again to cancel.
  - Cancellation: child and account, cross-household 404, 409 once due, 404 after the purge, a child
    disabled before the request stays disabled, the purge skips cancelled jobs.
  - Retention: personal fields scrubbed at purge, rows kept at +364 days and deleted at +366 days
    (with their `processed_events`), unrelated rows untouched, append-only still enforced.
  - Cross-border consent: login blocked until it is granted, AI grant refused without it
    (403), revoking it signs the child out and marks AI `PREREQUISITE_MISSING`.
  - No client privileges.
- Acceptance:
  - `pnpm acceptance m02`: 11 passed, 0 failed, 1 skipped (Maestro).
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
- Cross-border transfer (legal review 2026-10-08, Law 91/2025 Art. 9(4): one consent per purpose):
  - `CROSS_BORDER_TRANSFER` is its own consent per child, granted in a separate step after
    CORE_SERVICE and never bundled into policy acceptance.
  - Required with CORE_SERVICE for child login (`REQUIRED_FOR_CHILD_LOGIN`): storage is in Singapore,
    so the service cannot run without it. Revoking it ends the service like CORE_SERVICE (sessions
    revoked, every queue scope dropped).
  - AI_PERSONALIZATION requires it (`CONSENT_PREREQUISITES`): granting AI first answers 403; if it is
    revoked later, AI shows as not effective with reason `PREREQUISITE_MISSING`.
  - No child assent: it is a parent decision, like CORE_SERVICE.
- Deletion (product owner decisions 2026-10-08, grace period changed by legal review):
  - Grace period: **14 days** (`DELETION_GRACE_DAYS` in `@vionx/domain`, the single value used by
    the api, the app, the admin page and the tests). Decree 356/2025 Art. 5(4) requires deletion
    within 20 days; the daily purge completes at the latest on day 15.
  - The parent can cancel a child or account deletion during the grace period. Cancelling marks the
    job and its privacy request CANCELLED (the purge only takes SCHEDULED jobs), restores the login,
    writes an audit log and emits `privacy.deletion_cancelled`. Child sessions revoked by the
    request stay revoked; a child the parent had disabled before the request stays disabled.
  - A child scheduled for deletion cannot be re-enabled through `/disable` (409); cancelling is the
    way back.
  - Account deletion no longer bans the parent's auth user: a banned user cannot sign in, so they
    could never cancel. Instead the request deletes their sessions, hides the household, disables the
    children, and the api answers `ACCOUNT_DISABLED` (`DELETION_PENDING`) to everything except the
    deletion status and cancel routes. The purge deletes the household and any auth users left
    without one.
  - Cancel is refused (409) once `purge_after` has passed, even if the cron has not run yet.
- Retention after a purge: audit logs and domain events about the purged child/household/accounts
  are kept for 1 year with pseudonymous ids only. At purge time personal keys (names, phone, email,
  address, birth date, login id, raw device id, IP, user agent; `PERSONAL_DATA_KEYS`, mirrored in
  SQL and kept in sync by a test) are stripped from `details`/`payload` and `purged_at` is set; the
  daily job deletes the rows 365 days later. Today's writers store ids only, so the scrub is a
  safeguard. `privacy_requests` and `data_deletion_jobs` (ids only) are still kept as proof of
  fulfilment.
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

## Owner actions
Required before release (legal review 2026-10-08):
- Appoint a personal data protection officer (DPO) and fill in the contact placeholder in the privacy
  policy.
- File the personal data processing impact assessment and the cross-border transfer impact assessment
  with the MPS personal data protection authority within 60 days of starting processing, and update
  them every 6 months.
- Sign data processing agreements with the foreign processors: Supabase, Anthropic, the SMS provider
  and Sentry (and confirm Google's terms for sign-in).
- Get a lawyer's confirmation on data localisation (whether family data may stay in Singapore).

## Known issues / follow-ups
- **Owner:**
  - Legal review of the drafts under Vietnamese PDP law, including the cross-border transfer impact
    assessment.
  - Fill in the bracketed placeholders (legal entity, contact email, URLs).
  - Set `VIONX_PUBLIC_SUPABASE_URL` on hosted functions.
  - Register `https://<admin-domain>/delete-account` in Play Console.
- The account purge and ban write to `auth.users` and `auth.sessions` with SQL. This needs a check on
  hosted Supabase; if it is refused, move it to the Auth admin API.
- The Maestro flow does not cover cancellation (Alert buttons share their label with the screen
  button, so a reliable selector needs an emulator to check). Covered by API tests and acceptance.
- EDUCATION_ANALYTICS and COMPETITION_AREA guards exist (`requireConsent`), but no feature uses them
  yet. `ai_jobs` has no consumer until the AI tutor module.
- Not verified here: the Maestro flows, real push delivery, and the emulator download link (needs
  `VIONX_PUBLIC_SUPABASE_URL=http://10.0.2.2:54321`).

## What the next module can rely on
- Consent checks:
  - `requireConsent(db, scope, studentId, type, now)` in `_shared/consent.ts` (throws `CONSENT_REQUIRED`;
    also checks the type's prerequisites, so AI checks include CROSS_BORDER_TRANSFER).
  - `assertConsent` / `evaluateConsent` in `@vionx/domain`.
  - Call these before AI, microphone, health or competition features.
- Queues: register consent-scoped pgmq queues in `ops.consent_job_queues`, and put `student_id` in
  each message.
- Ledgers: register append-only ledgers in `ops.ledger_registry` with the `ops.ledger_append_only()`
  trigger.
- Exports: add data sections to `EXPORT_SECTIONS` in `supabase/functions/worker/privacy-export.ts`.
- Events: `consent.granted`, `consent.revoked`, `consent.child_assent_recorded`,
  `privacy.export_requested`, `privacy.deletion_requested`, `privacy.deletion_cancelled`,
  `notification.push_requested`.
- Retention: modules writing audit logs or events about a child should put the child id in
  `target_id`/`aggregate_id` or a `studentId` field so the purge scrub finds the rows.
- Shared helpers: `ObjectStorage` (`_shared/storage.ts`) and `ParentNotifier` / `OutboxPushNotifier` (`_shared/notify.ts`).

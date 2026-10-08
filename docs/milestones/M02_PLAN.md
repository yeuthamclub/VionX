# M02 Plan — Consent & privacy core

Branch: `m02-consent` from `main` (M00 and M01 merged).
Scope: `TASK_PACKS/M02.md`. Refs: Master Spec §6.1, §27, §34; CONTRACT §5; ARCHITECTURE §6.

## Model
- **Policies** (`app.policy_versions`): `PRIVACY_POLICY` and `TERMS_OF_SERVICE`, integer versions per
  locale (vi, en), append-only. The current version is the highest one already effective; a version
  with `requires_reconsent` invalidates consents granted against older versions.
- **Parent acceptance** (`app.policy_acceptances`): the parent onboarding consent step records which
  policy versions the parent accepted (Privacy Center "accepted policy versions").
- **Consents** (`app.consent_records`, fields per §6.1): one row per grant, per child and consent
  type, recorded against the privacy-policy version. Revoke ends the row (`REVOKED`); a new grant on
  a newer version supersedes the old row (`SUPERSEDED`). Rows are never rewritten (a trigger allows
  only status/assent transitions), so the table is the consent history.
- **Effective consent** (domain `evaluateConsent` / `assertConsent`): granted, not revoked, policy
  version still accepted, and child assent given when required (age ≥ 7 for AI_PERSONALIZATION,
  MICROPHONE_SPEAKING, HEALTH_CONNECT_ACTIVITY; age = household-local year − birth year, i.e. the
  oldest the child can be, so we ask rather than skip).
- **Privacy requests**: `app.privacy_requests` (EXPORT, DELETE_CHILD, DELETE_ACCOUNT; outlives the
  purge as proof of fulfilment), `app.data_export_jobs`, `app.data_deletion_jobs`.

## Steps (CLAUDE.md working-loop order)
1. **Migrations**
   - `0003_consent_privacy.sql`: tables above; `app.households.deletion_requested_at`; private
     Storage bucket `privacy-exports`; `ops.consent_job_queues` registry + pgmq queue `ai_jobs`
     (AI_PERSONALIZATION; consumer arrives with M15) + `ops.cancel_consent_jobs()`;
     ledger anonymisation hook (`ops.ledger_registry`, `ops.anonymise_ledgers()`,
     `ops.ledger_append_only()` for M04 ledgers); `ops.purge_due_deletions()` + daily pg_cron job
     `vionx-privacy-purge`; RLS on, no client grants.
   - `0004_policy_v1.sql`: version 1 of the privacy policy and terms (vi + en) from `docs/legal/`.
2. **Domain** `packages/domain/src/consent`: consent types, assent age rule, policy version rules,
   `evaluateConsent` / `assertConsent`, grant planning (noop / insert / supersede), revocation scope,
   export link TTL (24 h), deletion grace (30 days), export rate limit. Vitest + fast-check.
3. **API** `supabase/functions/api/privacy` (+ Zod in `packages/contracts/src/privacy.ts`):
   `GET /v1/policies/current`, `POST /v1/policies/accept`, `GET /v1/students/:id/consents`,
   `POST /v1/students/:id/consents/:type/grant|revoke|child-assent`, `GET /v1/child/consents/:type`
   (feature guard), `POST /v1/privacy/export`, `GET /v1/privacy/export/:jobId`,
   `GET /v1/privacy/overview`, `POST /v1/students/:id/delete-request`,
   `POST /v1/account/delete-request`. `_shared/consent.ts` `requireConsent()` (CONSENT_REQUIRED).
   Child login requires an effective CORE_SERVICE consent; revoking CORE_SERVICE signs the child out.
   A child with a pending deletion cannot be re-enabled. Outbox events `consent.granted`,
   `consent.revoked`, `consent.child_assent_recorded`, `privacy.export_requested`,
   `privacy.deletion_requested`; audit logs for every grant/revoke/request.
   Cross-household 404 tests for every new endpoint.
4. **Worker / cron**: handlers `consent.revoked` (drop queued jobs of that scope via
   `ops.cancel_consent_jobs`), `privacy.export_requested` (zip the household's JSON with `fflate`,
   upload to the private bucket, mark READY with a 24 h expiry, call the parent notifier — a stub that
   writes `notification.push_requested` to the outbox until M09 adds FCM); tick maintenance removes
   expired export files. pg_cron `vionx-privacy-purge` hard-deletes after 30 days.
5. **Admin**: public `/delete-account` page (no admin login): explains deletion, lets a parent verify
   with phone OTP (or Google) and submit `POST /v1/account/delete-request`.
6. **Mobile**: parent onboarding consent step (policies), per-child consent screen (also the step
   after adding a child), Privacy Center (consents per child with history, accepted policy versions,
   export, delete child, delete account), child assent screen; CONSENT_REQUIRED messages.
7. **Seed**: demo parent accepts policy v1; demo children have CORE_SERVICE.
8. **Legal drafts** `docs/legal/` (vi + en), marked DRAFT: Singapore hosting, AI processing by
   Anthropic, speech on device.
9. **Acceptance** `scripts/acceptance/m02.ts`; Maestro `apps/mobile/.maestro/m02-consent.yaml`;
   M01 tests/acceptance/Maestro updated for the CORE_SERVICE gate.
10. Checks: lint, typecheck, unit tests, admin build, `expo export`, `pnpm test:api`,
    `pnpm acceptance m02` (+ m00, m01). REPORT, ROADMAP, push.

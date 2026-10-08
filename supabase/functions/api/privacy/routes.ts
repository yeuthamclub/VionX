import { createRoute, type OpenAPIHono, type z } from '@hono/zod-openapi';
import {
  canCancelDeletion,
  canRecordAssent,
  childAssentRequired,
  CONSENT_POLICY_TYPE,
  CONSENT_TYPES,
  currentPolicyVersion,
  EXPORT_RATE_LIMIT,
  evaluateConsent,
  exportRateLimitBucket,
  isOverLimit,
  minimumAcceptedVersion,
  needsPolicyAcceptance,
  planGrant,
  POLICY_TYPES,
  purgeAfter,
  remainingLinkSeconds,
  retryAfterSeconds,
  revocationEndsSessions,
  revocationScope,
  studentsToReenable,
  type ConsentType,
  type PolicyLocale,
  type PolicyType,
  type PolicyVersionInfo,
} from '@vionx/domain';
import { requireActor, type Actor } from '../../_shared/actor.ts';
import {
  consentHistory,
  latestConsent,
  policyVersions,
  requireConsent,
  toRecordState,
  type ConsentRow,
} from '../../_shared/consent.ts';
import { sha256Hex } from '../../_shared/crypto.ts';
import { ApiError } from '../../_shared/errors.ts';
import { parentHouseholds, scoped, scopeFor, type Scope } from '../../_shared/scope.ts';
import { PRIVACY_EXPORT_BUCKET } from '../../_shared/storage.ts';
import type { AppEnv } from '../app.ts';
import type { ApiDeps } from '../deps.ts';
import {
  rateLimitHit,
  revokeSessions,
  setDisabled,
  writeAudit,
  writeEvent,
} from '../identity/repo.ts';
import { body, CHILD, errorResponses, iso, json, PARENT } from '../route-helpers.ts';
import * as repo from './repo.ts';
import {
  ChildAssentRequestSchema,
  ChildConsentCheckResponseSchema,
  ConsentGrantRequestSchema,
  ConsentParamsSchema,
  ConsentRevokeRequestSchema,
  ConsentStateSchema,
  ConsentTypeParamSchema,
  DeleteRequestSchema,
  DeletionResponseSchema,
  ExportJobParamSchema,
  ExportJobResponseSchema,
  PoliciesQuerySchema,
  PoliciesResponseSchema,
  PolicyAcceptRequestSchema,
  PolicyAcceptResponseSchema,
  PrivacyOverviewResponseSchema,
  StudentConsentsResponseSchema,
  StudentIdParamSchema,
  type ConsentRecord,
  type ConsentState,
  type DeletionJob,
  type ExportJob,
} from './schemas.ts';

const PARENT_OR_CHILD = [...PARENT, ...CHILD];

// --- Route definitions ----------------------------------------------------------------------------

const policiesRoute = createRoute({
  method: 'get',
  path: '/v1/policies/current',
  tags: ['privacy'],
  summary: 'Current privacy policy and terms',
  description:
    'Public. With a parent token the response also lists the parent’s acceptances and whether the current versions still need accepting (onboarding consent step).',
  security: [{}, ...PARENT],
  request: { query: PoliciesQuerySchema },
  responses: {
    200: json(PoliciesResponseSchema, 'Policies in force'),
    ...errorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE'),
  },
});

const acceptRoute = createRoute({
  method: 'post',
  path: '/v1/policies/accept',
  tags: ['privacy'],
  summary: 'Accept policy versions (parent onboarding consent step)',
  description: 'Versions must be the current ones (409 CONFLICT otherwise). Idempotent.',
  security: PARENT,
  request: body(PolicyAcceptRequestSchema),
  responses: {
    200: json(PolicyAcceptResponseSchema, 'All acceptances of this parent'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'CONFLICT'),
  },
});

const consentsRoute = createRoute({
  method: 'get',
  path: '/v1/students/{id}/consents',
  tags: ['privacy'],
  summary: 'A child’s consents and their history',
  description:
    'Parent: any child of the household. Child: only their own id (assent screen). Other ids answer 404.',
  security: PARENT_OR_CHILD,
  request: { params: StudentIdParamSchema },
  responses: {
    200: json(StudentConsentsResponseSchema, 'Consents'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const grantRoute = createRoute({
  method: 'post',
  path: '/v1/students/{id}/consents/{type}/grant',
  tags: ['privacy'],
  summary: 'Grant a consent for a child',
  description:
    'Recorded against the current PRIVACY_POLICY version (409 if `policyVersion` is not current). Idempotent for the same version; a grant on a newer version supersedes the old record. AI, microphone and health grants for a child aged 7+ wait for the child’s assent. Audited; emits `consent.granted`.',
  security: PARENT,
  request: { params: ConsentParamsSchema, ...body(ConsentGrantRequestSchema) },
  responses: {
    200: json(ConsentStateSchema, 'Consent state after the grant'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND', 'CONFLICT'),
  },
});

const revokeRoute = createRoute({
  method: 'post',
  path: '/v1/students/{id}/consents/{type}/revoke',
  tags: ['privacy'],
  summary: 'Revoke a consent',
  description:
    'Takes effect immediately and emits `consent.revoked`; the worker drops queued jobs of that scope. Revoking CORE_SERVICE also signs the child out everywhere. Idempotent. Audited.',
  security: PARENT,
  request: { params: ConsentParamsSchema, ...body(ConsentRevokeRequestSchema, false) },
  responses: {
    200: json(ConsentStateSchema, 'Consent state after the revocation'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const assentRoute = createRoute({
  method: 'post',
  path: '/v1/students/{id}/consents/{type}/child-assent',
  tags: ['privacy'],
  summary: 'The child agrees or declines (assent)',
  description:
    'Child actor, own id only. Allowed once per grant that needs assent (409 otherwise). Audited; emits `consent.child_assent_recorded`.',
  security: CHILD,
  request: { params: ConsentParamsSchema, ...body(ChildAssentRequestSchema) },
  responses: {
    200: json(ConsentStateSchema, 'Consent state after the answer'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'),
  },
});

const childCheckRoute = createRoute({
  method: 'get',
  path: '/v1/child/consents/{type}',
  tags: ['privacy'],
  summary: 'Consent guard for a child feature',
  description:
    'The child app calls this before opening a consent-guarded feature (AI, microphone, health, competition area). 403 CONSENT_REQUIRED with `details.reason` when the consent is not in force.',
  security: CHILD,
  request: { params: ConsentTypeParamSchema },
  responses: {
    200: json(ChildConsentCheckResponseSchema, 'Consent in force'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'CONSENT_REQUIRED'),
  },
});

const exportRoute = createRoute({
  method: 'post',
  path: '/v1/privacy/export',
  tags: ['privacy'],
  summary: 'Export the household’s data',
  description:
    'Queues a job: the worker zips the household’s JSON into private storage, then notifies the parent. Returns the running job if one exists. 3 requests per household per day. Audited.',
  security: PARENT,
  responses: {
    202: json(ExportJobResponseSchema, 'Queued (or already running)'),
    ...errorResponses('UNAUTHENTICATED', 'NOT_FOUND', 'RATE_LIMITED'),
  },
});

const exportJobRoute = createRoute({
  method: 'get',
  path: '/v1/privacy/export/{jobId}',
  tags: ['privacy'],
  summary: 'Export status and download link',
  description:
    'When READY, `downloadUrl` is a signed URL valid until `expiresAt` (24 hours after completion).',
  security: PARENT,
  request: { params: ExportJobParamSchema },
  responses: {
    200: json(ExportJobResponseSchema, 'Job'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE'),
  },
});

const overviewRoute = createRoute({
  method: 'get',
  path: '/v1/privacy/overview',
  tags: ['privacy'],
  summary: 'Privacy Center overview',
  description: 'Accepted policy versions, recent exports, deletions and privacy requests.',
  security: PARENT,
  responses: {
    200: json(PrivacyOverviewResponseSchema, 'Overview'),
    ...errorResponses('UNAUTHENTICATED'),
  },
});

const deleteChildRoute = createRoute({
  method: 'post',
  path: '/v1/students/{id}/delete-request',
  tags: ['privacy'],
  summary: 'Delete a child’s profile',
  description:
    'The child login is turned off and every session revoked at once; the profile is hard-deleted after the 14-day grace period, during which the parent can cancel (ledgers anonymised). Idempotent. Audited.',
  security: PARENT,
  request: { params: StudentIdParamSchema, ...body(DeleteRequestSchema) },
  responses: {
    202: json(DeletionResponseSchema, 'Deletion scheduled'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const deleteAccountRoute = createRoute({
  method: 'post',
  path: '/v1/account/delete-request',
  tags: ['privacy'],
  summary: 'Delete the parent account and household data',
  description:
    'Owner: the household is hidden, every child login turned off and the parent signed out everywhere at once; until the purge the parent can still sign in, but every route except this one, its cancel, `GET /v1/me`, `GET /v1/policies/current` and `GET /v1/privacy/overview` answers 403 ACCOUNT_DISABLED (`details.reason` DELETION_PENDING). Everything is hard-deleted after the 14-day grace period (ledgers anonymised). Reachable in the app and from the public web page. Idempotent. Audited.',
  security: PARENT,
  request: body(DeleteRequestSchema),
  responses: {
    202: json(DeletionResponseSchema, 'Deletion scheduled'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED'),
  },
});

const cancelChildDeletionRoute = createRoute({
  method: 'post',
  path: '/v1/students/{id}/delete-request/cancel',
  tags: ['privacy'],
  summary: 'Cancel a child’s pending deletion',
  description:
    'During the 14-day grace period: the job becomes CANCELLED (the purge skips it) and the child can sign in again (unless the parent had disabled the child before the request; sessions revoked by the request stay revoked). 404 when there is no pending deletion (including after the purge) or for another household’s child; 409 once the purge is due. Audited; emits `privacy.deletion_cancelled`.',
  security: PARENT,
  request: { params: StudentIdParamSchema },
  responses: {
    200: json(DeletionResponseSchema, 'Deletion cancelled'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND', 'CONFLICT'),
  },
});

const cancelAccountDeletionRoute = createRoute({
  method: 'post',
  path: '/v1/account/delete-request/cancel',
  tags: ['privacy'],
  summary: 'Cancel the pending account deletion',
  description:
    'During the 14-day grace period: the job becomes CANCELLED (the purge skips it), the account works again, the household is visible again and its children can sign in (except those disabled before the request or with their own pending deletion). 404 when there is no pending account deletion; 409 once the purge is due. Audited; emits `privacy.deletion_cancelled`.',
  security: PARENT,
  responses: {
    200: json(DeletionResponseSchema, 'Deletion cancelled'),
    ...errorResponses('UNAUTHENTICATED', 'NOT_FOUND', 'CONFLICT'),
  },
});

// --- Mapping ---------------------------------------------------------------------------------------

function toRecord(row: ConsentRow): ConsentRecord {
  return {
    id: row.id,
    consentType: row.consent_type,
    policyVersion: row.policy_version,
    status: row.status,
    grantedAt: iso(row.granted_at)!,
    grantedByParentId: row.granted_by_parent_id,
    revokedAt: iso(row.revoked_at),
    revokedByType: row.revoked_by_type,
    childAssentRequired: row.child_assent_required,
    childAssentStatus: row.child_assent_status,
    childAssentAt: iso(row.child_assent_at),
  };
}

function toState(
  type: ConsentType,
  record: ConsentRow | null,
  minimumVersion: number,
  student: repo.ConsentStudentRow,
  now: Date,
): ConsentState {
  const evaluation = evaluateConsent(record ? toRecordState(record) : null, minimumVersion);
  return {
    type,
    effective: evaluation.effective,
    reason: evaluation.effective ? null : evaluation.reason,
    record: record ? toRecord(record) : null,
    childAssentRequiredNow: childAssentRequired(type, student.birth_year, now, student.timezone),
  };
}

function toExportJob(row: repo.ExportJobRow, downloadUrl: string | null, now: Date): ExportJob {
  const expired =
    row.status === 'READY' && row.expires_at !== null && new Date(row.expires_at) <= now;
  return {
    id: row.id,
    status: expired ? 'EXPIRED' : row.status,
    requestedAt: iso(row.created_at)!,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    expiresAt: iso(row.expires_at),
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    downloadUrl,
  };
}

function toDeletion(row: repo.DeletionJobRow): DeletionJob {
  return {
    id: row.id,
    scope: row.scope,
    studentId: row.student_id,
    status: row.status,
    requestedAt: iso(row.requested_at)!,
    purgeAfter: iso(row.purge_after)!,
    completedAt: iso(row.completed_at),
    cancelledAt: iso(row.cancelled_at),
  };
}

/** Throws the API error for a deletion that cannot be cancelled (domain rule canCancelDeletion). */
function assertCancellable(job: repo.DeletionJobRow | null, t: Date): repo.DeletionJobRow {
  const check = canCancelDeletion(
    job ? { status: job.status, purgeAfter: new Date(job.purge_after) } : null,
    t,
  );
  if (!check.ok) {
    if (check.error === 'GRACE_PERIOD_OVER') {
      throw new ApiError(
        'CONFLICT',
        'The grace period is over; the deletion can no longer be cancelled',
        {
          reason: check.error,
        },
      );
    }
    throw new ApiError('NOT_FOUND', 'No pending deletion');
  }
  return job!;
}

const hashDevice = async (deviceId: string | undefined) =>
  deviceId ? sha256Hex(`device:${deviceId}`) : null;

// --- Handlers --------------------------------------------------------------------------------------

export function registerPrivacyRoutes(app: OpenAPIHono<AppEnv>, deps: ApiDeps): void {
  const sql = deps.sql;
  const now = () => deps.now?.() ?? new Date();

  /** Parent → their households; child → their own household, only for their own id. */
  async function consentScope(actor: Actor, studentId: string): Promise<Scope> {
    const who = requireActor(actor, 'parent', 'child');
    if (who.kind === 'child') {
      if (who.childId !== studentId) throw new ApiError('NOT_FOUND', 'Student not found');
      return scoped(sql, [who.householdId]);
    }
    return scopeFor(sql, who);
  }

  async function studentOr404(scope: Scope, id: string) {
    const student = await repo.consentStudent(sql, scope, id);
    if (!student) throw new ApiError('NOT_FOUND', 'Student not found');
    return student;
  }

  async function consentPolicy(t: Date) {
    const versions = await policyVersions(sql, CONSENT_POLICY_TYPE);
    const current = currentPolicyVersion(versions, t);
    if (current === null) throw new ApiError('SERVICE_UNAVAILABLE', 'No privacy policy in force');
    return { current, minimum: minimumAcceptedVersion(versions, t) };
  }

  async function stateOf(scope: Scope, student: repo.ConsentStudentRow, type: ConsentType) {
    const t = now();
    const [record, policy] = await Promise.all([
      latestConsent(sql, scope, student.id, type),
      consentPolicy(t),
    ]);
    return toState(type, record, policy.minimum, student, t);
  }

  /** The household a parent's privacy requests apply to (404 without one). */
  async function parentHousehold(userId: string) {
    const [household] = await parentHouseholds(sql, userId);
    if (!household) throw new ApiError('NOT_FOUND', 'No household yet');
    return household;
  }

  // Policies ---------------------------------------------------------------------------------------

  app.openapi(policiesRoute, async (c) => {
    const locale: PolicyLocale = c.req.valid('query').locale ?? 'vi';
    const t = now();
    const rows = await repo.policiesForLocale(sql, locale);
    const policies: z.infer<typeof PoliciesResponseSchema>['policies'] = [];
    const minimumAcceptedVersions = {} as Record<PolicyType, number>;
    const versionsByType = {} as Record<PolicyType, PolicyVersionInfo[]>;
    for (const type of POLICY_TYPES) {
      const ofType = rows.filter((r) => r.type === type);
      const versions = ofType.map((r) => ({
        version: r.version,
        effectiveAt: new Date(r.effective_at),
        requiresReconsent: r.requires_reconsent,
      }));
      versionsByType[type] = versions;
      minimumAcceptedVersions[type] = minimumAcceptedVersion(versions, t);
      const current = currentPolicyVersion(versions, t);
      const row = ofType.find((r) => r.version === current);
      if (!row) throw new ApiError('SERVICE_UNAVAILABLE', `No ${type} in force for ${locale}`);
      policies.push({
        type,
        version: row.version,
        locale: row.locale,
        title: row.title,
        effectiveAt: iso(row.effective_at)!,
        requiresReconsent: row.requires_reconsent,
        contentMd: row.content_md,
      });
    }
    const actor = c.get('actor');
    let acceptances: z.infer<typeof PoliciesResponseSchema>['acceptances'] = null;
    let needsAcceptance: boolean | null = null;
    if (actor.kind === 'parent') {
      const accepted = await repo.acceptancesOf(sql, actor.userId);
      acceptances = accepted.map((a) => ({
        type: a.policy_type,
        version: a.policy_version,
        locale: a.locale,
        acceptedAt: iso(a.accepted_at)!,
      }));
      needsAcceptance = POLICY_TYPES.some((type) =>
        needsPolicyAcceptance(
          accepted.filter((a) => a.policy_type === type).map((a) => a.policy_version),
          versionsByType[type],
          t,
        ),
      );
    }
    return c.json({ locale, policies, minimumAcceptedVersions, acceptances, needsAcceptance }, 200);
  });

  app.openapi(acceptRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const input = c.req.valid('json');
    const t = now();
    const deviceIdHash = await hashDevice(input.deviceId);
    for (const item of input.policies) {
      const current = currentPolicyVersion(await policyVersions(sql, item.type), t);
      if (item.version !== current) {
        throw new ApiError('CONFLICT', `${item.type} version ${item.version} is not current`, {
          type: item.type,
          currentVersion: current,
        });
      }
    }
    await sql.begin(async (tx) => {
      for (const item of input.policies) {
        await repo.insertAcceptance(tx, {
          userId: actor.userId,
          type: item.type,
          version: item.version,
          locale: input.locale ?? 'vi',
          deviceIdHash,
          requestId: c.get('requestId'),
        });
      }
    });
    const accepted = await repo.acceptancesOf(sql, actor.userId);
    return c.json(
      {
        acceptances: accepted.map((a) => ({
          type: a.policy_type,
          version: a.policy_version,
          locale: a.locale,
          acceptedAt: iso(a.accepted_at)!,
        })),
      },
      200,
    );
  });

  // Consents ---------------------------------------------------------------------------------------

  app.openapi(consentsRoute, async (c) => {
    const { id } = c.req.valid('param');
    const scope = await consentScope(c.get('actor'), id);
    const student = await studentOr404(scope, id);
    const t = now();
    const [history, policy] = await Promise.all([consentHistory(sql, scope, id), consentPolicy(t)]);
    const consents = CONSENT_TYPES.map((type) => {
      const ofType = history.filter((r) => r.consent_type === type);
      const latest = ofType.find((r) => r.status === 'GRANTED') ?? ofType[0] ?? null;
      return toState(type, latest, policy.minimum, student, t);
    });
    return c.json(
      {
        studentId: id,
        policy: {
          type: 'PRIVACY_POLICY' as const,
          currentVersion: policy.current,
          minimumAcceptedVersion: policy.minimum,
        },
        consents,
        history: history.map(toRecord),
      },
      200,
    );
  });

  app.openapi(grantRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const { id, type } = c.req.valid('param');
    const input = c.req.valid('json');
    const scope = await scopeFor(sql, actor);
    const student = await studentOr404(scope, id);
    const t = now();
    const policy = await consentPolicy(t);
    if (input.policyVersion !== policy.current) {
      throw new ApiError('CONFLICT', 'The privacy policy changed; show the current version', {
        currentVersion: policy.current,
      });
    }
    const deviceIdHash = await hashDevice(input.deviceId);
    await sql.begin(async (tx) => {
      await repo.lockConsent(tx, id, type);
      const active = await latestConsent(tx, scope, id, type, true);
      const plan = planGrant(active ? toRecordState(active) : null, input.policyVersion);
      if (plan.action === 'noop') return;
      if (plan.action === 'supersede' && active) {
        await repo.endConsent(tx, scope, active.id, 'SUPERSEDED', {
          type: 'parent',
          id: actor.userId,
        });
      }
      const assent = childAssentRequired(type, student.birth_year, t, student.timezone);
      const recordId = await repo.insertConsent(tx, {
        householdId: student.household_id,
        studentId: id,
        type,
        policyVersion: input.policyVersion,
        grantedBy: actor.userId,
        childAssentRequired: assent,
        deviceIdHash,
        requestId: c.get('requestId'),
      });
      await writeEvent(tx, {
        type: 'consent.granted',
        householdId: student.household_id,
        aggregateType: 'consent_record',
        aggregateId: recordId,
        payload: {
          studentId: id,
          consentType: type,
          policyVersion: input.policyVersion,
          childAssentRequired: assent,
        },
        idempotencyKey: recordId,
      });
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: actor.userId,
        action: 'consent.granted',
        targetType: 'student',
        targetId: id,
        householdId: student.household_id,
        requestId: c.get('requestId'),
        details: {
          consentType: type,
          policyVersion: input.policyVersion,
          recordId,
          superseded: plan.action === 'supersede' ? active?.id : undefined,
        },
      });
    });
    return c.json(await stateOf(scope, student, type), 200);
  });

  app.openapi(revokeRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const { id, type } = c.req.valid('param');
    const scope = await scopeFor(sql, actor);
    const student = await studentOr404(scope, id);
    await sql.begin(async (tx) => {
      await repo.lockConsent(tx, id, type);
      const active = await latestConsent(tx, scope, id, type, true);
      if (!active || active.status !== 'GRANTED') return;
      await repo.endConsent(tx, scope, active.id, 'REVOKED', { type: 'parent', id: actor.userId });
      const revokedSessions = revocationEndsSessions(type)
        ? await revokeSessions(tx, scope, id)
        : 0;
      await writeEvent(tx, {
        type: 'consent.revoked',
        householdId: student.household_id,
        aggregateType: 'consent_record',
        aggregateId: active.id,
        payload: { studentId: id, consentType: type, cancelScopes: [...revocationScope(type)] },
        idempotencyKey: active.id,
      });
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: actor.userId,
        action: 'consent.revoked',
        targetType: 'student',
        targetId: id,
        householdId: student.household_id,
        requestId: c.get('requestId'),
        details: { consentType: type, recordId: active.id, revokedSessions },
      });
    });
    return c.json(await stateOf(scope, student, type), 200);
  });

  app.openapi(assentRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'child');
    const { id, type } = c.req.valid('param');
    const { decision } = c.req.valid('json');
    const scope = await consentScope(actor, id);
    const student = await studentOr404(scope, id);
    await sql.begin(async (tx) => {
      await repo.lockConsent(tx, id, type);
      const active = await latestConsent(tx, scope, id, type, true);
      if (!active || !canRecordAssent(toRecordState(active))) {
        throw new ApiError('CONFLICT', 'No pending request for your agreement');
      }
      await repo.recordAssent(tx, scope, active.id, decision);
      await writeEvent(tx, {
        type: 'consent.child_assent_recorded',
        householdId: student.household_id,
        aggregateType: 'consent_record',
        aggregateId: active.id,
        payload: { studentId: id, consentType: type, decision },
        idempotencyKey: active.id,
      });
      await writeAudit(tx, {
        actorType: 'child',
        actorId: id,
        action: 'consent.child_assent',
        targetType: 'student',
        targetId: id,
        householdId: student.household_id,
        requestId: c.get('requestId'),
        details: { consentType: type, recordId: active.id, decision },
      });
    });
    return c.json(await stateOf(scope, student, type), 200);
  });

  app.openapi(childCheckRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'child');
    const { type } = c.req.valid('param');
    await requireConsent(sql, scoped(sql, [actor.householdId]), actor.childId, type, now());
    return c.json({ type, effective: true as const }, 200);
  });

  // Export -----------------------------------------------------------------------------------------

  app.openapi(exportRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const household = await parentHousehold(actor.userId);
    const scope = scoped(sql, [household.householdId]);
    const t = now();
    const job = (await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`export:${household.householdId}`}))`;
      const running = await repo.activeExport(tx, scope);
      if (running) return running;
      const hits = await rateLimitHit(
        tx,
        exportRateLimitBucket(household.householdId),
        EXPORT_RATE_LIMIT.windowSeconds,
      );
      if (isOverLimit(hits, EXPORT_RATE_LIMIT)) {
        const retryAfter = retryAfterSeconds(t, EXPORT_RATE_LIMIT);
        throw new ApiError(
          'RATE_LIMITED',
          'Too many export requests today',
          { retryAfter },
          { 'retry-after': String(retryAfter) },
        );
      }
      const privacyRequestId = await repo.insertPrivacyRequest(tx, {
        householdId: household.householdId,
        studentId: null,
        type: 'EXPORT',
        requestedBy: actor.userId,
        source: 'app',
        requestId: c.get('requestId'),
      });
      const created = await repo.insertExportJob(tx, {
        householdId: household.householdId,
        privacyRequestId,
        requestedBy: actor.userId,
      });
      await writeEvent(tx, {
        type: 'privacy.export_requested',
        householdId: household.householdId,
        aggregateType: 'data_export_job',
        aggregateId: created.id,
        payload: { jobId: created.id, requestedBy: actor.userId },
        idempotencyKey: created.id,
      });
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: actor.userId,
        action: 'privacy.export_requested',
        targetType: 'household',
        targetId: household.householdId,
        householdId: household.householdId,
        requestId: c.get('requestId'),
        details: { jobId: created.id },
      });
      return created;
    })) as repo.ExportJobRow;
    return c.json({ job: toExportJob(job, null, t) }, 202);
  });

  app.openapi(exportJobRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const scope = await scopeFor(sql, actor);
    const { jobId } = c.req.valid('param');
    const job = await repo.exportJob(sql, scope, jobId);
    if (!job) throw new ApiError('NOT_FOUND', 'Export not found');
    const t = now();
    let downloadUrl: string | null = null;
    const ttl = job.expires_at ? remainingLinkSeconds(new Date(job.expires_at), t) : null;
    if (job.status === 'READY' && job.object_path && ttl !== null) {
      if (!deps.storage) throw new ApiError('SERVICE_UNAVAILABLE', 'Storage is not configured');
      downloadUrl = await deps.storage.createSignedUrl(PRIVACY_EXPORT_BUCKET, job.object_path, ttl);
      await writeAudit(sql, {
        actorType: 'parent',
        actorId: actor.userId,
        action: 'privacy.export_link_issued',
        targetType: 'data_export_job',
        targetId: job.id,
        householdId: job.household_id,
        requestId: c.get('requestId'),
        details: { expiresInSeconds: ttl },
      });
    }
    return c.json({ job: toExportJob(job, downloadUrl, t) }, 200);
  });

  app.openapi(overviewRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const scope = await scopeFor(sql, actor);
    const t = now();
    const [acceptances, exports, deletions, requests] = await Promise.all([
      repo.acceptancesOf(sql, actor.userId),
      repo.recentExports(sql, scope),
      repo.deletionsFor(sql, scope, actor.userId),
      repo.requestsFor(sql, scope, actor.userId),
    ]);
    return c.json(
      {
        acceptances: acceptances.map((a) => ({
          type: a.policy_type,
          version: a.policy_version,
          locale: a.locale,
          acceptedAt: iso(a.accepted_at)!,
        })),
        exports: exports.map((j) => toExportJob(j, null, t)),
        deletions: deletions.map(toDeletion),
        requests: requests.map((r) => ({
          id: r.id,
          type: r.type,
          status: r.status,
          studentId: r.student_id,
          source: r.source,
          createdAt: iso(r.created_at)!,
          completedAt: iso(r.completed_at),
        })),
      },
      200,
    );
  });

  // Deletion ---------------------------------------------------------------------------------------

  app.openapi(deleteChildRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const { id } = c.req.valid('param');
    const { source } = c.req.valid('json');
    const scope = await scopeFor(sql, actor);
    const student = await studentOr404(scope, id);
    const t = now();
    const job = (await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`delete-child:${id}`}))`;
      const existing = await repo.scheduledChildDeletion(tx, scope, id);
      if (existing) return existing;
      const studentWasDisabled = await repo.studentDisabled(tx, scope, id);
      const privacyRequestId = await repo.insertPrivacyRequest(tx, {
        householdId: student.household_id,
        studentId: id,
        type: 'DELETE_CHILD',
        requestedBy: actor.userId,
        source: source ?? 'app',
        requestId: c.get('requestId'),
      });
      const created = await repo.insertDeletionJob(tx, {
        scope: 'CHILD',
        householdId: student.household_id,
        studentId: id,
        userId: actor.userId,
        privacyRequestId,
        requestedAt: t,
        purgeAfter: purgeAfter(t),
        restoreState: { studentWasDisabled },
      });
      await setDisabled(tx, scope, id, true);
      const revokedSessions = await revokeSessions(tx, scope, id);
      await writeEvent(tx, {
        type: 'privacy.deletion_requested',
        householdId: student.household_id,
        aggregateType: 'data_deletion_job',
        aggregateId: created.id,
        payload: { scope: 'CHILD', studentId: id, purgeAfter: iso(created.purge_after) },
        idempotencyKey: created.id,
      });
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: actor.userId,
        action: 'privacy.child_deletion_requested',
        targetType: 'student',
        targetId: id,
        householdId: student.household_id,
        requestId: c.get('requestId'),
        details: { jobId: created.id, revokedSessions, source: source ?? 'app' },
      });
      return created;
    })) as repo.DeletionJobRow;
    return c.json({ deletion: toDeletion(job) }, 202);
  });

  app.openapi(deleteAccountRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const { source } = c.req.valid('json');
    const t = now();
    const households = await parentHouseholds(sql, actor.userId);
    // Only the owner deletes the household; a guardian deletes just their own account.
    const owned = households.find((h) => h.role === 'OWNER')?.householdId ?? null;
    const job = (await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`delete-account:${actor.userId}`}))`;
      const existing = await repo.scheduledAccountDeletion(tx, actor.userId);
      if (existing) return existing;
      const disabledStudentIds = owned ? await repo.disabledStudentsOf(tx, owned) : [];
      const privacyRequestId = await repo.insertPrivacyRequest(tx, {
        householdId: owned,
        studentId: null,
        type: 'DELETE_ACCOUNT',
        requestedBy: actor.userId,
        source: source ?? 'app',
        requestId: c.get('requestId'),
      });
      const created = await repo.insertDeletionJob(tx, {
        scope: 'ACCOUNT',
        householdId: owned,
        studentId: null,
        userId: actor.userId,
        privacyRequestId,
        requestedAt: t,
        purgeAfter: purgeAfter(t),
        restoreState: { disabledStudentIds },
      });
      const revokedSessions = owned ? await repo.disableHousehold(tx, owned) : 0;
      await repo.signOutParentEverywhere(tx, actor.userId);
      if (owned) {
        await writeEvent(tx, {
          type: 'privacy.deletion_requested',
          householdId: owned,
          aggregateType: 'data_deletion_job',
          aggregateId: created.id,
          payload: { scope: 'ACCOUNT', purgeAfter: iso(created.purge_after) },
          idempotencyKey: created.id,
        });
      }
      await tx`
        insert into ops.audit_logs (actor_type, actor_id, action, target_type, target_id, household_id, request_id, details)
        values ('parent', ${actor.userId}, 'privacy.account_deletion_requested', 'account', ${actor.userId},
                ${owned}, ${c.get('requestId')},
                ${tx.json({ jobId: created.id, revokedSessions, source: source ?? 'app' })})`;
      return created;
    })) as repo.DeletionJobRow;
    return c.json({ deletion: toDeletion(job) }, 202);
  });
  app.openapi(cancelChildDeletionRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const { id } = c.req.valid('param');
    const scope = await scopeFor(sql, actor);
    const student = await studentOr404(scope, id);
    const t = now();
    const job = (await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`delete-child:${id}`}))`;
      const pending = assertCancellable(await repo.scheduledChildDeletion(tx, scope, id, true), t);
      const cancelled = await repo.cancelDeletionJob(tx, pending, actor.userId, t);
      const reenabled = !pending.restore_state.studentWasDisabled;
      if (reenabled) await setDisabled(tx, scope, id, false);
      await writeEvent(tx, {
        type: 'privacy.deletion_cancelled',
        householdId: student.household_id,
        aggregateType: 'data_deletion_job',
        aggregateId: pending.id,
        payload: { scope: 'CHILD', studentId: id, jobId: pending.id },
        idempotencyKey: pending.id,
      });
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: actor.userId,
        action: 'privacy.child_deletion_cancelled',
        targetType: 'student',
        targetId: id,
        householdId: student.household_id,
        requestId: c.get('requestId'),
        details: { jobId: pending.id, loginRestored: reenabled },
      });
      return cancelled;
    })) as repo.DeletionJobRow;
    return c.json({ deletion: toDeletion(job) }, 200);
  });

  app.openapi(cancelAccountDeletionRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const t = now();
    const job = (await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`delete-account:${actor.userId}`}))`;
      const pending = assertCancellable(
        await repo.scheduledAccountDeletion(tx, actor.userId, true),
        t,
      );
      const cancelled = await repo.cancelDeletionJob(tx, pending, actor.userId, t);
      const householdId = pending.household_id;
      let reenabled: string[] = [];
      if (householdId) {
        reenabled = studentsToReenable(
          await repo.studentIdsOf(tx, householdId),
          pending.restore_state.disabledStudentIds ?? [],
          await repo.pendingChildDeletionsOf(tx, householdId),
        );
        await repo.restoreHousehold(tx, householdId, reenabled);
      }
      await writeEvent(tx, {
        type: 'privacy.deletion_cancelled',
        householdId,
        aggregateType: 'data_deletion_job',
        aggregateId: pending.id,
        payload: { scope: 'ACCOUNT', userId: actor.userId, jobId: pending.id },
        idempotencyKey: pending.id,
      });
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: actor.userId,
        action: 'privacy.account_deletion_cancelled',
        targetType: 'account',
        targetId: actor.userId,
        householdId,
        requestId: c.get('requestId'),
        details: { jobId: pending.id, reenabledStudents: reenabled.length },
      });
      return cancelled;
    })) as repo.DeletionJobRow;
    return c.json({ deletion: toDeletion(job) }, 200);
  });
}

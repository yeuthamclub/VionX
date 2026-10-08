import { createRoute, type OpenAPIHono, type z } from '@hono/zod-openapi';
import {
  afterFailedAttempt,
  attemptsRemaining,
  CHILD_LOGIN_RATE_LIMITS,
  clearedLock,
  DEFAULT_AVATAR,
  generateLoginId,
  generatePin,
  isLocked,
  isOverLimit,
  normalizeLoginId,
  rateLimitBucket,
  REQUIRED_FOR_CHILD_LOGIN,
  retryAfterSeconds,
  sessionExpiry,
  validateHousehold,
  validateStudentProfile,
  type RateLimitRule,
} from '@vionx/domain';
import { requireActor, type Actor } from '../../_shared/actor.ts';
import { consentRequired, evaluateStudentConsent } from '../../_shared/consent.ts';
import {
  hashPin,
  newChildToken,
  randomBytes,
  verifyAgainstDummy,
  verifyPin,
} from '../../_shared/crypto.ts';
import type { Sql } from '../../_shared/db.ts';
import { ApiError } from '../../_shared/errors.ts';
import { scoped, scopeFor, type Scope } from '../../_shared/scope.ts';
import type { AppEnv } from '../app.ts';
import { body, CHILD, errorResponses, iso, json, PARENT } from '../route-helpers.ts';
import type { ApiDeps } from '../deps.ts';
import { pendingAccountDeletion } from '../privacy/repo.ts';
import * as repo from './repo.ts';
import {
  ChildLoginRequestSchema,
  ChildLoginResponseSchema,
  ChildLogoutResponseSchema,
  ChildSessionResponseSchema,
  DisableRequestSchema,
  HouseholdCreateRequestSchema,
  HouseholdResponseSchema,
  MeResponseSchema,
  ResetPinRequestSchema,
  ResetPinResponseSchema,
  RevokeSessionsResponseSchema,
  StudentCreateRequestSchema,
  StudentCreateResponseSchema,
  StudentIdParamSchema,
  StudentPatchRequestSchema,
  StudentSchema,
  type Student,
} from './schemas.ts';

// --- Route definitions ----------------------------------------------------------------------------

const meRoute = createRoute({
  method: 'get',
  path: '/v1/me',
  tags: ['identity'],
  summary: 'Signed-in parent account',
  description: 'Profile, households and admin permissions of the Supabase Auth user.',
  security: PARENT,
  responses: { 200: json(MeResponseSchema, 'Account'), ...errorResponses('UNAUTHENTICATED') },
});

const createHouseholdRoute = createRoute({
  method: 'post',
  path: '/v1/household',
  tags: ['identity'],
  summary: 'Create the household',
  description:
    'Creates the parent’s household with the parent as OWNER. One household per parent in v1.',
  security: PARENT,
  request: body(HouseholdCreateRequestSchema),
  responses: {
    201: json(HouseholdResponseSchema, 'Created'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'CONFLICT'),
  },
});

const getHouseholdRoute = createRoute({
  method: 'get',
  path: '/v1/household',
  tags: ['identity'],
  summary: 'The parent’s household and children',
  security: PARENT,
  responses: {
    200: json(HouseholdResponseSchema, 'Household'),
    ...errorResponses('UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const createStudentRoute = createRoute({
  method: 'post',
  path: '/v1/students',
  tags: ['identity'],
  summary: 'Add a child',
  description:
    'Creates the child profile and login. The response carries the one-time credentials (login id + PIN); the PIN is never retrievable again.',
  security: PARENT,
  request: body(StudentCreateRequestSchema),
  responses: {
    201: json(StudentCreateResponseSchema, 'Created'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const getStudentRoute = createRoute({
  method: 'get',
  path: '/v1/students/{id}',
  tags: ['identity'],
  summary: 'A child in the parent’s household',
  security: PARENT,
  request: { params: StudentIdParamSchema },
  responses: {
    200: json(StudentSchema, 'Child'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const patchStudentRoute = createRoute({
  method: 'patch',
  path: '/v1/students/{id}',
  tags: ['identity'],
  summary: 'Edit a child profile',
  security: PARENT,
  request: { params: StudentIdParamSchema, ...body(StudentPatchRequestSchema) },
  responses: {
    200: json(StudentSchema, 'Updated'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const resetPinRoute = createRoute({
  method: 'post',
  path: '/v1/students/{id}/reset-pin',
  tags: ['identity'],
  summary: 'Reset a child’s PIN',
  description: 'Sets a new PIN (given or generated), clears the lock and failed attempts. Audited.',
  security: PARENT,
  request: { params: StudentIdParamSchema, ...body(ResetPinRequestSchema, false) },
  responses: {
    200: json(ResetPinResponseSchema, 'New credentials'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const revokeSessionsRoute = createRoute({
  method: 'post',
  path: '/v1/students/{id}/revoke-sessions',
  tags: ['identity'],
  summary: 'Sign a child out on every device',
  description: 'Revokes all active child sessions. Audited.',
  security: PARENT,
  request: { params: StudentIdParamSchema },
  responses: {
    200: json(RevokeSessionsResponseSchema, 'Revoked'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const disableRoute = createRoute({
  method: 'post',
  path: '/v1/students/{id}/disable',
  tags: ['identity'],
  summary: 'Disable (or re-enable) a child login',
  description:
    'Disabling also revokes every session. `{ "disabled": false }` re-enables (409 while a deletion is scheduled). Audited.',
  security: PARENT,
  request: { params: StudentIdParamSchema, ...body(DisableRequestSchema, false) },
  responses: {
    200: json(StudentSchema, 'Updated'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND', 'CONFLICT'),
  },
});

const childLoginRoute = createRoute({
  method: 'post',
  path: '/v1/auth/child/login',
  tags: ['identity'],
  summary: 'Child sign-in with login id + PIN',
  description:
    'Returns an opaque session token (30-day sliding expiry). 5 wrong PINs lock the login for 15 minutes; attempts are rate-limited per device and per login id. A correct PIN without CORE_SERVICE consent in force answers 403 CONSENT_REQUIRED.',
  request: body(ChildLoginRequestSchema),
  responses: {
    200: json(ChildLoginResponseSchema, 'Signed in'),
    ...errorResponses(
      'VALIDATION_FAILED',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'ACCOUNT_LOCKED',
      'RATE_LIMITED',
    ),
  },
});

const childSessionRoute = createRoute({
  method: 'get',
  path: '/v1/auth/child/session',
  tags: ['identity'],
  summary: 'Current child session',
  description:
    'Validates the stored token (app start) and returns the child profile. Extends the sliding expiry.',
  security: CHILD,
  responses: {
    200: json(ChildSessionResponseSchema, 'Active session'),
    ...errorResponses('UNAUTHENTICATED'),
  },
});

const childLogoutRoute = createRoute({
  method: 'post',
  path: '/v1/auth/child/logout',
  tags: ['identity'],
  summary: 'Child sign-out (revokes this session)',
  security: CHILD,
  responses: {
    200: json(ChildLogoutResponseSchema, 'Signed out'),
    ...errorResponses('UNAUTHENTICATED'),
  },
});

// --- Helpers ---------------------------------------------------------------------------------------

function toStudent(row: repo.StudentRow, now: Date): Student {
  const locked = row.locked_until !== null && new Date(row.locked_until) > now;
  return {
    id: row.id,
    displayName: row.display_name,
    birthYear: row.birth_year,
    grade: row.grade,
    avatar: row.avatar,
    childLoginId: row.child_login_id,
    status: row.disabled_at ? 'disabled' : locked ? 'locked' : 'active',
    lockedUntil: locked ? iso(row.locked_until) : null,
    failedAttempts: row.failed_attempts,
    activeSessions: row.active_sessions,
    coreServiceConsent: row.core_service_consent,
    deletionScheduledFor: iso(row.deletion_scheduled_for),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function validationError(error: string, message?: string): never {
  throw new ApiError('VALIDATION_FAILED', message ?? error, [{ code: error, message }]);
}

/** The parent's scope; a parent without a household gets 404 on household/child routes. */
async function parentScope(sql: Sql, actor: Actor): Promise<Scope> {
  return scopeFor(sql, requireActor(actor, 'parent'));
}

async function studentRowOr404(sql: Sql, scope: Scope, id: string): Promise<repo.StudentRow> {
  const row = await repo.getStudent(sql, scope, id);
  if (!row) throw new ApiError('NOT_FOUND', 'Student not found');
  return row;
}

async function studentOr404(sql: Sql, scope: Scope, id: string, now: Date): Promise<Student> {
  return toStudent(await studentRowOr404(sql, scope, id), now);
}

async function enforceRateLimit(sql: Sql, bucket: string, rule: RateLimitRule, now: Date) {
  const hits = await repo.rateLimitHit(sql, bucket, rule.windowSeconds);
  if (isOverLimit(hits, rule)) {
    const retryAfter = retryAfterSeconds(now, rule);
    throw new ApiError(
      'RATE_LIMITED',
      'Too many sign-in attempts. Try again later.',
      { retryAfter },
      {
        'retry-after': String(retryAfter),
      },
    );
  }
}

/** Inserts with a fresh login id, retrying on the (rare: 31^6 ids) unique collision. */
async function withUniqueLoginId(
  insert: (childLoginId: string) => Promise<string>,
): Promise<{ studentId: string; childLoginId: string }> {
  for (let attempt = 0; ; attempt++) {
    const childLoginId = generateLoginId(randomBytes);
    try {
      return { studentId: await insert(childLoginId), childLoginId };
    } catch (error) {
      const constraint = (error as { constraint_name?: string }).constraint_name;
      if (constraint !== 'child_credentials_child_login_id_key' || attempt >= 4) throw error;
    }
  }
}

// --- Handlers --------------------------------------------------------------------------------------

export function registerIdentityRoutes(app: OpenAPIHono<AppEnv>, deps: ApiDeps): void {
  const sql = deps.sql;
  const now = () => deps.now?.() ?? new Date();

  app.openapi(meRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const [profile, households, adminPermissions, pendingDeletion] = await Promise.all([
      repo.ensureProfile(sql, actor.userId),
      repo.householdsOf(sql, actor.userId),
      deps.admins.permissionsOf(actor.userId),
      pendingAccountDeletion(sql, actor.userId),
    ]);
    return c.json(
      {
        userId: actor.userId,
        phone: actor.phone,
        email: actor.email,
        displayName: profile.display_name,
        households: households.map((h) => ({
          id: h.id,
          name: h.name,
          role: h.role,
          timezone: h.timezone,
        })),
        adminPermissions: adminPermissions as z.infer<typeof MeResponseSchema>['adminPermissions'],
        pendingAccountDeletion: pendingDeletion
          ? { id: pendingDeletion.id, purgeAfter: iso(pendingDeletion.purgeAfter)! }
          : null,
      },
      200,
    );
  });

  app.openapi(createHouseholdRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const input = c.req.valid('json');
    const valid = validateHousehold({
      name: input.name,
      ...(input.timezone ? { timezone: input.timezone } : {}),
    });
    if (!valid.ok) validationError(valid.error, valid.message);
    if (await repo.accountDeletionPending(sql, actor.userId)) {
      throw new ApiError('FORBIDDEN', 'This account is scheduled for deletion');
    }
    const household = await repo.createHousehold(sql, actor.userId, valid.value);
    if (!household) throw new ApiError('CONFLICT', 'This account already has a household');
    return c.json(
      {
        household: {
          id: household.id,
          name: household.name,
          timezone: household.timezone,
          role: household.role,
          createdAt: iso(household.created_at)!,
        },
        students: [],
      },
      201,
    );
  });

  app.openapi(getHouseholdRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const [household] = await repo.householdsOf(sql, actor.userId);
    if (!household) throw new ApiError('NOT_FOUND', 'No household yet');
    const students = await repo.listStudents(sql, scoped(sql, [household.id]));
    const t = now();
    return c.json(
      {
        household: {
          id: household.id,
          name: household.name,
          timezone: household.timezone,
          role: household.role,
          createdAt: iso(household.created_at)!,
        },
        students: students.map((s) => toStudent(s, t)),
      },
      200,
    );
  });

  app.openapi(createStudentRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const input = c.req.valid('json');
    const t = now();
    const valid = validateStudentProfile(
      {
        displayName: input.displayName,
        grade: input.grade,
        birthYear: input.birthYear,
        avatar: input.avatar ?? DEFAULT_AVATAR,
      },
      t,
    );
    if (!valid.ok) validationError(valid.error, valid.message);
    const [household] = await repo.householdsOf(sql, actor.userId);
    if (!household) throw new ApiError('NOT_FOUND', 'Create a household first');
    const scope = scoped(sql, [household.id]);

    const pin = input.pin ?? generatePin(randomBytes);
    const pinHash = await hashPin(pin);
    const insertOnce = (childLoginId: string) =>
      sql.begin(async (tx) => {
        const id = await repo.insertStudent(tx, {
          householdId: household.id,
          displayName: valid.value.displayName!,
          birthYear: valid.value.birthYear!,
          grade: valid.value.grade!,
          avatar: valid.value.avatar!,
          childLoginId,
          pinHash,
        });
        await repo.writeEvent(tx, {
          type: 'identity.child_created',
          householdId: household.id,
          aggregateType: 'student',
          aggregateId: id,
          payload: { studentId: id, grade: valid.value.grade!, createdBy: actor.userId },
        });
        return id;
      }) as Promise<string>;
    const { studentId, childLoginId } = await withUniqueLoginId(insertOnce);
    const student = await studentOr404(sql, scope, studentId, t);
    return c.json({ student, credentials: { childLoginId, pin } }, 201);
  });

  app.openapi(getStudentRoute, async (c) => {
    const scope = await parentScope(sql, c.get('actor'));
    return c.json(await studentOr404(sql, scope, c.req.valid('param').id, now()), 200);
  });

  app.openapi(patchStudentRoute, async (c) => {
    const scope = await parentScope(sql, c.get('actor'));
    const { id } = c.req.valid('param');
    const valid = validateStudentProfile(c.req.valid('json'), now());
    if (!valid.ok) validationError(valid.error, valid.message);
    if (!(await repo.updateStudent(sql, scope, id, valid.value))) {
      throw new ApiError('NOT_FOUND', 'Student not found');
    }
    return c.json(await studentOr404(sql, scope, id, now()), 200);
  });

  app.openapi(resetPinRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const scope = await parentScope(sql, actor);
    const { id } = c.req.valid('param');
    const input = (c.req.valid('json') ?? {}) as z.infer<typeof ResetPinRequestSchema>;
    const student = await studentRowOr404(sql, scope, id);
    const wasLocked = toStudent(student, now()).status === 'locked';
    const pin = input.pin ?? generatePin(randomBytes);
    const pinHash = await hashPin(pin);
    const result = (await sql.begin(async (tx) => {
      const childLoginId = await repo.setPin(tx, scope, id, pinHash);
      if (!childLoginId) throw new ApiError('NOT_FOUND', 'Student not found');
      const revoked = input.revokeSessions ? await repo.revokeSessions(tx, scope, id) : 0;
      await repo.writeAudit(tx, {
        actorType: 'parent',
        actorId: actor.userId,
        action: 'student.pin_reset',
        targetType: 'student',
        targetId: id,
        householdId: student.household_id,
        requestId: c.get('requestId'),
        details: { generated: input.pin === undefined, revokedSessions: revoked, wasLocked },
      });
      return { childLoginId, revoked };
    })) as { childLoginId: string; revoked: number };
    return c.json(
      { credentials: { childLoginId: result.childLoginId, pin }, revokedSessions: result.revoked },
      200,
    );
  });

  app.openapi(revokeSessionsRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const scope = await parentScope(sql, actor);
    const { id } = c.req.valid('param');
    const student = await studentRowOr404(sql, scope, id);
    const revoked = (await sql.begin(async (tx) => {
      const n = await repo.revokeSessions(tx, scope, id);
      await repo.writeAudit(tx, {
        actorType: 'parent',
        actorId: actor.userId,
        action: 'student.sessions_revoked',
        targetType: 'student',
        targetId: id,
        householdId: student.household_id,
        requestId: c.get('requestId'),
        details: { revokedSessions: n },
      });
      return n;
    })) as number;
    return c.json({ revokedSessions: revoked }, 200);
  });

  app.openapi(disableRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent');
    const scope = await parentScope(sql, actor);
    const { id } = c.req.valid('param');
    const disabled = (c.req.valid('json') as { disabled?: boolean } | undefined)?.disabled ?? true;
    const student = await studentRowOr404(sql, scope, id);
    if (!disabled && student.deletion_scheduled_for) {
      throw new ApiError(
        'CONFLICT',
        'This child is scheduled for deletion and cannot be re-enabled',
      );
    }
    await sql.begin(async (tx) => {
      await repo.setDisabled(tx, scope, id, disabled);
      const revoked = disabled ? await repo.revokeSessions(tx, scope, id) : 0;
      await repo.writeAudit(tx, {
        actorType: 'parent',
        actorId: actor.userId,
        action: disabled ? 'student.disabled' : 'student.enabled',
        targetType: 'student',
        targetId: id,
        householdId: student.household_id,
        requestId: c.get('requestId'),
        details: { revokedSessions: revoked },
      });
    });
    return c.json(await studentOr404(sql, scope, id, now()), 200);
  });

  app.openapi(childLoginRoute, async (c) => {
    const input = c.req.valid('json');
    const t = now();
    const loginId = normalizeLoginId(input.childLoginId);
    await enforceRateLimit(
      sql,
      rateLimitBucket('device', input.deviceId),
      CHILD_LOGIN_RATE_LIMITS.perDevice,
      t,
    );
    await enforceRateLimit(
      sql,
      rateLimitBucket('login', loginId ?? input.childLoginId.trim().toLowerCase().slice(0, 32)),
      CHILD_LOGIN_RATE_LIMITS.perLoginId,
      t,
    );
    const invalid = () => new ApiError('INVALID_CREDENTIALS', 'Login ID or PIN is incorrect');

    const credential = loginId ? await repo.findCredentialByLoginId(sql, loginId) : null;
    if (!credential) {
      await verifyAgainstDummy(input.pin);
      throw invalid();
    }
    const lockState = () => ({
      failedAttempts: credential.failed_attempts,
      lockedUntil: credential.locked_until ? new Date(credential.locked_until) : null,
    });
    if (isLocked(lockState(), t)) {
      throw new ApiError(
        'ACCOUNT_LOCKED',
        'Too many wrong PINs. Try again later or ask a parent.',
        {
          lockedUntil: iso(credential.locked_until),
        },
      );
    }

    const pinOk = await verifyPin(input.pin, credential.pin_hash);
    const result = (await sql.begin(async (tx) => {
      // Re-read under a row lock: concurrent attempts must not lose failure counts.
      const current = await repo.findCredentialByLoginId(tx, loginId!, true);
      if (!current) return { kind: 'invalid' as const };
      const state = {
        failedAttempts: current.failed_attempts,
        lockedUntil: current.locked_until ? new Date(current.locked_until) : null,
      };
      if (isLocked(state, t)) return { kind: 'locked' as const, until: state.lockedUntil! };
      if (!pinOk) {
        const next = afterFailedAttempt(state, t);
        await tx`
          update app.child_credentials
          set failed_attempts = ${next.failedAttempts}, locked_until = ${next.lockedUntil}
          where student_id = ${current.student_id}`;
        return isLocked(next, t)
          ? { kind: 'locked' as const, until: next.lockedUntil! }
          : { kind: 'wrong' as const, remaining: attemptsRemaining(next) };
      }
      if (current.disabled_at) return { kind: 'disabled' as const };
      // CORE_SERVICE must be in force before any child can sign in (TASK_PACKS/M02).
      const consent = await evaluateStudentConsent(
        tx,
        scoped(sql, [current.household_id]),
        current.student_id,
        REQUIRED_FOR_CHILD_LOGIN,
        t,
      );
      if (!consent.evaluation.effective) {
        return { kind: 'consent' as const, reason: consent.evaluation.reason };
      }
      const cleared = clearedLock();
      if (state.failedAttempts !== 0 || state.lockedUntil !== null) {
        await tx`
          update app.child_credentials
          set failed_attempts = ${cleared.failedAttempts}, locked_until = ${cleared.lockedUntil}
          where student_id = ${current.student_id}`;
      }
      const { token, tokenHash } = await newChildToken();
      const expiresAt = sessionExpiry(t);
      await tx`
        insert into app.child_sessions (student_id, household_id, token_hash, device_id, last_seen_at, expires_at)
        values (${current.student_id}, ${current.household_id}, ${tokenHash}, ${input.deviceId}, ${t}, ${expiresAt})`;
      return { kind: 'ok' as const, token, expiresAt, current };
    })) as
      | { kind: 'invalid' }
      | { kind: 'disabled' }
      | { kind: 'consent'; reason: string }
      | { kind: 'locked'; until: Date }
      | { kind: 'wrong'; remaining: number }
      | { kind: 'ok'; token: string; expiresAt: Date; current: repo.CredentialRow };

    switch (result.kind) {
      case 'invalid':
        throw invalid();
      case 'wrong':
        throw new ApiError('INVALID_CREDENTIALS', 'Login ID or PIN is incorrect', {
          attemptsRemaining: result.remaining,
        });
      case 'locked':
        throw new ApiError(
          'ACCOUNT_LOCKED',
          'Too many wrong PINs. Try again later or ask a parent.',
          {
            lockedUntil: result.until.toISOString(),
          },
        );
      case 'disabled':
        throw new ApiError('ACCOUNT_DISABLED', 'This login is turned off. Ask a parent.');
      case 'consent':
        throw consentRequired(REQUIRED_FOR_CHILD_LOGIN, result.reason);
      case 'ok':
        return c.json(
          {
            token: result.token,
            expiresAt: result.expiresAt.toISOString(),
            student: {
              id: result.current.student_id,
              displayName: result.current.display_name,
              grade: result.current.grade,
              avatar: result.current.avatar,
            },
          },
          200,
        );
    }
  });

  app.openapi(childSessionRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'child');
    const scope = scoped(sql, [actor.householdId]);
    const rows = await sql<
      {
        expires_at: Date;
        id: string;
        display_name: string;
        grade: number;
        avatar: Student['avatar'];
      }[]
    >`
      select cs.expires_at, s.id, s.display_name, s.grade, s.avatar
      from app.child_sessions cs
      join app.students s on s.id = cs.student_id
      where cs.id = ${actor.sessionId} and ${scope.where('cs.household_id')}`;
    const row = rows[0];
    if (!row) throw new ApiError('UNAUTHENTICATED', 'Session ended');
    return c.json(
      {
        expiresAt: iso(row.expires_at)!,
        student: {
          id: row.id,
          displayName: row.display_name,
          grade: row.grade,
          avatar: row.avatar,
        },
      },
      200,
    );
  });

  app.openapi(childLogoutRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'child');
    const rows = await sql`
      update app.child_sessions set revoked_at = now()
      where id = ${actor.sessionId} and household_id = ${actor.householdId} and revoked_at is null
      returning id`;
    return c.json({ revoked: rows.length > 0 }, 200);
  });
}

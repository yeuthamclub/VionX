import { hasPermission, shouldTouchSession, type AdminPermission } from '@vionx/domain';
import { sha256Hex } from './crypto.ts';
import type { Sql } from './db.ts';
import { ApiError } from './errors.ts';
import type { ParentTokenVerifier } from './jwt.ts';
import { hasServiceSecret } from './secrets.ts';

/** Actors (CONTRACT §4). */
export type Actor =
  | { kind: 'anonymous' }
  | { kind: 'system' }
  | { kind: 'parent'; userId: string; phone: string | null; email: string | null }
  | { kind: 'child'; childId: string; householdId: string; sessionId: string }
  | { kind: 'admin'; userId: string; permissions: string[] };

export type ActorKind = Actor['kind'];

export interface ActorResolver {
  resolve(request: Request): Promise<Actor>;
}

export const CHILD_SESSION_HEADER = 'x-vionx-child-session';

/** Looks up an active child session by token hash (and extends its sliding expiry). */
export interface ChildSessionStore {
  findActive(
    tokenHash: string,
    now: Date,
  ): Promise<{ sessionId: string; childId: string; householdId: string } | null>;
}

/** Admin permission rows for a parent account (ops.admin_permissions). */
export interface AdminPermissionStore {
  permissionsOf(userId: string): Promise<string[]>;
}

/**
 * Resolution order: service secret → system; `x-vionx-child-session` → child; `Authorization:
 * Bearer <Supabase JWT>` → parent. Anything unverifiable is anonymous (routes then answer 401).
 * Admin is a parent account plus permission rows, upgraded per route by `requirePermission`.
 */
export class LiveActorResolver implements ActorResolver {
  constructor(
    private readonly deps: {
      serviceSecret: string;
      parentTokens: ParentTokenVerifier;
      childSessions: ChildSessionStore;
      now?: () => Date;
    },
  ) {}

  async resolve(request: Request): Promise<Actor> {
    const headers = request.headers;
    if (hasServiceSecret(headers, this.deps.serviceSecret)) return { kind: 'system' };

    const childToken = headers.get(CHILD_SESSION_HEADER)?.trim();
    if (childToken) {
      if (childToken.length > 128) return { kind: 'anonymous' };
      const now = this.deps.now?.() ?? new Date();
      const session = await this.deps.childSessions.findActive(await sha256Hex(childToken), now);
      return session ? { kind: 'child', ...session } : { kind: 'anonymous' };
    }

    const auth = headers.get('authorization');
    const match = auth?.match(/^Bearer\s+(\S+)$/i);
    if (match?.[1]) {
      const claims = await this.deps.parentTokens.verify(match[1]);
      if (claims) return { kind: 'parent', ...claims };
    }
    return { kind: 'anonymous' };
  }
}

/** Child sessions in app.child_sessions; disabled children and expired/revoked tokens fail. */
export class PgChildSessionStore implements ChildSessionStore {
  constructor(private readonly sql: Sql) {}

  async findActive(tokenHash: string, now: Date) {
    const rows = await this.sql<
      {
        id: string;
        student_id: string;
        household_id: string;
        last_seen_at: Date;
        expires_at: Date;
      }[]
    >`
      select s.id, s.student_id, s.household_id, s.last_seen_at, s.expires_at
      from app.child_sessions s
      join app.students st on st.id = s.student_id and st.household_id = s.household_id
      where s.token_hash = ${tokenHash}
        and s.revoked_at is null
        and s.expires_at > ${now}
        and st.disabled_at is null`;
    const row = rows[0];
    if (!row) return null;
    const state = { expiresAt: row.expires_at, revokedAt: null, lastSeenAt: row.last_seen_at };
    if (shouldTouchSession(state, now)) {
      // 30-day sliding expiry, written at most hourly.
      await this.sql`
        update app.child_sessions
        set last_seen_at = ${now}, expires_at = ${now}::timestamptz + interval '30 days'
        where id = ${row.id} and revoked_at is null`;
    }
    return { sessionId: row.id, childId: row.student_id, householdId: row.household_id };
  }
}

export class PgAdminPermissionStore implements AdminPermissionStore {
  constructor(private readonly sql: Sql) {}

  async permissionsOf(userId: string): Promise<string[]> {
    const rows = await this.sql<{ permission: string }[]>`
      select permission from ops.admin_permissions where user_id = ${userId} order by permission`;
    return rows.map((r) => r.permission);
  }
}

/**
 * M00 resolver kept for tooling (OpenAPI generation, unit tests): recognises only the system
 * actor via the service secret.
 */
export class SkeletonActorResolver implements ActorResolver {
  constructor(private readonly serviceSecret: string) {}

  async resolve(request: Request): Promise<Actor> {
    if (hasServiceSecret(request.headers, this.serviceSecret)) return { kind: 'system' };
    return { kind: 'anonymous' };
  }
}

/** Route guard: throws UNAUTHENTICATED / FORBIDDEN unless the actor kind is allowed. */
export function requireActor<K extends ActorKind>(
  actor: Actor,
  ...kinds: K[]
): Extract<Actor, { kind: K }> {
  if ((kinds as ActorKind[]).includes(actor.kind)) return actor as Extract<Actor, { kind: K }>;
  if (actor.kind === 'anonymous') throw new ApiError('UNAUTHENTICATED', 'Authentication required');
  throw new ApiError('FORBIDDEN', `Actor ${actor.kind} may not call this route`);
}

/** Admin guard (CONTRACT D11): a signed-in parent account holding `permission` (or SUPER_ADMIN). */
export async function requirePermission(
  actor: Actor,
  store: AdminPermissionStore,
  permission: AdminPermission,
): Promise<Extract<Actor, { kind: 'admin' }>> {
  const parent = requireActor(actor, 'parent');
  const permissions = await store.permissionsOf(parent.userId);
  if (!hasPermission(permissions, permission)) {
    throw new ApiError('FORBIDDEN', `Permission ${permission} required`);
  }
  return { kind: 'admin', userId: parent.userId, permissions };
}

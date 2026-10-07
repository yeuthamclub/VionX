import { ApiError } from './errors.ts';
import { hasServiceSecret } from './secrets.ts';

/** Actors (CONTRACT §4). Parent/child/admin resolution is implemented in M01. */
export type Actor =
  | { kind: 'anonymous' }
  | { kind: 'system' }
  | { kind: 'parent'; userId: string }
  | { kind: 'child'; childId: string; householdId: string }
  | { kind: 'admin'; userId: string; permissions: string[] };

export type ActorKind = Actor['kind'];

export interface ActorResolver {
  resolve(request: Request): Promise<Actor>;
}

/**
 * M00 skeleton: recognises the system actor (service secret). Parent JWTs
 * (`Authorization: Bearer`), child session tokens (`x-vionx-child-session`) and admin
 * permissions are resolved from M01; until then such requests are anonymous.
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

// Household scoping (CONTRACT §3): every child-data query takes a Scope and filters with
// `scope.where()`. A row outside the actor's households is indistinguishable from a missing row,
// so cross-household access returns 404.
import type { HouseholdRole } from '@vionx/domain';
import type { Actor } from './actor.ts';
import type { Sql } from './db.ts';
import { ApiError } from './errors.ts';

export interface Scope {
  readonly householdIds: readonly string[];
  /** SQL fragment `<column> = any(<household ids>)`; column defaults to `household_id`. */
  where(column?: string): ReturnType<Sql>;
}

export interface ParentHousehold {
  householdId: string;
  role: HouseholdRole;
}

export function scoped(sql: Sql, householdIds: readonly string[]): Scope {
  const ids = [...householdIds];
  return {
    householdIds: ids,
    where: (column = 'household_id') => sql`${sql(column)} = any(${ids}::uuid[])`,
  };
}

/** Households a parent belongs to, OWNER first, then oldest membership. */
export async function parentHouseholds(sql: Sql, userId: string): Promise<ParentHousehold[]> {
  const rows = await sql<{ household_id: string; role: HouseholdRole }[]>`
    select household_id, role from app.household_memberships
    where user_id = ${userId}
    order by (role = 'OWNER') desc, created_at`;
  return rows.map((r) => ({ householdId: r.household_id, role: r.role }));
}

/** Scope for the current actor: a parent's households, or the child's own household. */
export async function scopeFor(sql: Sql, actor: Actor): Promise<Scope> {
  if (actor.kind === 'parent') {
    const households = await parentHouseholds(sql, actor.userId);
    return scoped(
      sql,
      households.map((h) => h.householdId),
    );
  }
  if (actor.kind === 'child') return scoped(sql, [actor.householdId]);
  throw new ApiError('FORBIDDEN', `Actor ${actor.kind} has no household scope`);
}

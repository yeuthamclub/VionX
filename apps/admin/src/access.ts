import type { MeResponse } from '@vionx/contracts/client';

/** Admin = a parent account holding at least one D11 permission (checked again by the api). */
export type AdminAccess =
  | { kind: 'signed-out' }
  | { kind: 'denied'; userLabel: string }
  | { kind: 'granted'; userLabel: string; permissions: string[] };

export function adminAccess(me: MeResponse | null): AdminAccess {
  if (!me) return { kind: 'signed-out' };
  const userLabel = me.email ?? (me.phone ? `+${me.phone}` : me.userId);
  if (me.adminPermissions.length === 0) return { kind: 'denied', userLabel };
  return { kind: 'granted', userLabel, permissions: [...me.adminPermissions] };
}

export function hasAdminPermission(access: AdminAccess, permission: string): boolean {
  return (
    access.kind === 'granted' &&
    (access.permissions.includes('SUPER_ADMIN') || access.permissions.includes(permission))
  );
}

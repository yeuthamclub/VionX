/** Admin permissions (CONTRACT D11), checked by name. SUPER_ADMIN implies every permission. */
export const ADMIN_PERMISSIONS = [
  'SUPER_ADMIN',
  'CONTENT_ADMIN',
  'CURRICULUM_EDITOR',
  'CONTENT_REVIEWER',
  'LIBRARIAN',
  'SUPPORT',
  'ANALYST',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export function isAdminPermission(value: string): value is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

export function hasPermission(granted: readonly string[], required: AdminPermission): boolean {
  return granted.includes('SUPER_ADMIN') || granted.includes(required);
}

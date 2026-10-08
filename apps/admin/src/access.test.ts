import { describe, expect, it } from 'vitest';
import { adminAccess, hasAdminPermission } from './access.ts';

const me = (adminPermissions: string[], email: string | null = 'a@vionx.local') => ({
  userId: 'u1',
  phone: '84900000001',
  email,
  displayName: null,
  households: [],
  adminPermissions: adminPermissions as never,
  pendingAccountDeletion: null,
});

describe('adminAccess', () => {
  it('is signed-out without an account', () => {
    expect(adminAccess(null)).toEqual({ kind: 'signed-out' });
  });

  it('denies parent accounts without admin permissions', () => {
    expect(adminAccess(me([], null))).toEqual({ kind: 'denied', userLabel: '+84900000001' });
  });

  it('grants with permissions; SUPER_ADMIN implies all', () => {
    const access = adminAccess(me(['SUPER_ADMIN']));
    expect(access).toMatchObject({ kind: 'granted', userLabel: 'a@vionx.local' });
    expect(hasAdminPermission(access, 'LIBRARIAN')).toBe(true);
    const reviewer = adminAccess(me(['CONTENT_REVIEWER']));
    expect(hasAdminPermission(reviewer, 'CONTENT_REVIEWER')).toBe(true);
    expect(hasAdminPermission(reviewer, 'LIBRARIAN')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { accountLabel, formatPurgeDate, toE164Vn } from './delete-account.ts';

describe('account deletion page helpers', () => {
  it('normalises Vietnamese mobile numbers', () => {
    expect(toE164Vn('0900 000 001')).toBe('+84900000001');
    expect(toE164Vn('+84 900-000-001')).toBe('+84900000001');
    expect(toE164Vn('12345')).toBeNull();
  });

  it('formats the purge date in Vietnam time', () => {
    expect(formatPurgeDate('2026-11-06T18:30:00Z')).toBe('07/11/2026');
  });

  it('labels the account by phone, else email', () => {
    expect(accountLabel({ phone: '84900000001', email: null })).toBe('+84900000001');
    expect(accountLabel({ phone: '', email: 'a@b.vn' })).toBe('a@b.vn');
  });
});

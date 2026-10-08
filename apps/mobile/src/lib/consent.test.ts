import type { ConsentState } from '@vionx/contracts/client';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en.ts';
import { vi } from '../i18n/vi.ts';
import { CONSENT_TYPES } from '@vionx/domain';
import { AppError, describeError, isAccountDeletionPending } from './api-error.ts';
import {
  consentBodyKey,
  consentStateKey,
  consentTitleKey,
  formatDay,
  formatDayTime,
  isGrantActive,
  pendingAssents,
  pendingDeletions,
} from './consent.ts';

const record = (overrides: Partial<NonNullable<ConsentState['record']>> = {}) => ({
  id: 'r1',
  consentType: 'AI_PERSONALIZATION' as const,
  policyVersion: 1,
  status: 'GRANTED' as const,
  grantedAt: '2026-10-08T00:00:00Z',
  grantedByParentId: null,
  revokedAt: null,
  revokedByType: null,
  childAssentRequired: true,
  childAssentStatus: 'PENDING' as const,
  childAssentAt: null,
  ...overrides,
});

const state = (overrides: Partial<ConsentState>): ConsentState => ({
  type: 'AI_PERSONALIZATION',
  effective: false,
  reason: 'NOT_GRANTED',
  record: null,
  childAssentRequiredNow: true,
  ...overrides,
});

describe('consent helpers', () => {
  it('labels every state', () => {
    expect(consentStateKey(state({ effective: true, reason: null }))).toBe('consent.state.on');
    expect(consentStateKey(state({ reason: 'REVOKED' }))).toBe('consent.state.off');
    expect(consentStateKey(state({ reason: 'CHILD_ASSENT_PENDING' }))).toBe(
      'consent.state.assentPending',
    );
    expect(consentStateKey(state({ reason: 'CHILD_ASSENT_DECLINED' }))).toBe(
      'consent.state.assentDeclined',
    );
    expect(consentStateKey(state({ reason: 'RECONSENT_REQUIRED' }))).toBe(
      'consent.state.reconsent',
    );
  });

  it('offers turn-off only for an active, current grant', () => {
    expect(isGrantActive(state({ record: record(), reason: 'CHILD_ASSENT_PENDING' }))).toBe(true);
    expect(isGrantActive(state({ record: record(), reason: 'RECONSENT_REQUIRED' }))).toBe(false);
    expect(isGrantActive(state({ record: record({ status: 'REVOKED' }), reason: 'REVOKED' }))).toBe(
      false,
    );
    expect(isGrantActive(state({}))).toBe(false);
  });

  it('lists consents waiting for the child', () => {
    expect(
      pendingAssents([
        state({ record: record() }),
        state({ type: 'CORE_SERVICE', record: record({ childAssentStatus: 'NOT_REQUIRED' }) }),
        state({
          type: 'MICROPHONE_SPEAKING',
          record: record({ status: 'REVOKED', revokedAt: '2026-10-08T00:00:00Z' }),
        }),
      ]),
    ).toEqual(['AI_PERSONALIZATION']);
  });

  it('has a title and description for every consent type in both languages', () => {
    for (const type of CONSENT_TYPES) {
      for (const key of [consentTitleKey(type), consentBodyKey(type)]) {
        expect(vi[key as keyof typeof vi], key).toBeTruthy();
        expect(en[key], key).toBeTruthy();
      }
    }
  });

  it('formats dates in Vietnam time', () => {
    expect(formatDay('2026-11-06T18:30:00Z')).toBe('07/11/2026');
    expect(formatDayTime('2026-10-08T03:05:00Z')).toBe('10:05 08/10/2026');
  });

  it('explains CONSENT_REQUIRED for login and for features', () => {
    const err = (consentType: string) =>
      new AppError('api', 403, {
        code: 'CONSENT_REQUIRED',
        message: 'x',
        requestId: 'r',
        details: { consentType, reason: 'NOT_GRANTED' },
      });
    expect(describeError(err('CORE_SERVICE'))).toBe(
      'Bố mẹ cần cho phép con dùng VionX trước khi con đăng nhập.',
    );
    expect(describeError(err('AI_PERSONALIZATION'))).toBe('Tính năng này cần bố mẹ cho phép.');
  });
});

describe('pending deletions (Privacy Center "Hủy yêu cầu xóa")', () => {
  const now = new Date('2026-10-08T03:00:00Z');
  const job = (id: string, scope: 'CHILD' | 'ACCOUNT', purgeAfter: string, extra = {}) => ({
    id,
    scope,
    studentId: scope === 'CHILD' ? `s-${id}` : null,
    status: 'SCHEDULED' as const,
    purgeAfter,
    ...extra,
  });

  it('lists scheduled deletions only, account first, with days left and the child name', () => {
    const items = pendingDeletions(
      [
        job('1', 'CHILD', '2026-11-01T03:00:00Z'),
        job('2', 'CHILD', '2026-10-20T03:00:00Z', { status: 'CANCELLED' }),
        job('3', 'ACCOUNT', '2026-11-07T03:00:00Z'),
        job('4', 'CHILD', '2026-10-10T02:00:00Z'),
      ],
      [{ id: 's-1', displayName: 'Bé Na' }],
      now,
    );
    expect(items.map((i) => [i.id, i.name, i.daysLeft])).toEqual([
      ['3', null, 30],
      ['4', null, 2],
      ['1', 'Bé Na', 24],
    ]);
  });

  it('recognises the pending-account-deletion error and explains it', () => {
    const error = new AppError('api', 403, {
      code: 'ACCOUNT_DISABLED',
      message: 'Account deletion is pending',
      requestId: 'r',
      details: { reason: 'DELETION_PENDING' },
    });
    expect(isAccountDeletionPending(error)).toBe(true);
    expect(describeError(error)).toBe(vi['error.accountDeletionPending']);
    const child = new AppError('api', 403, {
      code: 'ACCOUNT_DISABLED',
      message: 'x',
      requestId: 'r',
    });
    expect(isAccountDeletionPending(child)).toBe(false);
    expect(describeError(child)).toBe(vi['error.childDisabled']);
    expect(en['privacy.cancelDeletion']).toBe('Cancel deletion request');
    expect(vi['privacy.cancelDeletion']).toBe('Hủy yêu cầu xóa');
  });
});

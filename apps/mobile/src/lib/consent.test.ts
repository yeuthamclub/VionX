import type { ConsentState } from '@vionx/contracts/client';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en.ts';
import { vi } from '../i18n/vi.ts';
import { CONSENT_TYPES } from '@vionx/domain';
import { AppError, describeError } from './api-error.ts';
import {
  consentBodyKey,
  consentStateKey,
  consentTitleKey,
  formatDay,
  formatDayTime,
  isGrantActive,
  pendingAssents,
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

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  assentAge,
  ASSENT_CONSENT_TYPES,
  CHILD_ASSENT_MIN_AGE,
  childAssentRequired,
  initialAssentStatus,
} from './assent.ts';
import {
  assertConsent,
  canRecordAssent,
  ConsentRequiredError,
  evaluateConsent,
  planGrant,
  revocationEndsSessions,
  revocationScope,
  type ConsentRecordState,
} from './evaluate.ts';
import {
  currentPolicyVersion,
  minimumAcceptedVersion,
  needsPolicyAcceptance,
  type PolicyVersionInfo,
} from './policy.ts';
import {
  DELETION_GRACE_DAYS,
  EXPORT_LINK_TTL_MS,
  exportExpiresAt,
  exportObjectPath,
  purgeAfter,
  remainingLinkSeconds,
} from './privacy.ts';
import { CONSENT_TYPES, isConsentType } from './types.ts';

const granted = (overrides: Partial<ConsentRecordState> = {}): ConsentRecordState => ({
  status: 'GRANTED',
  policyVersion: 1,
  childAssentRequired: false,
  childAssentStatus: 'NOT_REQUIRED',
  ...overrides,
});

const NOW = new Date('2026-10-08T03:00:00Z');

describe('consent types', () => {
  it('has the six v1 types (no camera, no heart rate)', () => {
    expect(CONSENT_TYPES).toEqual([
      'CORE_SERVICE',
      'EDUCATION_ANALYTICS',
      'AI_PERSONALIZATION',
      'MICROPHONE_SPEAKING',
      'HEALTH_CONNECT_ACTIVITY',
      'COMPETITION_AREA',
    ]);
    expect(isConsentType('CAMERA_READING')).toBe(false);
    expect(isConsentType('AI_PERSONALIZATION')).toBe(true);
  });
});

describe('child assent', () => {
  it('is required from age 7 for AI, microphone and health only', () => {
    expect(ASSENT_CONSENT_TYPES).toEqual([
      'AI_PERSONALIZATION',
      'MICROPHONE_SPEAKING',
      'HEALTH_CONNECT_ACTIVITY',
    ]);
    // 2026 - 2019 = 7 → required; 2020 → 6 → not required.
    expect(childAssentRequired('AI_PERSONALIZATION', 2019, NOW)).toBe(true);
    expect(childAssentRequired('AI_PERSONALIZATION', 2020, NOW)).toBe(false);
    expect(childAssentRequired('MICROPHONE_SPEAKING', 2014, NOW)).toBe(true);
    expect(childAssentRequired('CORE_SERVICE', 2010, NOW)).toBe(false);
    expect(childAssentRequired('COMPETITION_AREA', 2010, NOW)).toBe(false);
  });

  it('uses the household-local year (New Year in Vietnam before UTC)', () => {
    const newYearVn = new Date('2026-12-31T18:00:00Z'); // 01:00 on 1 Jan 2027 in Hanoi
    expect(assentAge(2020, newYearVn)).toBe(7);
    expect(assentAge(2020, newYearVn, 'UTC')).toBe(6);
  });

  it('property: required iff assent type and local year - birth year >= 7', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONSENT_TYPES),
        fc.integer({ min: 2006, max: 2024 }),
        (type, birthYear) => {
          const expected =
            ASSENT_CONSENT_TYPES.includes(type) && 2026 - birthYear >= CHILD_ASSENT_MIN_AGE;
          expect(childAssentRequired(type, birthYear, NOW)).toBe(expected);
        },
      ),
    );
  });

  it('a fresh grant starts PENDING when assent is required', () => {
    expect(initialAssentStatus(true)).toBe('PENDING');
    expect(initialAssentStatus(false)).toBe('NOT_REQUIRED');
  });

  it('assent can be recorded only once, on an active grant that needs it', () => {
    expect(
      canRecordAssent(granted({ childAssentRequired: true, childAssentStatus: 'PENDING' })),
    ).toBe(true);
    expect(
      canRecordAssent(granted({ childAssentRequired: true, childAssentStatus: 'GIVEN' })),
    ).toBe(false);
    expect(canRecordAssent(granted())).toBe(false);
    expect(
      canRecordAssent(
        granted({ status: 'REVOKED', childAssentRequired: true, childAssentStatus: 'PENDING' }),
      ),
    ).toBe(false);
    expect(canRecordAssent(null)).toBe(false);
  });
});

describe('evaluateConsent / assertConsent', () => {
  it('is effective only when granted, on an accepted policy version, with assent when required', () => {
    expect(evaluateConsent(granted(), 1)).toEqual({ effective: true });
    expect(evaluateConsent(null, 1)).toEqual({ effective: false, reason: 'NOT_GRANTED' });
    expect(evaluateConsent(granted({ status: 'REVOKED' }), 1)).toEqual({
      effective: false,
      reason: 'REVOKED',
    });
    expect(evaluateConsent(granted({ status: 'SUPERSEDED' }), 1)).toEqual({
      effective: false,
      reason: 'NOT_GRANTED',
    });
    expect(evaluateConsent(granted({ policyVersion: 1 }), 2)).toEqual({
      effective: false,
      reason: 'RECONSENT_REQUIRED',
    });
    expect(
      evaluateConsent(granted({ childAssentRequired: true, childAssentStatus: 'PENDING' }), 1),
    ).toEqual({ effective: false, reason: 'CHILD_ASSENT_PENDING' });
    expect(
      evaluateConsent(granted({ childAssentRequired: true, childAssentStatus: 'DECLINED' }), 1),
    ).toEqual({ effective: false, reason: 'CHILD_ASSENT_DECLINED' });
    expect(
      evaluateConsent(granted({ childAssentRequired: true, childAssentStatus: 'GIVEN' }), 1),
    ).toEqual({ effective: true });
  });

  it('assertConsent throws ConsentRequiredError with type and reason', () => {
    expect(() => assertConsent('CORE_SERVICE', granted(), 1)).not.toThrow();
    try {
      assertConsent('AI_PERSONALIZATION', granted({ status: 'REVOKED' }), 1);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConsentRequiredError);
      expect(e).toMatchObject({ consentType: 'AI_PERSONALIZATION', reason: 'REVOKED' });
    }
  });

  it('property: never effective unless status GRANTED and version >= minimum', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('GRANTED', 'REVOKED', 'SUPERSEDED' as const),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        fc.boolean(),
        fc.constantFrom('PENDING', 'GIVEN', 'DECLINED' as const),
        (status, version, minimum, required, assent) => {
          const record = granted({
            status: status as ConsentRecordState['status'],
            policyVersion: version,
            childAssentRequired: required,
            childAssentStatus: required
              ? (assent as ConsentRecordState['childAssentStatus'])
              : 'NOT_REQUIRED',
          });
          const effective = evaluateConsent(record, minimum).effective;
          const expected =
            status === 'GRANTED' && version >= minimum && (!required || assent === 'GIVEN');
          expect(effective).toBe(expected);
        },
      ),
    );
  });
});

describe('planGrant and revocation', () => {
  it('is idempotent for the same version and supersedes older ones', () => {
    expect(planGrant(null, 1)).toEqual({ action: 'insert' });
    expect(planGrant(granted({ status: 'REVOKED' }), 1)).toEqual({ action: 'insert' });
    expect(planGrant(granted({ policyVersion: 2 }), 2)).toEqual({ action: 'noop' });
    expect(planGrant(granted({ policyVersion: 1 }), 2)).toEqual({ action: 'supersede' });
  });

  it('CORE_SERVICE revocation clears every scope and ends sessions', () => {
    expect(revocationScope('CORE_SERVICE')).toEqual(CONSENT_TYPES);
    expect(revocationScope('AI_PERSONALIZATION')).toEqual(['AI_PERSONALIZATION']);
    expect(revocationEndsSessions('CORE_SERVICE')).toBe(true);
    expect(revocationEndsSessions('MICROPHONE_SPEAKING')).toBe(false);
  });
});

describe('policy versions', () => {
  const v = (version: number, effective: string, requiresReconsent = false): PolicyVersionInfo => ({
    version,
    effectiveAt: new Date(effective),
    requiresReconsent,
  });
  const versions = [
    v(1, '2026-01-01T00:00:00Z'),
    v(2, '2026-06-01T00:00:00Z', true),
    v(3, '2026-09-01T00:00:00Z'),
    v(4, '2027-01-01T00:00:00Z', true),
  ];

  it('current = highest effective version; future versions do not count yet', () => {
    expect(currentPolicyVersion(versions, NOW)).toBe(3);
    expect(currentPolicyVersion(versions, new Date('2025-12-01T00:00:00Z'))).toBeNull();
    expect(currentPolicyVersion(versions, new Date('2027-02-01T00:00:00Z'))).toBe(4);
  });

  it('minimum accepted = newest effective re-consent version, else the first', () => {
    expect(minimumAcceptedVersion(versions, NOW)).toBe(2);
    expect(minimumAcceptedVersion(versions, new Date('2026-03-01T00:00:00Z'))).toBe(1);
    expect(minimumAcceptedVersion(versions, new Date('2027-02-01T00:00:00Z'))).toBe(4);
    expect(minimumAcceptedVersion([], NOW)).toBe(1);
  });

  it('a parent needs to accept again only after a re-consent version', () => {
    expect(needsPolicyAcceptance([], versions, NOW)).toBe(true);
    expect(needsPolicyAcceptance([1], versions, NOW)).toBe(true);
    expect(needsPolicyAcceptance([2], versions, NOW)).toBe(false);
    expect(needsPolicyAcceptance([3], versions, NOW)).toBe(false);
    expect(needsPolicyAcceptance([], [], NOW)).toBe(false);
  });
});

describe('export and deletion timing', () => {
  it('export links live 24 hours and never outlive the export', () => {
    expect(EXPORT_LINK_TTL_MS).toBe(86_400_000);
    const expires = exportExpiresAt(NOW);
    expect(expires.toISOString()).toBe('2026-10-09T03:00:00.000Z');
    expect(remainingLinkSeconds(expires, NOW)).toBe(86_400);
    expect(remainingLinkSeconds(expires, new Date(expires.getTime() - 30_000))).toBeNull();
    expect(remainingLinkSeconds(expires, new Date(expires.getTime() + 1))).toBeNull();
  });

  it('hard delete is scheduled 30 days after the request', () => {
    expect(DELETION_GRACE_DAYS).toBe(30);
    expect(purgeAfter(NOW).toISOString()).toBe('2026-11-07T03:00:00.000Z');
  });

  it('export objects live in one folder per household', () => {
    expect(exportObjectPath('h1', 'j1')).toBe('h1/j1.zip');
  });
});

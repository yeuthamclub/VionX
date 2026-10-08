import type { ChildAssentStatus, ConsentRecordStatus, ConsentType } from './types.ts';
import { CONSENT_PREREQUISITES, CONSENT_TYPES, isServiceConsent } from './types.ts';

/** The latest consent record of one (child, type), as stored. */
export interface ConsentRecordState {
  status: ConsentRecordStatus;
  policyVersion: number;
  childAssentRequired: boolean;
  childAssentStatus: ChildAssentStatus;
}

export type ConsentDeniedReason =
  | 'NOT_GRANTED'
  | 'REVOKED'
  | 'RECONSENT_REQUIRED'
  | 'CHILD_ASSENT_PENDING'
  | 'CHILD_ASSENT_DECLINED'
  /** Granted, but a consent it depends on (CONSENT_PREREQUISITES) is not in force. */
  | 'PREREQUISITE_MISSING';

export type ConsentEvaluation =
  { effective: true } | { effective: false; reason: ConsentDeniedReason };

/**
 * Whether a consent is in force: granted, granted against a policy version that is still accepted,
 * and — when required — assented to by the child.
 */
export function evaluateConsent(
  record: ConsentRecordState | null | undefined,
  minimumPolicyVersion: number,
): ConsentEvaluation {
  if (!record) return { effective: false, reason: 'NOT_GRANTED' };
  if (record.status === 'REVOKED') return { effective: false, reason: 'REVOKED' };
  if (record.status !== 'GRANTED') return { effective: false, reason: 'NOT_GRANTED' };
  if (record.policyVersion < minimumPolicyVersion) {
    return { effective: false, reason: 'RECONSENT_REQUIRED' };
  }
  if (record.childAssentRequired) {
    if (record.childAssentStatus === 'DECLINED') {
      return { effective: false, reason: 'CHILD_ASSENT_DECLINED' };
    }
    if (record.childAssentStatus !== 'GIVEN') {
      return { effective: false, reason: 'CHILD_ASSENT_PENDING' };
    }
  }
  return { effective: true };
}

/** Thrown by `assertConsent`; the api maps it to `CONSENT_REQUIRED` (403). */
export class ConsentRequiredError extends Error {
  override readonly name = 'ConsentRequiredError';
  constructor(
    readonly consentType: ConsentType,
    readonly reason: ConsentDeniedReason,
  ) {
    super(`Consent ${consentType} is required (${reason})`);
  }
}

/**
 * The single consent gate (CONTRACT hard rule): call before AI personalisation, microphone, health,
 * competition-area features and child login (CORE_SERVICE).
 */
export function assertConsent(
  consentType: ConsentType,
  record: ConsentRecordState | null | undefined,
  minimumPolicyVersion: number,
): void {
  const result = evaluateConsent(record, minimumPolicyVersion);
  if (!result.effective) throw new ConsentRequiredError(consentType, result.reason);
}

export type GrantPlan =
  /** An equivalent grant is already active: nothing to write. */
  | { action: 'noop' }
  /** No active grant: insert a new record. */
  | { action: 'insert' }
  /** An active grant on an older policy version: end it (SUPERSEDED) and insert a new record. */
  | { action: 'supersede' };

/** What a grant request writes, given the active record (if any). */
export function planGrant(
  active: ConsentRecordState | null | undefined,
  policyVersion: number,
): GrantPlan {
  if (!active || active.status !== 'GRANTED') return { action: 'insert' };
  if (active.policyVersion >= policyVersion) return { action: 'noop' };
  return { action: 'supersede' };
}

/** Assent can be recorded only on an active grant that requires it and is not yet answered. */
export function canRecordAssent(active: ConsentRecordState | null | undefined): boolean {
  return Boolean(
    active &&
    active.status === 'GRANTED' &&
    active.childAssentRequired &&
    active.childAssentStatus === 'PENDING',
  );
}

/**
 * Queued work to cancel when `type` is revoked. CORE_SERVICE and CROSS_BORDER_TRANSFER end the
 * whole service for the child, so every consent-scoped queue is cleared and the child's sessions
 * are revoked. Revoking CROSS_BORDER_TRANSFER also stops AI personalisation (its prerequisite).
 */
export function revocationScope(type: ConsentType): readonly ConsentType[] {
  return isServiceConsent(type) ? CONSENT_TYPES : [type];
}

export function revocationEndsSessions(type: ConsentType): boolean {
  return isServiceConsent(type);
}

/**
 * Combines the evaluations of a feature's consents (`requiredConsentsFor`): the first one not in
 * force is reported, or null when all are.
 */
export function firstMissingConsent(
  evaluations: readonly { type: ConsentType; evaluation: ConsentEvaluation }[],
): { type: ConsentType; reason: ConsentDeniedReason } | null {
  for (const { type, evaluation } of evaluations) {
    if (!evaluation.effective) return { type, reason: evaluation.reason };
  }
  return null;
}

/**
 * A consent's own evaluation combined with its prerequisites (e.g. AI_PERSONALIZATION needs
 * CROSS_BORDER_TRANSFER): in force only when it and every prerequisite are. `missingPrerequisite`
 * names the first prerequisite not in force.
 */
export function evaluateWithPrerequisites(
  type: ConsentType,
  evaluations: Readonly<Partial<Record<ConsentType, ConsentEvaluation>>>,
): { evaluation: ConsentEvaluation; missingPrerequisite: ConsentType | null } {
  const own = evaluations[type] ?? { effective: false, reason: 'NOT_GRANTED' };
  if (!own.effective) return { evaluation: own, missingPrerequisite: null };
  for (const prerequisite of CONSENT_PREREQUISITES[type] ?? []) {
    if (!evaluations[prerequisite]?.effective) {
      return {
        evaluation: { effective: false, reason: 'PREREQUISITE_MISSING' },
        missingPrerequisite: prerequisite,
      };
    }
  }
  return { evaluation: own, missingPrerequisite: null };
}

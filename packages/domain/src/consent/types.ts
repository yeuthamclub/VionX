/** v1 consent types (CONTRACT §5). Camera and heart rate are out of v1 (CONTRACT D10). */
export const CONSENT_TYPES = [
  'CORE_SERVICE',
  'EDUCATION_ANALYTICS',
  'AI_PERSONALIZATION',
  'MICROPHONE_SPEAKING',
  'HEALTH_CONNECT_ACTIVITY',
  'COMPETITION_AREA',
] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export function isConsentType(value: string): value is ConsentType {
  return (CONSENT_TYPES as readonly string[]).includes(value);
}

/** Stored status of one consent record. A revoked or superseded record is final. */
export const CONSENT_RECORD_STATUSES = ['GRANTED', 'REVOKED', 'SUPERSEDED'] as const;
export type ConsentRecordStatus = (typeof CONSENT_RECORD_STATUSES)[number];

export const CHILD_ASSENT_STATUSES = ['NOT_REQUIRED', 'PENDING', 'GIVEN', 'DECLINED'] as const;
export type ChildAssentStatus = (typeof CHILD_ASSENT_STATUSES)[number];

/** Answers a child can give on the assent screen. */
export const CHILD_ASSENT_DECISIONS = ['GIVEN', 'DECLINED'] as const;
export type ChildAssentDecision = (typeof CHILD_ASSENT_DECISIONS)[number];

/** Policy documents. Consents are recorded against the PRIVACY_POLICY version. */
export const POLICY_TYPES = ['PRIVACY_POLICY', 'TERMS_OF_SERVICE'] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];
export const CONSENT_POLICY_TYPE: PolicyType = 'PRIVACY_POLICY';

export const POLICY_LOCALES = ['vi', 'en'] as const;
export type PolicyLocale = (typeof POLICY_LOCALES)[number];

/** CORE_SERVICE must be effective before a child can sign in (TASK_PACKS/M02). */
export const REQUIRED_FOR_CHILD_LOGIN: ConsentType = 'CORE_SERVICE';

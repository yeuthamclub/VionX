/** v1 consent types (CONTRACT §5). Camera and heart rate are out of v1 (CONTRACT D10). */
export const CONSENT_TYPES = [
  'CORE_SERVICE',
  'CROSS_BORDER_TRANSFER',
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

/**
 * Consents the service cannot run without, each granted by the parent as its own explicit step:
 * CORE_SERVICE (TASK_PACKS/M02) and CROSS_BORDER_TRANSFER (data is stored by Supabase in
 * Singapore; Law 91/2025 Art. 9(4) requires a separate consent, not one bundled into accepting the
 * policy). Both must be in force before a child can sign in; revoking either ends the service.
 */
export const REQUIRED_FOR_CHILD_LOGIN = [
  'CORE_SERVICE',
  'CROSS_BORDER_TRANSFER',
] as const satisfies readonly ConsentType[];

/**
 * Consents a feature needs in addition to its own: AI personalisation sends data to Anthropic in
 * the United States, a cross-border transfer.
 */
export const CONSENT_PREREQUISITES: Readonly<Partial<Record<ConsentType, readonly ConsentType[]>>> =
  {
    AI_PERSONALIZATION: ['CROSS_BORDER_TRANSFER'],
  };

/** Every consent a guarded feature of `type` needs, the type itself first. */
export function requiredConsentsFor(type: ConsentType): readonly ConsentType[] {
  return [type, ...(CONSENT_PREREQUISITES[type] ?? [])];
}

/** Revoking one of these ends the whole service for the child. */
export const isServiceConsent = (type: ConsentType): boolean =>
  (REQUIRED_FOR_CHILD_LOGIN as readonly ConsentType[]).includes(type);

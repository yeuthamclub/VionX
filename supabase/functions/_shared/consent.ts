// Consent gate for every module (CONTRACT §5, hard rule "assertConsent before AI personalisation,
// microphone, health or competition-area features"). Rules come from @vionx/domain; this file only
// loads the latest record and the policy versions.
import {
  assertConsent,
  CONSENT_POLICY_TYPE,
  ConsentRequiredError,
  evaluateConsent,
  minimumAcceptedVersion,
  requiredConsentsFor,
  type ChildAssentStatus,
  type ConsentEvaluation,
  type ConsentRecordStatus,
  type ConsentType,
  type PolicyType,
  type PolicyVersionInfo,
} from '@vionx/domain';
import type { Sql, TxSql } from './db.ts';
import { ApiError } from './errors.ts';
import type { Scope } from './scope.ts';

type Db = Sql | TxSql;

export interface ConsentRow {
  id: string;
  household_id: string;
  student_id: string | null;
  consent_type: ConsentType;
  policy_version: number;
  status: ConsentRecordStatus;
  granted_at: Date;
  granted_by_parent_id: string | null;
  revoked_at: Date | null;
  revoked_by_type: 'parent' | 'system' | null;
  child_assent_required: boolean;
  child_assent_status: ChildAssentStatus;
  child_assent_at: Date | null;
}

export const consentColumns = (db: Db) => db`
  id, household_id, student_id, consent_type, policy_version, status, granted_at,
  granted_by_parent_id, revoked_at, revoked_by_type, child_assent_required, child_assent_status,
  child_assent_at`;

/** Distinct versions of a policy type (locale-independent). */
export async function policyVersions(db: Db, type: PolicyType): Promise<PolicyVersionInfo[]> {
  const rows = await db<{ version: number; effective_at: Date; requires_reconsent: boolean }[]>`
    select version, min(effective_at) as effective_at, bool_or(requires_reconsent) as requires_reconsent
    from app.policy_versions where type = ${type}
    group by version order by version`;
  return rows.map((r) => ({
    version: r.version,
    effectiveAt: new Date(r.effective_at),
    requiresReconsent: r.requires_reconsent,
  }));
}

/** All consent records of a child, newest first (scoped). */
export async function consentHistory(
  db: Db,
  scope: Scope,
  studentId: string,
): Promise<ConsentRow[]> {
  return db<ConsentRow[]>`
    select ${consentColumns(db)} from app.consent_records
    where student_id = ${studentId} and ${scope.where()}
    order by granted_at desc, created_at desc`;
}

/** Latest record of one type (the active grant when there is one). */
export async function latestConsent(
  db: Db,
  scope: Scope,
  studentId: string,
  type: ConsentType,
  forUpdate = false,
): Promise<ConsentRow | null> {
  const rows = await db<ConsentRow[]>`
    select ${consentColumns(db)} from app.consent_records
    where student_id = ${studentId} and consent_type = ${type} and ${scope.where()}
    order by (status = 'GRANTED') desc, granted_at desc, created_at desc
    limit 1
    ${forUpdate ? db`for update` : db``}`;
  return rows[0] ?? null;
}

export const toRecordState = (row: ConsentRow) => ({
  status: row.status,
  policyVersion: row.policy_version,
  childAssentRequired: row.child_assent_required,
  childAssentStatus: row.child_assent_status,
});

export async function evaluateStudentConsent(
  db: Db,
  scope: Scope,
  studentId: string,
  type: ConsentType,
  now: Date,
): Promise<{ evaluation: ConsentEvaluation; record: ConsentRow | null; minimumVersion: number }> {
  const [record, versions] = await Promise.all([
    latestConsent(db, scope, studentId, type),
    policyVersions(db, CONSENT_POLICY_TYPE),
  ]);
  const minimumVersion = minimumAcceptedVersion(versions, now);
  const evaluation = evaluateConsent(record ? toRecordState(record) : null, minimumVersion);
  return { evaluation, record, minimumVersion };
}

/**
 * Throws CONSENT_REQUIRED (403, details {consentType, reason}) unless the consent and its
 * prerequisites (`requiredConsentsFor`: AI_PERSONALIZATION also needs CROSS_BORDER_TRANSFER) are
 * in force. `consentType` names the first missing one.
 */
export async function requireConsent(
  db: Db,
  scope: Scope,
  studentId: string,
  type: ConsentType,
  now: Date,
): Promise<void> {
  for (const required of requiredConsentsFor(type)) {
    const { record, minimumVersion } = await evaluateStudentConsent(
      db,
      scope,
      studentId,
      required,
      now,
    );
    try {
      assertConsent(required, record ? toRecordState(record) : null, minimumVersion);
    } catch (error) {
      if (error instanceof ConsentRequiredError) throw consentRequired(required, error.reason);
      throw error;
    }
  }
}

export function consentRequired(type: ConsentType, reason: string): ApiError {
  return new ApiError('CONSENT_REQUIRED', `Consent ${type} is required`, {
    consentType: type,
    reason,
  });
}

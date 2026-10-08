// Consent & privacy data access. Child data always goes through a Scope (CONTRACT §3).
import type {
  ConsentType,
  DeletionJobStatus,
  ExportJobStatus,
  PolicyLocale,
  PolicyType,
  PrivacyRequestStatus,
  PrivacyRequestType,
} from '@vionx/domain';
import type { Sql, TxSql } from '../../_shared/db.ts';
import type { Scope } from '../../_shared/scope.ts';

type Db = Sql | TxSql;

// --- Policies -------------------------------------------------------------------------------------

export interface PolicyRow {
  type: PolicyType;
  version: number;
  locale: PolicyLocale;
  title: string;
  effective_at: Date;
  requires_reconsent: boolean;
  content_md: string;
}

export async function policiesForLocale(db: Db, locale: PolicyLocale): Promise<PolicyRow[]> {
  return db<PolicyRow[]>`
    select type, version, locale, title, effective_at, requires_reconsent, content_md
    from app.policy_versions where locale = ${locale}
    order by type, version`;
}

export interface AcceptanceRow {
  policy_type: PolicyType;
  policy_version: number;
  locale: PolicyLocale;
  accepted_at: Date;
}

export async function acceptancesOf(db: Db, userId: string): Promise<AcceptanceRow[]> {
  return db<AcceptanceRow[]>`
    select policy_type, policy_version, locale, accepted_at from app.policy_acceptances
    where user_id = ${userId} order by accepted_at desc, policy_type`;
}

export async function insertAcceptance(
  db: Db,
  a: {
    userId: string;
    type: PolicyType;
    version: number;
    locale: PolicyLocale;
    deviceIdHash: string | null;
    requestId: string;
  },
): Promise<void> {
  await db`
    insert into app.policy_acceptances (user_id, policy_type, policy_version, locale, device_id_hash, request_id)
    values (${a.userId}, ${a.type}, ${a.version}, ${a.locale}, ${a.deviceIdHash}, ${a.requestId})
    on conflict (user_id, policy_type, policy_version) do nothing`;
}

// --- Students (consent context) -------------------------------------------------------------------

export interface ConsentStudentRow {
  id: string;
  household_id: string;
  birth_year: number;
  timezone: string;
}

export async function consentStudent(
  db: Db,
  scope: Scope,
  id: string,
): Promise<ConsentStudentRow | null> {
  const rows = await db<ConsentStudentRow[]>`
    select s.id, s.household_id, s.birth_year, h.timezone
    from app.students s join app.households h on h.id = s.household_id
    where s.id = ${id} and ${scope.where('s.household_id')}`;
  return rows[0] ?? null;
}

/** Serialises grant/revoke/assent of one (child, type). */
export async function lockConsent(tx: TxSql, studentId: string, type: ConsentType): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtext(${`consent:${studentId}:${type}`}))`;
}

export async function insertConsent(
  tx: TxSql,
  c: {
    householdId: string;
    studentId: string;
    type: ConsentType;
    policyVersion: number;
    grantedBy: string;
    childAssentRequired: boolean;
    deviceIdHash: string | null;
    requestId: string;
  },
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into app.consent_records (
      household_id, student_id, consent_type, policy_version, status, granted_by_parent_id,
      child_assent_required, child_assent_status, device_id_hash, request_id)
    values (${c.householdId}, ${c.studentId}, ${c.type}, ${c.policyVersion}, 'GRANTED', ${c.grantedBy},
            ${c.childAssentRequired}, ${c.childAssentRequired ? 'PENDING' : 'NOT_REQUIRED'},
            ${c.deviceIdHash}, ${c.requestId})
    returning id`;
  return row!.id;
}

export async function endConsent(
  tx: TxSql,
  scope: Scope,
  recordId: string,
  status: 'REVOKED' | 'SUPERSEDED',
  by: { type: 'parent' | 'system'; id: string | null },
): Promise<void> {
  await tx`
    update app.consent_records
    set status = ${status}, revoked_at = now(), revoked_by_type = ${by.type}, revoked_by_id = ${by.id}
    where id = ${recordId} and status = 'GRANTED' and ${scope.where()}`;
}

export async function recordAssent(
  tx: TxSql,
  scope: Scope,
  recordId: string,
  decision: 'GIVEN' | 'DECLINED',
): Promise<void> {
  await tx`
    update app.consent_records
    set child_assent_status = ${decision}, child_assent_at = now()
    where id = ${recordId} and status = 'GRANTED' and child_assent_status = 'PENDING' and ${scope.where()}`;
}

// --- Privacy requests and jobs -------------------------------------------------------------------

export async function insertPrivacyRequest(
  tx: TxSql,
  r: {
    householdId: string | null;
    studentId: string | null;
    type: PrivacyRequestType;
    requestedBy: string;
    source: 'app' | 'web';
    requestId: string;
  },
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into app.privacy_requests (household_id, student_id, type, status, requested_by, source, request_id)
    values (${r.householdId}, ${r.studentId}, ${r.type}, 'IN_PROGRESS', ${r.requestedBy}, ${r.source}, ${r.requestId})
    returning id`;
  return row!.id;
}

export interface ExportJobRow {
  id: string;
  household_id: string;
  requested_by: string;
  status: ExportJobStatus;
  object_path: string | null;
  size_bytes: string | number | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  expires_at: Date | null;
}

const exportColumns = (db: Db) => db`
  id, household_id, requested_by, status, object_path, size_bytes, created_at, started_at,
  completed_at, expires_at`;

export async function activeExport(db: Db, scope: Scope): Promise<ExportJobRow | null> {
  const rows = await db<ExportJobRow[]>`
    select ${exportColumns(db)} from app.data_export_jobs
    where status in ('QUEUED', 'RUNNING') and ${scope.where()}
    order by created_at desc limit 1`;
  return rows[0] ?? null;
}

export async function insertExportJob(
  tx: TxSql,
  j: { householdId: string; privacyRequestId: string; requestedBy: string },
): Promise<ExportJobRow> {
  const [row] = await tx<ExportJobRow[]>`
    insert into app.data_export_jobs (household_id, privacy_request_id, requested_by, status)
    values (${j.householdId}, ${j.privacyRequestId}, ${j.requestedBy}, 'QUEUED')
    returning ${exportColumns(tx)}`;
  return row!;
}

export async function exportJob(db: Db, scope: Scope, id: string): Promise<ExportJobRow | null> {
  const rows = await db<ExportJobRow[]>`
    select ${exportColumns(db)} from app.data_export_jobs where id = ${id} and ${scope.where()}`;
  return rows[0] ?? null;
}

export async function recentExports(db: Db, scope: Scope, limit = 5): Promise<ExportJobRow[]> {
  return db<ExportJobRow[]>`
    select ${exportColumns(db)} from app.data_export_jobs where ${scope.where()}
    order by created_at desc limit ${limit}`;
}

export interface DeletionJobRow {
  id: string;
  scope: 'CHILD' | 'ACCOUNT';
  household_id: string | null;
  student_id: string | null;
  user_id: string | null;
  status: DeletionJobStatus;
  requested_at: Date;
  purge_after: Date;
  completed_at: Date | null;
}

const deletionColumns = (db: Db) => db`
  id, scope, household_id, student_id, user_id, status, requested_at, purge_after, completed_at`;

export async function scheduledChildDeletion(
  db: Db,
  scope: Scope,
  studentId: string,
): Promise<DeletionJobRow | null> {
  const rows = await db<DeletionJobRow[]>`
    select ${deletionColumns(db)} from app.data_deletion_jobs
    where student_id = ${studentId} and scope = 'CHILD' and status = 'SCHEDULED' and ${scope.where()}`;
  return rows[0] ?? null;
}

export async function scheduledAccountDeletion(
  db: Db,
  userId: string,
): Promise<DeletionJobRow | null> {
  const rows = await db<DeletionJobRow[]>`
    select ${deletionColumns(db)} from app.data_deletion_jobs
    where user_id = ${userId} and scope = 'ACCOUNT' and status = 'SCHEDULED'`;
  return rows[0] ?? null;
}

export async function insertDeletionJob(
  tx: TxSql,
  j: {
    scope: 'CHILD' | 'ACCOUNT';
    householdId: string | null;
    studentId: string | null;
    userId: string | null;
    privacyRequestId: string;
    requestedAt: Date;
    purgeAfter: Date;
  },
): Promise<DeletionJobRow> {
  const [row] = await tx<DeletionJobRow[]>`
    insert into app.data_deletion_jobs (scope, household_id, student_id, user_id, privacy_request_id, status, requested_at, purge_after)
    values (${j.scope}, ${j.householdId}, ${j.studentId}, ${j.userId}, ${j.privacyRequestId}, 'SCHEDULED', ${j.requestedAt}, ${j.purgeAfter})
    returning ${deletionColumns(tx)}`;
  return row!;
}

export async function deletionsFor(
  db: Db,
  scope: Scope,
  userId: string,
): Promise<DeletionJobRow[]> {
  return db<DeletionJobRow[]>`
    select ${deletionColumns(db)} from app.data_deletion_jobs
    where ${scope.where()} or (scope = 'ACCOUNT' and user_id = ${userId})
    order by requested_at desc limit 20`;
}

export interface PrivacyRequestRow {
  id: string;
  type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  student_id: string | null;
  source: 'app' | 'web';
  created_at: Date;
  completed_at: Date | null;
}

export async function requestsFor(
  db: Db,
  scope: Scope,
  userId: string,
): Promise<PrivacyRequestRow[]> {
  return db<PrivacyRequestRow[]>`
    select id, type, status, student_id, source, created_at, completed_at
    from app.privacy_requests
    where ${scope.where()} or requested_by = ${userId}
    order by created_at desc limit 20`;
}

/** Account deletion: hide the household, turn every child login off and sign everyone out. */
export async function disableHousehold(tx: TxSql, householdId: string): Promise<number> {
  await tx`update app.households set deletion_requested_at = coalesce(deletion_requested_at, now())
           where id = ${householdId}`;
  await tx`update app.students set disabled_at = coalesce(disabled_at, now())
           where household_id = ${householdId}`;
  const revoked = await tx`
    update app.child_sessions set revoked_at = now()
    where household_id = ${householdId} and revoked_at is null returning id`;
  return revoked.length;
}

/**
 * Disables the parent's Supabase Auth account until the purge: banned (no new sign-in or token
 * refresh) and existing refresh sessions removed. Access tokens already issued expire within the
 * hour and no longer reach the household (it is hidden from the api).
 */
export async function disableParentAccount(tx: TxSql, userId: string): Promise<void> {
  await tx`update auth.users set banned_until = now() + interval '100 years' where id = ${userId}`;
  await tx`delete from auth.sessions where user_id = ${userId}`;
}

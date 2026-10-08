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
  cancelled_at: Date | null;
  restore_state: DeletionRestoreState;
}

/** What a request changed, so a cancel during the grace period restores exactly that. */
export interface DeletionRestoreState {
  /** CHILD: the parent had already disabled the child before asking for deletion. */
  studentWasDisabled?: boolean;
  /** ACCOUNT: children that were already disabled before the request. */
  disabledStudentIds?: string[];
}

const deletionColumns = (db: Db) => db`
  id, scope, household_id, student_id, user_id, status, requested_at, purge_after, completed_at,
  cancelled_at, restore_state`;

/** `lock`: row lock for a cancel, so it cannot interleave with the purge (which skips locked rows). */
export async function scheduledChildDeletion(
  db: Db,
  scope: Scope,
  studentId: string,
  lock = false,
): Promise<DeletionJobRow | null> {
  const rows = await db<DeletionJobRow[]>`
    select ${deletionColumns(db)} from app.data_deletion_jobs
    where student_id = ${studentId} and scope = 'CHILD' and status = 'SCHEDULED' and ${scope.where()}
    ${lock ? db`for update` : db``}`;
  return rows[0] ?? null;
}

export async function scheduledAccountDeletion(
  db: Db,
  userId: string,
  lock = false,
): Promise<DeletionJobRow | null> {
  const rows = await db<DeletionJobRow[]>`
    select ${deletionColumns(db)} from app.data_deletion_jobs
    where user_id = ${userId} and scope = 'ACCOUNT' and status = 'SCHEDULED'
    ${lock ? db`for update` : db``}`;
  return rows[0] ?? null;
}

/** The pending (grace-period) account deletion of a parent, if any. */
export async function pendingAccountDeletion(
  db: Db,
  userId: string,
): Promise<{ id: string; purgeAfter: Date } | null> {
  const rows = await db<{ id: string; purge_after: Date }[]>`
    select id, purge_after from app.data_deletion_jobs
    where user_id = ${userId} and scope = 'ACCOUNT' and status = 'SCHEDULED'`;
  const row = rows[0];
  return row ? { id: row.id, purgeAfter: row.purge_after } : null;
}

/** Marks a SCHEDULED job CANCELLED (the purge only takes SCHEDULED jobs) and closes its request. */
export async function cancelDeletionJob(
  tx: TxSql,
  job: DeletionJobRow,
  cancelledBy: string,
  at: Date,
): Promise<DeletionJobRow> {
  const [row] = await tx<DeletionJobRow[]>`
    update app.data_deletion_jobs
    set status = 'CANCELLED', cancelled_at = ${at}, cancelled_by = ${cancelledBy}
    where id = ${job.id} and status = 'SCHEDULED'
    returning ${deletionColumns(tx)}`;
  await tx`
    update app.privacy_requests set status = 'CANCELLED', completed_at = ${at}
    where id = (select privacy_request_id from app.data_deletion_jobs where id = ${job.id})`;
  return row!;
}

/** Whether a child is disabled right now (recorded before a deletion request). */
export async function studentDisabled(
  tx: TxSql,
  scope: Scope,
  studentId: string,
): Promise<boolean> {
  const rows = await tx<{ disabled: boolean }[]>`
    select disabled_at is not null as disabled from app.students
    where id = ${studentId} and ${scope.where()}`;
  return rows[0]?.disabled ?? false;
}

/** Children of a household that are disabled right now (recorded before an account deletion). */
export async function disabledStudentsOf(tx: TxSql, householdId: string): Promise<string[]> {
  const rows = await tx<{ id: string }[]>`
    select id from app.students where household_id = ${householdId} and disabled_at is not null`;
  return rows.map((r) => r.id);
}

export async function studentIdsOf(tx: TxSql, householdId: string): Promise<string[]> {
  const rows = await tx<{ id: string }[]>`
    select id from app.students where household_id = ${householdId}`;
  return rows.map((r) => r.id);
}

/** Children of a household with their own pending child deletion (they stay disabled). */
export async function pendingChildDeletionsOf(tx: TxSql, householdId: string): Promise<string[]> {
  const rows = await tx<{ student_id: string }[]>`
    select student_id from app.data_deletion_jobs
    where household_id = ${householdId} and scope = 'CHILD' and status = 'SCHEDULED'`;
  return rows.map((r) => r.student_id);
}

/** Account-deletion cancel: the household is visible again and the given children can sign in. */
export async function restoreHousehold(
  tx: TxSql,
  householdId: string,
  reenableStudentIds: readonly string[],
): Promise<void> {
  await tx`update app.households set deletion_requested_at = null where id = ${householdId}`;
  if (reenableStudentIds.length > 0) {
    await tx`
      update app.students set disabled_at = null
      where household_id = ${householdId} and id = any(${[...reenableStudentIds]}::uuid[])`;
  }
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
    restoreState: DeletionRestoreState;
  },
): Promise<DeletionJobRow> {
  const [row] = await tx<DeletionJobRow[]>`
    insert into app.data_deletion_jobs (scope, household_id, student_id, user_id, privacy_request_id, status, requested_at, purge_after, restore_state)
    values (${j.scope}, ${j.householdId}, ${j.studentId}, ${j.userId}, ${j.privacyRequestId}, 'SCHEDULED', ${j.requestedAt}, ${j.purgeAfter}, ${tx.json(j.restoreState as never)})
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
 * Account deletion signs the parent out everywhere (refresh sessions removed). The account is not
 * banned in Supabase Auth, so the parent can still sign in during the grace period to
 * cancel; until then the api answers ACCOUNT_DISABLED to everything except the deletion status and
 * cancel routes (see `ACCOUNT_DELETION_PENDING_ROUTES` in app.ts).
 */
export async function signOutParentEverywhere(tx: TxSql, userId: string): Promise<void> {
  await tx`delete from auth.sessions where user_id = ${userId}`;
}

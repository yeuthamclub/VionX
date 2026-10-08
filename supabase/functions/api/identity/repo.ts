// Identity & household data access. Every query on child data takes a Scope (CONTRACT §3).
import type { Avatar, HouseholdRole } from '@vionx/domain';
import type { Sql, TxSql } from '../../_shared/db.ts';
import type { Scope } from '../../_shared/scope.ts';

type Db = Sql | TxSql;

export interface StudentRow {
  id: string;
  household_id: string;
  display_name: string;
  birth_year: number;
  grade: number;
  avatar: Avatar;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  child_login_id: string;
  failed_attempts: number;
  locked_until: Date | null;
  active_sessions: number;
  core_service_consent: boolean;
  cross_border_transfer_consent: boolean;
  deletion_scheduled_for: Date | null;
}

export interface HouseholdRow {
  id: string;
  name: string;
  timezone: string;
  role: HouseholdRole;
  created_at: Date;
}

export interface AuditEntry {
  actorType: 'parent' | 'child' | 'admin' | 'system';
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  householdId: string | null;
  requestId: string;
  details?: Record<string, unknown>;
}

export async function writeAudit(db: Db, e: AuditEntry): Promise<void> {
  await db`
    insert into ops.audit_logs (actor_type, actor_id, action, target_type, target_id, household_id, request_id, details)
    values (${e.actorType}, ${e.actorId}, ${e.action}, ${e.targetType}, ${e.targetId},
            ${e.householdId}, ${e.requestId}, ${db.json((e.details ?? {}) as never)})`;
}

export async function writeEvent(
  db: Db,
  e: {
    type: string;
    householdId: string | null;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
  },
): Promise<void> {
  await db`
    insert into ops.domain_events (type, household_id, aggregate_type, aggregate_id, payload, idempotency_key)
    values (${e.type}, ${e.householdId}, ${e.aggregateType}, ${e.aggregateId},
            ${db.json(e.payload as never)}, ${e.idempotencyKey ?? null})`;
}

// --- Parent profile & households ---------------------------------------------------------------

export async function ensureProfile(
  db: Db,
  userId: string,
): Promise<{ display_name: string | null }> {
  const rows = await db<{ display_name: string | null }[]>`
    insert into app.profiles (user_id) values (${userId})
    on conflict (user_id) do update set user_id = excluded.user_id
    returning display_name`;
  return rows[0]!;
}

export async function householdsOf(db: Db, userId: string): Promise<HouseholdRow[]> {
  return db<HouseholdRow[]>`
    select h.id, h.name, h.timezone, m.role, h.created_at
    from app.household_memberships m
    join app.households h on h.id = m.household_id
    where m.user_id = ${userId} and h.deletion_requested_at is null
    order by (m.role = 'OWNER') desc, m.created_at`;
}

export async function createHousehold(
  sql: Sql,
  userId: string,
  input: { name: string; timezone: string },
): Promise<HouseholdRow | null> {
  return (await sql.begin(async (tx) => {
    // Serialise concurrent creates by the same parent.
    await tx`select pg_advisory_xact_lock(hashtext(${`household:${userId}`}))`;
    await ensureProfile(tx, userId);
    const existing = await tx`select 1 from app.household_memberships where user_id = ${userId}`;
    if (existing.length > 0) return null;
    if (await accountDeletionPending(tx, userId)) return null;
    const [household] = await tx<{ id: string; created_at: Date }[]>`
      insert into app.households (name, timezone, created_by)
      values (${input.name}, ${input.timezone}, ${userId})
      returning id, created_at`;
    await tx`
      insert into app.household_memberships (household_id, user_id, role)
      values (${household!.id}, ${userId}, 'OWNER')`;
    await writeEvent(tx, {
      type: 'identity.household_created',
      householdId: household!.id,
      aggregateType: 'household',
      aggregateId: household!.id,
      payload: { householdId: household!.id, timezone: input.timezone },
    });
    return { id: household!.id, ...input, role: 'OWNER', created_at: household!.created_at };
  })) as HouseholdRow | null;
}

// --- Students ------------------------------------------------------------------------------------

const studentColumns = (sql: Db) => sql`
  s.id, s.household_id, s.display_name, s.birth_year, s.grade, s.avatar, s.disabled_at,
  s.created_at, s.updated_at, c.child_login_id, c.failed_attempts, c.locked_until,
  (select count(*)::int from app.child_sessions cs
     where cs.student_id = s.id and cs.revoked_at is null and cs.expires_at > now()) as active_sessions,
  exists (select 1 from app.consent_records cr
     where cr.student_id = s.id and cr.household_id = s.household_id
       and cr.consent_type = 'CORE_SERVICE' and cr.status = 'GRANTED'
       and cr.policy_version >= app.policy_min_accepted_version('PRIVACY_POLICY')) as core_service_consent,
  exists (select 1 from app.consent_records cr
     where cr.student_id = s.id and cr.household_id = s.household_id
       and cr.consent_type = 'CROSS_BORDER_TRANSFER' and cr.status = 'GRANTED'
       and cr.policy_version >= app.policy_min_accepted_version('PRIVACY_POLICY')) as cross_border_transfer_consent,
  (select dj.purge_after from app.data_deletion_jobs dj
     where dj.student_id = s.id and dj.household_id = s.household_id
       and dj.scope = 'CHILD' and dj.status = 'SCHEDULED') as deletion_scheduled_for`;

export async function listStudents(sql: Db, scope: Scope): Promise<StudentRow[]> {
  return sql<StudentRow[]>`
    select ${studentColumns(sql)}
    from app.students s
    join app.child_credentials c on c.student_id = s.id
    where ${scope.where('s.household_id')}
    order by s.created_at, s.id`;
}

export async function getStudent(sql: Db, scope: Scope, id: string): Promise<StudentRow | null> {
  const rows = await sql<StudentRow[]>`
    select ${studentColumns(sql)}
    from app.students s
    join app.child_credentials c on c.student_id = s.id
    where s.id = ${id} and ${scope.where('s.household_id')}`;
  return rows[0] ?? null;
}

export async function insertStudent(
  tx: TxSql,
  input: {
    householdId: string;
    displayName: string;
    birthYear: number;
    grade: number;
    avatar: string;
    childLoginId: string;
    pinHash: string;
  },
): Promise<string> {
  const [student] = await tx<{ id: string }[]>`
    insert into app.students (household_id, display_name, birth_year, grade, avatar)
    values (${input.householdId}, ${input.displayName}, ${input.birthYear}, ${input.grade}, ${input.avatar})
    returning id`;
  await tx`
    insert into app.child_credentials (student_id, household_id, child_login_id, pin_hash)
    values (${student!.id}, ${input.householdId}, ${input.childLoginId}, ${input.pinHash})`;
  return student!.id;
}

export async function updateStudent(
  sql: Db,
  scope: Scope,
  id: string,
  patch: { displayName?: string; birthYear?: number; grade?: number; avatar?: string },
): Promise<boolean> {
  const columns: Record<string, unknown> = {};
  if (patch.displayName !== undefined) columns.display_name = patch.displayName;
  if (patch.birthYear !== undefined) columns.birth_year = patch.birthYear;
  if (patch.grade !== undefined) columns.grade = patch.grade;
  if (patch.avatar !== undefined) columns.avatar = patch.avatar;
  if (Object.keys(columns).length === 0) {
    return (await getStudent(sql, scope, id)) !== null;
  }
  const rows = await sql`
    update app.students set ${sql(columns as never, ...Object.keys(columns))}
    where id = ${id} and ${scope.where()}
    returning id`;
  return rows.length > 0;
}

export async function setPin(
  tx: TxSql,
  scope: Scope,
  studentId: string,
  pinHash: string,
): Promise<string | null> {
  const rows = await tx<{ child_login_id: string }[]>`
    update app.child_credentials
    set pin_hash = ${pinHash}, failed_attempts = 0, locked_until = null, pin_updated_at = now()
    where student_id = ${studentId} and ${scope.where()}
    returning child_login_id`;
  return rows[0]?.child_login_id ?? null;
}

export async function revokeSessions(tx: Db, scope: Scope, studentId: string): Promise<number> {
  const rows = await tx`
    update app.child_sessions set revoked_at = now()
    where student_id = ${studentId} and revoked_at is null and ${scope.where()}
    returning id`;
  return rows.length;
}

export async function setDisabled(
  tx: Db,
  scope: Scope,
  studentId: string,
  disabled: boolean,
): Promise<boolean> {
  const rows = await tx`
    update app.students
    set disabled_at = ${disabled ? tx`coalesce(disabled_at, now())` : null}
    where id = ${studentId} and ${scope.where()}
    returning id`;
  return rows.length > 0;
}

// --- Child login -----------------------------------------------------------------------------------

export interface CredentialRow {
  student_id: string;
  household_id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  disabled_at: Date | null;
  display_name: string;
  grade: number;
  avatar: Avatar;
}

/** Unscoped by design: login is how a child obtains a scope. Only used by the login route. */
export async function findCredentialByLoginId(
  sql: Db,
  childLoginId: string,
  forUpdate = false,
): Promise<CredentialRow | null> {
  const rows = await sql<CredentialRow[]>`
    select c.student_id, c.household_id, c.pin_hash, c.failed_attempts, c.locked_until,
           s.disabled_at, s.display_name, s.grade, s.avatar
    from app.child_credentials c
    join app.students s on s.id = c.student_id
    where c.child_login_id = ${childLoginId}
    ${forUpdate ? sql`for update of c` : sql``}`;
  return rows[0] ?? null;
}

export async function rateLimitHit(
  sql: Db,
  bucket: string,
  windowSeconds: number,
): Promise<number> {
  const [row] = await sql<{ hits: number }[]>`
    select ops.rate_limit_hit(${bucket}, ${windowSeconds}::integer) as hits`;
  return row!.hits;
}

/** The parent asked to delete their account (the account is disabled until the purge). */
export async function accountDeletionPending(db: Db, userId: string): Promise<boolean> {
  const rows = await db`
    select 1 from app.data_deletion_jobs
    where user_id = ${userId} and scope = 'ACCOUNT' and status = 'SCHEDULED'`;
  return rows.length > 0;
}

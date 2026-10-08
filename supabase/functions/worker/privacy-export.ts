// Household data export (TASK_PACKS/M02): the worker zips the household's JSON into the private
// bucket, marks the job READY for 24 hours and notifies the parent. Only rows of the job's
// household are read; secrets (PIN hashes, session token hashes) are never exported.
import { strToU8, zipSync } from 'fflate';
import { exportExpiresAt, exportObjectPath } from '@vionx/domain';
import type { Sql, TxSql } from '../_shared/db.ts';
import type { ParentNotifier } from '../_shared/notify.ts';
import { PRIVACY_EXPORT_BUCKET, type ObjectStorage } from '../_shared/storage.ts';

type Db = Sql | TxSql;

export interface ExportSection {
  file: string;
  /** Rows of this household only. */
  query: (db: Db, householdId: string) => Promise<readonly unknown[]>;
}

/**
 * What an export contains. Modules that store family data append a section here (calendar,
 * rewards, practice...). Every query filters on the job's household.
 */
export const EXPORT_SECTIONS: ExportSection[] = [
  {
    file: 'household.json',
    query: (db, h) => db`
      select id, name, timezone, created_at, updated_at, deletion_requested_at
      from app.households where id = ${h}`,
  },
  {
    file: 'members.json',
    query: (db, h) => db`
      select m.user_id, m.role, m.created_at, p.display_name, p.locale, u.phone, u.email
      from app.household_memberships m
      left join app.profiles p on p.user_id = m.user_id
      left join auth.users u on u.id = m.user_id
      where m.household_id = ${h} order by m.created_at`,
  },
  {
    file: 'children.json',
    query: (db, h) => db`
      select s.id, s.display_name, s.birth_year, s.grade, s.avatar, s.disabled_at, s.created_at,
             s.updated_at, c.child_login_id, c.pin_updated_at
      from app.students s left join app.child_credentials c on c.student_id = s.id
      where s.household_id = ${h} order by s.created_at`,
  },
  {
    file: 'child_sessions.json',
    query: (db, h) => db`
      select id, student_id, device_id, created_at, last_seen_at, expires_at, revoked_at
      from app.child_sessions where household_id = ${h} order by created_at`,
  },
  {
    file: 'consents.json',
    query: (db, h) => db`
      select id, student_id, consent_type, policy_type, policy_version, status,
             granted_by_parent_id, granted_at, revoked_at, revoked_by_type, child_assent_required,
             child_assent_status, child_assent_at
      from app.consent_records where household_id = ${h} order by granted_at`,
  },
  {
    file: 'policy_acceptances.json',
    query: (db, h) => db`
      select a.user_id, a.policy_type, a.policy_version, a.locale, a.accepted_at
      from app.policy_acceptances a
      where a.user_id in (select user_id from app.household_memberships where household_id = ${h})
      order by a.accepted_at`,
  },
  {
    file: 'privacy_requests.json',
    query: (db, h) => db`
      select id, student_id, type, status, requested_by, source, created_at, completed_at
      from app.privacy_requests where household_id = ${h} order by created_at`,
  },
  {
    file: 'data_exports.json',
    query: (db, h) => db`
      select id, status, created_at, completed_at, expires_at
      from app.data_export_jobs where household_id = ${h} order by created_at`,
  },
  {
    file: 'data_deletions.json',
    query: (db, h) => db`
      select id, scope, student_id, status, requested_at, purge_after, completed_at
      from app.data_deletion_jobs where household_id = ${h} order by requested_at`,
  },
  {
    file: 'audit_log.json',
    query: (db, h) => db`
      select created_at, actor_type, actor_id, action, target_type, target_id, details
      from ops.audit_logs where household_id = ${h} order by created_at`,
  },
];

export async function collectHouseholdData(
  db: Db,
  householdId: string,
): Promise<Record<string, readonly unknown[]>> {
  const out: Record<string, readonly unknown[]> = {};
  for (const section of EXPORT_SECTIONS) {
    out[section.file] = [...(await section.query(db, householdId))];
  }
  return out;
}

const README = `VionX data export

Each .json file holds one kind of data of your household (UTF-8, ISO 8601 times in UTC).
PINs and session tokens are never exported (only their hashes are stored, and those stay with us).

Bản xuất dữ liệu VionX: mỗi tệp .json chứa một loại dữ liệu của gia đình bạn.
Mã PIN và mã phiên đăng nhập không bao giờ được xuất.
`;

export function buildExportZip(
  data: Record<string, readonly unknown[]>,
  manifest: Record<string, unknown>,
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'README.txt': strToU8(README),
    'manifest.json': strToU8(
      JSON.stringify({ ...manifest, files: Object.keys(data).sort() }, null, 2),
    ),
  };
  for (const [name, rows] of Object.entries(data)) {
    files[name] = strToU8(JSON.stringify(rows, null, 2));
  }
  return zipSync(files, { level: 6 });
}

export interface ExportDeps {
  storage: ObjectStorage;
  notifier: ParentNotifier;
  now?: () => Date;
}

interface JobRow {
  id: string;
  household_id: string;
  privacy_request_id: string;
  requested_by: string;
  status: string;
}

/** Runs one export job inside the worker's transaction. Idempotent: only QUEUED jobs run. */
export async function runExportJob(
  tx: TxSql,
  jobId: string,
  deps: ExportDeps,
): Promise<'ready' | 'skipped' | 'failed'> {
  const [job] = await tx<JobRow[]>`
    select id, household_id, privacy_request_id, requested_by, status
    from app.data_export_jobs where id = ${jobId} for update`;
  if (!job || job.status !== 'QUEUED') return 'skipped';
  const started = deps.now?.() ?? new Date();
  try {
    const result = (await tx.savepoint(async (sp) => {
      const data = await collectHouseholdData(sp, job.household_id);
      const zip = buildExportZip(data, {
        format: 'vionx-household-export',
        version: 1,
        householdId: job.household_id,
        jobId: job.id,
        generatedAt: started.toISOString(),
      });
      const path = exportObjectPath(job.household_id, job.id);
      await deps.storage.upload(PRIVACY_EXPORT_BUCKET, path, zip, 'application/zip');
      const completed = deps.now?.() ?? new Date();
      const expiresAt = exportExpiresAt(completed);
      await sp`
        update app.data_export_jobs
        set status = 'READY', object_path = ${path}, size_bytes = ${zip.byteLength},
            started_at = ${started}, completed_at = ${completed}, expires_at = ${expiresAt}
        where id = ${job.id}`;
      await sp`
        update app.privacy_requests set status = 'COMPLETED', completed_at = ${completed}
        where id = ${job.privacy_request_id}`;
      await deps.notifier.notify(sp, {
        userId: job.requested_by,
        householdId: job.household_id,
        kind: 'privacy.export_ready',
        data: { jobId: job.id, expiresAt: expiresAt.toISOString() },
        idempotencyKey: `privacy.export_ready:${job.id}`,
      });
      await sp`
        insert into ops.audit_logs (actor_type, action, target_type, target_id, household_id, details)
        values ('system', 'privacy.export_ready', 'data_export_job', ${job.id}, ${job.household_id},
                ${sp.json({ sizeBytes: zip.byteLength, files: Object.keys(data).length })})`;
      return 'ready' as const;
    })) as 'ready';
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await tx`
      update app.data_export_jobs
      set status = 'FAILED', error = ${message.slice(0, 500)}, started_at = ${started}
      where id = ${job.id}`;
    await tx`update app.privacy_requests set status = 'FAILED' where id = ${job.privacy_request_id}`;
    return 'failed';
  }
}

/**
 * Tick maintenance: deletes export files whose 24 hours are over (or whose household is being
 * deleted) and marks the jobs EXPIRED.
 */
export async function expireExports(
  sql: Sql,
  storage: ObjectStorage,
  now: Date = new Date(),
): Promise<number> {
  const rows = await sql<{ id: string; object_path: string }[]>`
    select j.id, j.object_path from app.data_export_jobs j
    join app.households h on h.id = j.household_id
    where j.status = 'READY' and (j.expires_at <= ${now} or h.deletion_requested_at is not null)
    order by j.expires_at limit 50`;
  if (rows.length === 0) return 0;
  await storage.remove(
    PRIVACY_EXPORT_BUCKET,
    rows.map((r) => r.object_path),
  );
  await sql`
    update app.data_export_jobs set status = 'EXPIRED'
    where id = any(${rows.map((r) => r.id)}::uuid[]) and status = 'READY'`;
  return rows.length;
}

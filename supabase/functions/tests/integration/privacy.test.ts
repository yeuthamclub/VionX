// M02 consent & privacy against local Supabase (`pnpm db:start && pnpm fn:serve`).
// Every new child-data route is checked for cross-household denial (404).
import { randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConsentStateSchema,
  DeletionResponseSchema,
  ErrorBodySchema,
  ExportJobResponseSchema,
  PoliciesResponseSchema,
  PrivacyOverviewResponseSchema,
  StudentConsentsResponseSchema,
  StudentCreateResponseSchema,
  StudentSchema,
} from '@vionx/contracts';
import { DELETION_GRACE_DAYS } from '@vionx/domain';
import {
  signInWithPassword,
  signUpWithEmail,
  type AuthSession,
} from '../../../../scripts/lib/local-supabase.ts';

const FUNCTIONS_URL = (process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1').replace(
  /\/+$/,
  '',
);
const API = `${FUNCTIONS_URL}/api/v1`;
const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SERVICE_SECRET = process.env.VIONX_SERVICE_SECRET ?? 'local-dev-service-secret';
const sql = postgres(DB_URL, { max: 2, onnotice: () => {} });
const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

type Auth = { parent?: AuthSession; child?: string };

async function api(method: string, path: string, auth: Auth = {}, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth.parent) headers.authorization = `Bearer ${auth.parent.accessToken}`;
  if (auth.child) headers['x-vionx-child-session'] = auth.child;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

/** Runs one worker tick now (pg_cron also ticks every minute; handling is idempotent). */
async function tickWorker() {
  const res = await fetch(`${FUNCTIONS_URL}/worker`, {
    method: 'POST',
    headers: { 'x-vionx-service-secret': SERVICE_SECRET, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(res.status).toBe(200);
  return res.json();
}

let policyVersion = 1;
const createdUsers: string[] = [];

interface Family {
  parent: AuthSession;
  email: string;
  password: string;
  householdId: string;
  student: { id: string; displayName: string };
  credentials: { childLoginId: string; pin: string };
}

async function newFamily(name: string, birthYear = 2015): Promise<Family> {
  const email = `it-${randomUUID()}@vionx.test`;
  const password = `pw-${randomUUID()}`;
  const parent = await signUpWithEmail(email, password);
  createdUsers.push(parent.userId);
  const household = await api('POST', '/household', { parent }, { name });
  expect(household.status).toBe(201);
  const created = await api(
    'POST',
    '/students',
    { parent },
    { displayName: `${name} con`, birthYear, grade: 6, pin: '4826' },
  );
  expect(created.status).toBe(201);
  const body = StudentCreateResponseSchema.parse(created.body);
  return {
    parent,
    email,
    password,
    householdId: household.body.household.id,
    student: { id: body.student.id, displayName: body.student.displayName },
    credentials: body.credentials,
  };
}

const grant = (f: Family, type: string, studentId = f.student.id, version = policyVersion) =>
  api(
    'POST',
    `/students/${studentId}/consents/${type}/grant`,
    { parent: f.parent },
    {
      policyVersion: version,
      deviceId: 'it-device',
    },
  );

const revoke = (f: Family, type: string, studentId = f.student.id) =>
  api('POST', `/students/${studentId}/consents/${type}/revoke`, { parent: f.parent });

const login = (f: Family) =>
  api('POST', '/auth/child/login', {}, { ...f.credentials, deviceId: `it-${randomUUID()}` });

async function childToken(f: Family): Promise<string> {
  const res = await login(f);
  expect(res.status).toBe(200);
  return res.body.token as string;
}

beforeAll(async () => {
  const res = await api('GET', '/policies/current');
  policyVersion = PoliciesResponseSchema.parse(res.body).policies.find(
    (p) => p.type === 'PRIVACY_POLICY',
  )!.version;
});

afterAll(async () => {
  if (createdUsers.length > 0) {
    await sql`
      delete from app.households where id in (
        select household_id from app.household_memberships where user_id = any(${createdUsers}::uuid[]))`;
    await sql`delete from auth.users where id = any(${createdUsers}::uuid[])`;
  }
  await sql.end({ timeout: 5 });
});

describe('policies and the parent onboarding consent step', () => {
  it('serves the current DRAFT policy and terms in vi and en, publicly', async () => {
    for (const locale of ['vi', 'en'] as const) {
      const body = PoliciesResponseSchema.parse(
        (await api('GET', `/policies/current?locale=${locale}`)).body,
      );
      expect(body.policies.map((p) => p.type)).toEqual(['PRIVACY_POLICY', 'TERMS_OF_SERVICE']);
      expect(body.acceptances).toBeNull();
      const privacy = body.policies[0]!.contentMd;
      expect(privacy).toMatch(/DRAFT/);
      expect(privacy).toMatch(/Singapore/);
      expect(privacy).toMatch(/Anthropic/);
    }
  });

  it('a new parent must accept; only the current version is accepted; idempotent', async () => {
    const parent = await signUpWithEmail(`it-${randomUUID()}@vionx.test`, `pw-${randomUUID()}`);
    createdUsers.push(parent.userId);
    const before = PoliciesResponseSchema.parse(
      (await api('GET', '/policies/current', { parent })).body,
    );
    expect(before).toMatchObject({ acceptances: [], needsAcceptance: true });

    const stale = await api(
      'POST',
      '/policies/accept',
      { parent },
      {
        policies: [{ type: 'PRIVACY_POLICY', version: policyVersion + 1 }],
      },
    );
    expect(stale.status).toBe(409);

    const accept = {
      policies: before.policies.map((p) => ({ type: p.type, version: p.version })),
      locale: 'vi',
      deviceId: 'it-device',
    };
    expect((await api('POST', '/policies/accept', { parent }, accept)).status).toBe(200);
    const again = await api('POST', '/policies/accept', { parent }, accept);
    expect(again.body.acceptances).toHaveLength(2);
    const after = PoliciesResponseSchema.parse(
      (await api('GET', '/policies/current', { parent })).body,
    );
    expect(after.needsAcceptance).toBe(false);
    const rows =
      await sql`select device_id_hash from app.policy_acceptances where user_id = ${parent.userId}`;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.device_id_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('consents: CORE_SERVICE gate, assent, revocation', () => {
  let f: Family;
  let token: string;

  beforeAll(async () => {
    f = await newFamily('Consent', 2015); // 11 years old in 2026: assent required for AI
  });

  it('no child login is possible before CORE_SERVICE is granted', async () => {
    const res = await login(f);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: 'CONSENT_REQUIRED',
      details: { consentType: 'CORE_SERVICE', reason: 'NOT_GRANTED' },
    });
    const student = StudentSchema.parse(
      (await api('GET', `/students/${f.student.id}`, { parent: f.parent })).body,
    );
    expect(student.coreServiceConsent).toBe(false);
    // A wrong PIN still reads as a wrong PIN (no consent state leak).
    const wrong = await api(
      'POST',
      '/auth/child/login',
      {},
      {
        ...f.credentials,
        pin: '9999',
        deviceId: 'it',
      },
    );
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('lists every consent type as not granted', async () => {
    const body = StudentConsentsResponseSchema.parse(
      (await api('GET', `/students/${f.student.id}/consents`, { parent: f.parent })).body,
    );
    expect(body.consents.map((c) => c.type)).toHaveLength(6);
    expect(body.consents.every((c) => !c.effective && c.reason === 'NOT_GRANTED')).toBe(true);
    expect(body.history).toEqual([]);
    expect(body.policy.currentVersion).toBe(policyVersion);
  });

  it('grant needs the current policy version; then the child can sign in', async () => {
    const stale = await grant(f, 'CORE_SERVICE', f.student.id, policyVersion + 1);
    expect(stale.status).toBe(409);
    const res = await grant(f, 'CORE_SERVICE');
    expect(res.status).toBe(200);
    expect(ConsentStateSchema.parse(res.body)).toMatchObject({
      type: 'CORE_SERVICE',
      effective: true,
      reason: null,
      record: { status: 'GRANTED', policyVersion, childAssentStatus: 'NOT_REQUIRED' },
    });
    // Idempotent: a second grant writes nothing.
    expect((await grant(f, 'CORE_SERVICE')).status).toBe(200);
    const rows = await sql`
      select device_id_hash, granted_by_parent_id from app.consent_records
      where student_id = ${f.student.id} and consent_type = 'CORE_SERVICE'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.granted_by_parent_id).toBe(f.parent.userId);
    expect(rows[0]!.device_id_hash).toMatch(/^[0-9a-f]{64}$/);
    const events = await sql`
      select 1 from ops.domain_events where type = 'consent.granted' and payload->>'studentId' = ${f.student.id}`;
    expect(events).toHaveLength(1);
    token = await childToken(f);
  });

  it('AI for a 7+ child waits for the child’s assent; the child guard answers CONSENT_REQUIRED', async () => {
    const res = ConsentStateSchema.parse((await grant(f, 'AI_PERSONALIZATION')).body);
    expect(res).toMatchObject({
      effective: false,
      reason: 'CHILD_ASSENT_PENDING',
      childAssentRequiredNow: true,
      record: { childAssentRequired: true, childAssentStatus: 'PENDING' },
    });
    const guard = await api('GET', '/child/consents/AI_PERSONALIZATION', { child: token });
    expect(guard.status).toBe(403);
    expect(guard.body).toMatchObject({
      code: 'CONSENT_REQUIRED',
      details: { consentType: 'AI_PERSONALIZATION', reason: 'CHILD_ASSENT_PENDING' },
    });
  });

  it('the child sees their own consents and gives assent once', async () => {
    const own = await api('GET', `/students/${f.student.id}/consents`, { child: token });
    expect(own.status).toBe(200);
    const assent = await api(
      'POST',
      `/students/${f.student.id}/consents/AI_PERSONALIZATION/child-assent`,
      { child: token },
      { decision: 'GIVEN' },
    );
    expect(assent.status).toBe(200);
    expect(ConsentStateSchema.parse(assent.body)).toMatchObject({ effective: true });
    const again = await api(
      'POST',
      `/students/${f.student.id}/consents/AI_PERSONALIZATION/child-assent`,
      { child: token },
      { decision: 'DECLINED' },
    );
    expect(again.status).toBe(409);
    const guard = await api('GET', '/child/consents/AI_PERSONALIZATION', { child: token });
    expect(guard.body).toEqual({ type: 'AI_PERSONALIZATION', effective: true });
    // A parent cannot answer for the child.
    const byParent = await api(
      'POST',
      `/students/${f.student.id}/consents/AI_PERSONALIZATION/child-assent`,
      { parent: f.parent },
      { decision: 'GIVEN' },
    );
    expect(byParent.status).toBe(403);
  });

  it('after AI consent is revoked, the guarded call returns CONSENT_REQUIRED and queued AI jobs are dropped', async () => {
    await sql`select pgmq.send('ai_jobs', ${sql.json({ student_id: f.student.id, kind: 'tutor' })}::jsonb)`;
    await sql`select pgmq.send('ai_jobs', ${sql.json({ student_id: randomUUID(), kind: 'tutor' })}::jsonb)`;
    const res = ConsentStateSchema.parse((await revoke(f, 'AI_PERSONALIZATION')).body);
    expect(res).toMatchObject({ effective: false, reason: 'REVOKED' });
    const guard = await api('GET', '/child/consents/AI_PERSONALIZATION', { child: token });
    expect(guard.status).toBe(403);
    expect(guard.body.details.reason).toBe('REVOKED');

    // Idempotent: revoking again changes nothing.
    expect((await revoke(f, 'AI_PERSONALIZATION')).status).toBe(200);
    const events = await sql`
      select id from ops.domain_events
      where type = 'consent.revoked' and payload->>'studentId' = ${f.student.id}`;
    expect(events).toHaveLength(1);

    await tickWorker();
    const left = await sql`
      select message from pgmq.q_ai_jobs where message->>'student_id' = ${f.student.id}`;
    expect(left).toHaveLength(0);
    const others = await sql`select 1 from pgmq.q_ai_jobs`;
    expect(others.length).toBeGreaterThanOrEqual(1);
    const audit = await sql<{ details: { removedJobs: number } }[]>`
      select details from ops.audit_logs
      where action = 'consent.jobs_cancelled' and target_id = ${f.student.id}`;
    expect(audit[0]?.details.removedJobs).toBe(1);
    await sql`delete from pgmq.q_ai_jobs`;
  });

  it('keeps the history: re-granting adds a record, ended records are final', async () => {
    await grant(f, 'AI_PERSONALIZATION');
    const body = StudentConsentsResponseSchema.parse(
      (await api('GET', `/students/${f.student.id}/consents`, { parent: f.parent })).body,
    );
    const ai = body.history.filter((r) => r.consentType === 'AI_PERSONALIZATION');
    expect(ai.map((r) => r.status)).toEqual(['GRANTED', 'REVOKED']);
    expect(ai[0]!.childAssentStatus).toBe('PENDING');
    await expect(
      sql`update app.consent_records set status = 'GRANTED', revoked_at = null where id = ${ai[1]!.id}`,
    ).rejects.toThrow(/final/);
    await expect(
      sql`update app.consent_records set policy_version = 9 where id = ${ai[0]!.id}`,
    ).rejects.toThrow(/only status/);
  });

  it('a child under 7 needs no assent', async () => {
    const created = await api(
      'POST',
      '/students',
      { parent: f.parent },
      { displayName: 'Bé út', birthYear: 2020, grade: 1 },
    );
    const young = StudentCreateResponseSchema.parse(created.body).student.id;
    const res = ConsentStateSchema.parse((await grant(f, 'MICROPHONE_SPEAKING', young)).body);
    expect(res).toMatchObject({ effective: true, childAssentRequiredNow: false });
  });

  it('revoking CORE_SERVICE signs the child out and blocks login', async () => {
    const res = await revoke(f, 'CORE_SERVICE');
    expect(ConsentStateSchema.parse(res.body).effective).toBe(false);
    expect((await api('GET', '/auth/child/session', { child: token })).status).toBe(401);
    expect((await login(f)).body.code).toBe('CONSENT_REQUIRED');
    const audit = await sql<{ details: { revokedSessions: number } }[]>`
      select details from ops.audit_logs
      where action = 'consent.revoked' and target_id = ${f.student.id}
        and details->>'consentType' = 'CORE_SERVICE'`;
    expect(audit[0]!.details.revokedSessions).toBeGreaterThanOrEqual(1);
    await grant(f, 'CORE_SERVICE');
    expect((await login(f)).status).toBe(200);
  });

  it('a policy version that requires re-consent pauses consents until granted again', async () => {
    const next = policyVersion + 1;
    try {
      await sql`
        insert into app.policy_versions (type, version, locale, title, content_md, effective_at, requires_reconsent)
        values ('PRIVACY_POLICY', ${next}, 'vi', 'test', 'test', now() - interval '1 second', true),
               ('PRIVACY_POLICY', ${next}, 'en', 'test', 'test', now() - interval '1 second', true)`;
      const login1 = await login(f);
      expect(login1.body).toMatchObject({
        code: 'CONSENT_REQUIRED',
        details: { reason: 'RECONSENT_REQUIRED' },
      });
      const policies = PoliciesResponseSchema.parse(
        (await api('GET', '/policies/current', { parent: f.parent })).body,
      );
      expect(policies.needsAcceptance).toBe(true);
      expect(policies.minimumAcceptedVersions.PRIVACY_POLICY).toBe(next);
      const regrant = ConsentStateSchema.parse(
        (await grant(f, 'CORE_SERVICE', f.student.id, next)).body,
      );
      expect(regrant).toMatchObject({ effective: true, record: { policyVersion: next } });
      expect((await login(f)).status).toBe(200);
      const statuses = await sql<{ status: string }[]>`
        select status from app.consent_records
        where student_id = ${f.student.id} and consent_type = 'CORE_SERVICE' order by granted_at`;
      expect(statuses.map((s) => s.status)).toEqual(['REVOKED', 'SUPERSEDED', 'GRANTED']);
    } finally {
      // Test-only cleanup of an append-only table: bypass its trigger for this session.
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`delete from app.policy_versions where type = 'PRIVACY_POLICY' and version = ${next}`;
        await tx`
          delete from app.consent_records where student_id = ${f.student.id} and policy_version = ${next}`;
        await tx`
          update app.consent_records set status = 'GRANTED', revoked_at = null, revoked_by_type = null
          where student_id = ${f.student.id} and consent_type = 'CORE_SERVICE' and status = 'SUPERSEDED'`;
      });
    }
  });
});

describe('data export', () => {
  let a: Family;
  let b: Family;
  let jobId: string;

  beforeAll(async () => {
    a = await newFamily('Xuất A');
    b = await newFamily('Xuất B');
    await grant(a, 'CORE_SERVICE');
    await grant(b, 'CORE_SERVICE');
  });

  it('queues one job at a time', async () => {
    const res = await api('POST', '/privacy/export', { parent: a.parent });
    expect(res.status).toBe(202);
    const job = ExportJobResponseSchema.parse(res.body).job;
    expect(job).toMatchObject({ status: 'QUEUED', downloadUrl: null });
    jobId = job.id;
    const again = await api('POST', '/privacy/export', { parent: a.parent });
    expect(again.body.job.id).toBe(jobId);
  });

  it('the worker builds the zip, marks it READY for 24 h and notifies the parent', async () => {
    await tickWorker();
    const res = await api('GET', `/privacy/export/${jobId}`, { parent: a.parent });
    const job = ExportJobResponseSchema.parse(res.body).job;
    expect(job.status).toBe('READY');
    const hours = (Date.parse(job.expiresAt!) - Date.parse(job.completedAt!)) / 3_600_000;
    expect(hours).toBe(24);
    expect(job.downloadUrl).toMatch(/\/storage\/v1\/object\/sign\/privacy-exports\//);
    const notification = await sql`
      select payload from ops.domain_events
      where type = 'notification.push_requested' and idempotency_key = ${`privacy.export_ready:${jobId}`}`;
    expect(notification).toHaveLength(1);
    expect(notification[0]!.payload).toMatchObject({
      userId: a.parent.userId,
      kind: 'privacy.export_ready',
      data: { jobId },
    });

    const zip = new Uint8Array(await (await fetch(job.downloadUrl!)).arrayBuffer());
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['manifest.json', 'household.json', 'children.json', 'consents.json']),
    );
    const all = Object.values(files).map(utf8).join('\n');
    // Only the requesting household's data.
    expect(JSON.parse(utf8(files['household.json']!))[0].id).toBe(a.householdId);
    expect(all).toContain(a.student.id);
    expect(all).toContain(a.student.displayName);
    for (const foreign of [b.householdId, b.student.id, b.student.displayName, b.parent.userId]) {
      expect(all).not.toContain(foreign);
    }
    // Secrets never leave.
    expect(all).not.toMatch(/argon2id|pin_hash|token_hash/);

    // Private bucket: no anonymous access without the signature.
    const objectPath = new URL(job.downloadUrl!).pathname.replace(/.*\/sign\//, '');
    const unsigned = await fetch(
      `${new URL(job.downloadUrl!).origin}/storage/v1/object/public/${objectPath}`,
    );
    expect(unsigned.status).toBeGreaterThanOrEqual(400);
  });

  it('another household gets 404 for the job; the overview lists it for the owner only', async () => {
    expect((await api('GET', `/privacy/export/${jobId}`, { parent: b.parent })).status).toBe(404);
    const overviewA = PrivacyOverviewResponseSchema.parse(
      (await api('GET', '/privacy/overview', { parent: a.parent })).body,
    );
    expect(overviewA.exports.map((e) => e.id)).toContain(jobId);
    expect(overviewA.requests.map((r) => r.type)).toContain('EXPORT');
    const overviewB = PrivacyOverviewResponseSchema.parse(
      (await api('GET', '/privacy/overview', { parent: b.parent })).body,
    );
    expect(overviewB.exports.map((e) => e.id)).not.toContain(jobId);
  });

  it('expired exports lose their link and file', async () => {
    await sql`update app.data_export_jobs set expires_at = now() - interval '1 minute' where id = ${jobId}`;
    const tick = await tickWorker();
    expect(tick.maintenance.expiredExports).toBeGreaterThanOrEqual(1);
    const job = ExportJobResponseSchema.parse(
      (await api('GET', `/privacy/export/${jobId}`, { parent: a.parent })).body,
    ).job;
    expect(job).toMatchObject({ status: 'EXPIRED', downloadUrl: null });
  });

  it('is rate-limited to 3 per household per day', async () => {
    const failQueued = () =>
      sql`update app.data_export_jobs set status = 'FAILED' where household_id = ${b.householdId} and status = 'QUEUED'`;
    for (let i = 0; i < 3; i++) {
      await failQueued();
      expect((await api('POST', '/privacy/export', { parent: b.parent })).status).toBe(202);
    }
    await failQueued();
    const last = await api('POST', '/privacy/export', { parent: b.parent });
    expect(last.status).toBe(429);
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('deletion', () => {
  let a: Family;
  let b: Family;
  const ledger = 'ops.it_m02_ledger';

  beforeAll(async () => {
    a = await newFamily('Xoá A');
    b = await newFamily('Xoá B');
    await grant(a, 'CORE_SERVICE');
    await grant(b, 'CORE_SERVICE');
    // A stand-in ledger (M04 adds the real ones) registered for anonymisation.
    await sql.unsafe(`
      create table if not exists ${ledger} (
        id uuid primary key default gen_random_uuid(),
        household_id uuid not null, student_id uuid not null, amount integer not null);
      drop trigger if exists it_ledger_append_only on ${ledger};
      create trigger it_ledger_append_only before update or delete on ${ledger}
        for each row execute function ops.ledger_append_only();`);
    await sql`
      insert into ops.ledger_registry (table_name, student_column, household_column)
      values (${ledger}, 'student_id', 'household_id') on conflict do nothing`;
  });

  afterAll(async () => {
    await sql`delete from ops.ledger_registry where table_name = ${ledger}`;
    await sql.unsafe(`drop table if exists ${ledger}`);
  });

  it('a delete request blocks the child’s login at once and is idempotent', async () => {
    const token = await childToken(a);
    const missingConfirm = await api(
      'POST',
      `/students/${a.student.id}/delete-request`,
      { parent: a.parent },
      {},
    );
    expect(missingConfirm.status).toBe(400);
    const res = await api(
      'POST',
      `/students/${a.student.id}/delete-request`,
      { parent: a.parent },
      { confirm: true },
    );
    expect(res.status).toBe(202);
    const { deletion } = DeletionResponseSchema.parse(res.body);
    expect(deletion).toMatchObject({
      scope: 'CHILD',
      status: 'SCHEDULED',
      studentId: a.student.id,
    });
    const days = (Date.parse(deletion.purgeAfter) - Date.parse(deletion.requestedAt)) / 86_400_000;
    expect(days).toBe(DELETION_GRACE_DAYS);
    expect(days).toBe(14);

    expect((await login(a)).body.code).toBe('ACCOUNT_DISABLED');
    expect((await api('GET', '/auth/child/session', { child: token })).status).toBe(401);
    const student = StudentSchema.parse(
      (await api('GET', `/students/${a.student.id}`, { parent: a.parent })).body,
    );
    expect(student).toMatchObject({
      status: 'disabled',
      deletionScheduledFor: deletion.purgeAfter,
    });
    const reenable = await api(
      'POST',
      `/students/${a.student.id}/disable`,
      { parent: a.parent },
      { disabled: false },
    );
    expect(reenable.status).toBe(409);
    const again = await api(
      'POST',
      `/students/${a.student.id}/delete-request`,
      { parent: a.parent },
      { confirm: true },
    );
    expect(again.body.deletion.id).toBe(deletion.id);
  });

  it('pg_cron purge after the 14-day grace period deletes the child and anonymises ledgers', async () => {
    await sql`insert into ${sql(ledger)} (household_id, student_id, amount) values
      (${a.householdId}, ${a.student.id}, 10), (${a.householdId}, ${a.student.id}, 5)`;
    await expect(sql`update ${sql(ledger)} set amount = 0`).rejects.toThrow(/append-only/);
    const job = await sql<{ id: string }[]>`
      select id from app.data_deletion_jobs where student_id = ${a.student.id} and status = 'SCHEDULED'`;
    // Not due yet: nothing happens.
    await sql`select ops.purge_due_deletions()`;
    expect(await sql`select 1 from app.students where id = ${a.student.id}`).toHaveLength(1);

    await sql`update app.data_deletion_jobs set purge_after = now() - interval '1 minute' where id = ${job[0]!.id}`;
    const [purged] = await sql<{ n: number }[]>`select ops.purge_due_deletions() as n`;
    expect(purged!.n).toBeGreaterThanOrEqual(1);
    expect(await sql`select 1 from app.students where id = ${a.student.id}`).toHaveLength(0);
    expect(
      await sql`select 1 from app.consent_records where student_id = ${a.student.id}`,
    ).toHaveLength(0);
    const rows = await sql<{ household_id: string; student_id: string; amount: number }[]>`
      select household_id, student_id, amount from ${sql(ledger)} order by amount`;
    expect(rows.map((r) => r.amount)).toEqual([5, 10]);
    expect(rows.every((r) => r.student_id !== a.student.id)).toBe(true);
    expect(new Set(rows.map((r) => r.student_id)).size).toBe(1);
    const [done] = await sql`
      select j.status, r.status as request_status from app.data_deletion_jobs j
      join app.privacy_requests r on r.id = j.privacy_request_id where j.id = ${job[0]!.id}`;
    expect(done).toMatchObject({ status: 'COMPLETED', request_status: 'COMPLETED' });
    expect((await login(a)).status).toBe(401);
  });

  it('account deletion disables the household and the parent at once, then purges everything', async () => {
    const token = await childToken(b);
    const res = await api(
      'POST',
      '/account/delete-request',
      { parent: b.parent },
      {
        confirm: true,
        source: 'web',
      },
    );
    expect(res.status).toBe(202);
    const { deletion } = DeletionResponseSchema.parse(res.body);
    expect(deletion.scope).toBe('ACCOUNT');
    const again = await api(
      'POST',
      '/account/delete-request',
      { parent: b.parent },
      {
        confirm: true,
      },
    );
    expect(again.body.deletion.id).toBe(deletion.id);

    // The parent is signed out everywhere and the account is off: only the deletion status and
    // cancel routes answer. Signing in again stays possible so the request can be cancelled.
    expect(await sql`select 1 from auth.sessions where user_id = ${b.parent.userId}`).toHaveLength(
      0,
    );
    for (const [method, path, body] of [
      ['GET', '/household', undefined],
      ['GET', `/students/${b.student.id}`, undefined],
      ['POST', '/household', { name: 'Again' }],
      ['POST', '/privacy/export', undefined],
    ] as const) {
      const denied = await api(method, path, { parent: b.parent }, body);
      expect(denied.status, `${method} ${path}`).toBe(403);
      expect(denied.body).toMatchObject({
        code: 'ACCOUNT_DISABLED',
        details: { reason: 'DELETION_PENDING', deletionId: deletion.id },
      });
    }
    expect((await api('GET', '/auth/child/session', { child: token })).status).toBe(401);
    expect((await login(b)).body.code).toBe('ACCOUNT_DISABLED');
    const again2 = await signInWithPassword(b.email, b.password);
    const me = await api('GET', '/me', { parent: again2 });
    expect(me.status).toBe(200);
    expect(me.body.households).toEqual([]);
    expect(me.body.pendingAccountDeletion).toEqual({
      id: deletion.id,
      purgeAfter: deletion.purgeAfter,
    });

    await sql`update app.data_deletion_jobs set purge_after = now() - interval '1 minute' where id = ${deletion.id}`;
    await sql`select ops.purge_due_deletions()`;
    expect(await sql`select 1 from app.households where id = ${b.householdId}`).toHaveLength(0);
    expect(await sql`select 1 from auth.users where id = ${b.parent.userId}`).toHaveLength(0);
    const [request] = await sql`
      select r.status, r.source from app.privacy_requests r
      join app.data_deletion_jobs j on j.privacy_request_id = r.id where j.id = ${deletion.id}`;
    expect(request).toMatchObject({ status: 'COMPLETED', source: 'web' });
    // After the purge there is nothing left to cancel.
    expect((await api('POST', '/account/delete-request/cancel', { parent: b.parent })).status).toBe(
      404,
    );
  });
});

describe('cancelling a deletion during the 14-day grace period', () => {
  let a: Family;
  let b: Family;
  let noHousehold: AuthSession;

  beforeAll(async () => {
    a = await newFamily('Huỷ A');
    b = await newFamily('Huỷ B');
    await grant(a, 'CORE_SERVICE');
    await grant(b, 'CORE_SERVICE');
    noHousehold = await signUpWithEmail(`it-${randomUUID()}@vionx.test`, `pw-${randomUUID()}`);
    createdUsers.push(noHousehold.userId);
  });

  const requestChild = (f: Family, studentId = f.student.id) =>
    api('POST', `/students/${studentId}/delete-request`, { parent: f.parent }, { confirm: true });
  const cancelChild = (parent: AuthSession, studentId: string) =>
    api('POST', `/students/${studentId}/delete-request/cancel`, { parent });

  it('a child deletion is cancelled by the parent: login restored, job CANCELLED, audited, event emitted', async () => {
    const requested = DeletionResponseSchema.parse((await requestChild(a)).body).deletion;
    expect((await login(a)).body.code).toBe('ACCOUNT_DISABLED');

    // Another household (with or without a household of its own) cannot see or cancel it.
    for (const parent of [b.parent, noHousehold]) {
      const res = await cancelChild(parent, a.student.id);
      expect(res.status).toBe(404);
      expect(ErrorBodySchema.parse(res.body).code).toBe('NOT_FOUND');
    }

    const res = await cancelChild(a.parent, a.student.id);
    expect(res.status).toBe(200);
    const { deletion } = DeletionResponseSchema.parse(res.body);
    expect(deletion).toMatchObject({ id: requested.id, status: 'CANCELLED', completedAt: null });
    expect(deletion.cancelledAt).not.toBeNull();
    expect((await login(a)).status).toBe(200);
    const student = StudentSchema.parse(
      (await api('GET', `/students/${a.student.id}`, { parent: a.parent })).body,
    );
    expect(student).toMatchObject({ status: 'active', deletionScheduledFor: null });

    const [request] = await sql`
      select r.status from app.privacy_requests r
      join app.data_deletion_jobs j on j.privacy_request_id = r.id where j.id = ${deletion.id}`;
    expect(request).toMatchObject({ status: 'CANCELLED' });
    const audit = await sql`
      select details from ops.audit_logs
      where action = 'privacy.child_deletion_cancelled' and target_id = ${a.student.id}`;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ jobId: deletion.id, loginRestored: true });
    const events = await sql`
      select payload from ops.domain_events
      where type = 'privacy.deletion_cancelled' and aggregate_id = ${deletion.id}`;
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ scope: 'CHILD', studentId: a.student.id });

    // The purge skips the cancelled job even once its date has passed.
    await sql`update app.data_deletion_jobs set purge_after = now() - interval '1 minute' where id = ${deletion.id}`;
    await sql`select ops.purge_due_deletions()`;
    expect(await sql`select 1 from app.students where id = ${a.student.id}`).toHaveLength(1);
    const [job] = await sql`select status from app.data_deletion_jobs where id = ${deletion.id}`;
    expect(job).toMatchObject({ status: 'CANCELLED' });

    // Nothing pending any more; a new request starts a new grace period.
    expect((await cancelChild(a.parent, a.student.id)).status).toBe(404);
    const renewed = DeletionResponseSchema.parse((await requestChild(a)).body).deletion;
    expect(renewed.id).not.toBe(deletion.id);
    expect((await cancelChild(a.parent, a.student.id)).status).toBe(200);
  });

  it('a child the parent had disabled before the request stays disabled after the cancel', async () => {
    const disable = await api(
      'POST',
      `/students/${b.student.id}/disable`,
      { parent: b.parent },
      { disabled: true },
    );
    expect(disable.status).toBe(200);
    expect((await requestChild(b)).status).toBe(202);
    expect((await cancelChild(b.parent, b.student.id)).status).toBe(200);
    const student = StudentSchema.parse(
      (await api('GET', `/students/${b.student.id}`, { parent: b.parent })).body,
    );
    expect(student.status).toBe('disabled');
    await api(
      'POST',
      `/students/${b.student.id}/disable`,
      { parent: b.parent },
      { disabled: false },
    );
  });

  it('is refused once the purge is due (409) and after the purge has run (404)', async () => {
    const requested = DeletionResponseSchema.parse((await requestChild(b)).body).deletion;
    await sql`update app.data_deletion_jobs set purge_after = now() - interval '1 minute' where id = ${requested.id}`;
    const due = await cancelChild(b.parent, b.student.id);
    expect(due.status).toBe(409);
    expect(due.body).toMatchObject({ code: 'CONFLICT', details: { reason: 'GRACE_PERIOD_OVER' } });
    await sql`select ops.purge_due_deletions()`;
    expect((await cancelChild(b.parent, b.student.id)).status).toBe(404);
  });

  it('an account deletion is cancelled after signing in again: household, children and account work again', async () => {
    const f = await newFamily('Huỷ TK');
    await grant(f, 'CORE_SERVICE');
    // A second child the parent had disabled before: it stays disabled.
    const second = StudentCreateResponseSchema.parse(
      (
        await api(
          'POST',
          '/students',
          { parent: f.parent },
          { displayName: 'Con thứ hai', birthYear: 2016, grade: 4, pin: '4826' },
        )
      ).body,
    ).student;
    await api('POST', `/students/${second.id}/disable`, { parent: f.parent }, { disabled: true });

    const requested = DeletionResponseSchema.parse(
      (await api('POST', '/account/delete-request', { parent: f.parent }, { confirm: true })).body,
    ).deletion;
    expect((await login(f)).body.code).toBe('ACCOUNT_DISABLED');

    // Another parent has nothing to cancel; the other household's account is untouched.
    expect((await api('POST', '/account/delete-request/cancel', { parent: b.parent })).status).toBe(
      404,
    );

    const parent = await signInWithPassword(f.email, f.password);
    expect((await api('GET', '/household', { parent })).body.code).toBe('ACCOUNT_DISABLED');
    const overview = PrivacyOverviewResponseSchema.parse(
      (await api('GET', '/privacy/overview', { parent })).body,
    );
    expect(overview.deletions.find((d) => d.id === requested.id)).toMatchObject({
      scope: 'ACCOUNT',
      status: 'SCHEDULED',
    });

    const res = await api('POST', '/account/delete-request/cancel', { parent });
    expect(res.status).toBe(200);
    expect(DeletionResponseSchema.parse(res.body).deletion).toMatchObject({
      id: requested.id,
      scope: 'ACCOUNT',
      status: 'CANCELLED',
    });
    expect((await api('GET', '/household', { parent })).status).toBe(200);
    expect((await api('GET', '/me', { parent })).body.pendingAccountDeletion).toBeNull();
    expect((await login(f)).status).toBe(200);
    const secondNow = StudentSchema.parse(
      (await api('GET', `/students/${second.id}`, { parent })).body,
    );
    expect(secondNow.status).toBe('disabled');

    const audit = await sql`
      select details from ops.audit_logs
      where action = 'privacy.account_deletion_cancelled' and actor_id = ${f.parent.userId}`;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ jobId: requested.id, reenabledStudents: 1 });
    const events = await sql`
      select household_id from ops.domain_events
      where type = 'privacy.deletion_cancelled' and aggregate_id = ${requested.id}`;
    expect(events).toEqual([{ household_id: f.householdId }]);

    await sql`update app.data_deletion_jobs set purge_after = now() - interval '1 minute' where id = ${requested.id}`;
    await sql`select ops.purge_due_deletions()`;
    expect(await sql`select 1 from app.households where id = ${f.householdId}`).toHaveLength(1);
    expect(await sql`select 1 from auth.users where id = ${f.parent.userId}`).toHaveLength(1);
    expect((await api('POST', '/account/delete-request/cancel', { parent })).status).toBe(404);
  });
});

describe('audit logs and events after a purge: pseudonymous for 1 year, then deleted', () => {
  it('scrubs personal fields at purge time and deletes the rows 365 days later', async () => {
    const f = await newFamily('Lưu giữ');
    const other = await newFamily('Lưu giữ khác');
    await grant(f, 'CORE_SERVICE');
    // Rows a future module might write with personal fields in them.
    const [audit] = await sql<{ id: string }[]>`
      insert into ops.audit_logs (actor_type, actor_id, action, target_type, target_id, household_id, details)
      values ('parent', ${f.parent.userId}, 'it.test', 'student', ${f.student.id}, ${f.householdId},
              ${sql.json({ studentId: f.student.id, displayName: 'Bé Lưu', nested: { phone: '+84900000009', n: 1 } })})
      returning id`;
    const [event] = await sql<{ id: string }[]>`
      insert into ops.domain_events (type, household_id, aggregate_type, aggregate_id, payload)
      values ('it.retention_probe', ${f.householdId}, 'student', ${f.student.id},
              ${sql.json({ studentId: f.student.id, email: 'x@vionx.test', childLoginId: 'vx-abcdef' })})
      returning id`;
    await sql`insert into ops.processed_events (consumer, event_id) values ('it-retention', ${event!.id})`;
    const [untouched] = await sql<{ id: string }[]>`
      insert into ops.audit_logs (actor_type, action, target_type, target_id, household_id, details)
      values ('system', 'it.test', 'student', ${other.student.id}, ${other.householdId},
              ${sql.json({ displayName: 'Bé Khác' })})
      returning id`;
    await expect(
      sql`update ops.audit_logs set details = '{}' where id = ${audit!.id}`,
    ).rejects.toThrow(/append-only/);

    const deletion = DeletionResponseSchema.parse(
      (
        await api(
          'POST',
          `/students/${f.student.id}/delete-request`,
          { parent: f.parent },
          { confirm: true },
        )
      ).body,
    ).deletion;
    await sql`update app.data_deletion_jobs set purge_after = now() - interval '1 minute' where id = ${deletion.id}`;
    await sql`select ops.purge_due_deletions()`;

    const [a] =
      await sql`select details, target_id, purged_at from ops.audit_logs where id = ${audit!.id}`;
    expect(a!.details).toEqual({ studentId: f.student.id, nested: { n: 1 } });
    expect(a!.target_id).toBe(f.student.id);
    expect(a!.purged_at).not.toBeNull();
    const [e] = await sql`select payload, purged_at from ops.domain_events where id = ${event!.id}`;
    expect(e!.payload).toEqual({ studentId: f.student.id });
    expect(e!.purged_at).not.toBeNull();
    const requestAudit = await sql`
      select purged_at from ops.audit_logs
      where action = 'privacy.child_deletion_requested' and target_id = ${f.student.id}`;
    expect(requestAudit).toHaveLength(1);
    expect(requestAudit[0]!.purged_at).not.toBeNull();
    const [purgedAudit] = await sql`
      select purged_at from ops.audit_logs where action = 'privacy.purged' and target_id = ${f.student.id}`;
    expect(purgedAudit!.purged_at).not.toBeNull();
    const [kept] =
      await sql`select details, purged_at from ops.audit_logs where id = ${untouched!.id}`;
    expect(kept).toMatchObject({ details: { displayName: 'Bé Khác' }, purged_at: null });
    // Still append-only for everyone else after the scrub.
    await expect(sql`delete from ops.audit_logs where id = ${audit!.id}`).rejects.toThrow(
      /append-only/,
    );

    const cron =
      await sql`select active from cron.job where jobname = 'vionx-purged-log-retention'`;
    expect(cron[0]?.active).toBe(true);
    await sql`select ops.delete_expired_purged_logs(now() + interval '364 days')`;
    expect(await sql`select 1 from ops.audit_logs where id = ${audit!.id}`).toHaveLength(1);
    await sql`select ops.delete_expired_purged_logs(now() + interval '366 days')`;
    expect(await sql`select 1 from ops.audit_logs where id = ${audit!.id}`).toHaveLength(0);
    expect(await sql`select 1 from ops.domain_events where id = ${event!.id}`).toHaveLength(0);
    expect(
      await sql`select 1 from ops.processed_events where event_id = ${event!.id}`,
    ).toHaveLength(0);
    expect(await sql`select 1 from ops.audit_logs where target_id = ${f.student.id}`).toHaveLength(
      0,
    );
    expect(await sql`select 1 from ops.audit_logs where id = ${untouched!.id}`).toHaveLength(1);
  });

  it('an account purge marks every row of the household and of the deleted parent', async () => {
    const f = await newFamily('Lưu giữ TK');
    const deletion = DeletionResponseSchema.parse(
      (await api('POST', '/account/delete-request', { parent: f.parent }, { confirm: true })).body,
    ).deletion;
    await sql`update app.data_deletion_jobs set purge_after = now() - interval '1 minute' where id = ${deletion.id}`;
    await sql`select ops.purge_due_deletions()`;
    const audits = await sql<{ purged: boolean }[]>`
      select purged_at is not null as purged from ops.audit_logs
      where household_id = ${f.householdId} or actor_id = ${f.parent.userId}`;
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.every((r) => r.purged)).toBe(true);
    const events = await sql<{ purged: boolean }[]>`
      select purged_at is not null as purged from ops.domain_events where household_id = ${f.householdId}`;
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((r) => r.purged)).toBe(true);
  });
});

describe('cross-household isolation (404)', () => {
  let a: Family;
  let b: Family;
  let noHousehold: AuthSession;
  let bToken: string;

  beforeAll(async () => {
    a = await newFamily('Cách ly A');
    b = await newFamily('Cách ly B');
    await grant(a, 'CORE_SERVICE');
    await grant(b, 'CORE_SERVICE');
    bToken = await childToken(b);
    noHousehold = await signUpWithEmail(`it-${randomUUID()}@vionx.test`, `pw-${randomUUID()}`);
    createdUsers.push(noHousehold.userId);
  });

  it.each([
    ['GET', '/consents', undefined],
    ['POST', '/consents/CORE_SERVICE/grant', { policyVersion: 1 }],
    ['POST', '/consents/CORE_SERVICE/revoke', undefined],
    ['POST', '/delete-request', { confirm: true }],
    ['POST', '/delete-request/cancel', undefined],
  ])(
    "%s /students/:id%s on another household's child returns 404",
    async (method, suffix, body) => {
      for (const parent of [b.parent, noHousehold]) {
        const res = await api(method, `/students/${a.student.id}${suffix}`, { parent }, body);
        expect(res.status).toBe(404);
        expect(ErrorBodySchema.parse(res.body).code).toBe('NOT_FOUND');
      }
    },
  );

  it('a child cannot read or answer for another child', async () => {
    expect((await api('GET', `/students/${a.student.id}/consents`, { child: bToken })).status).toBe(
      404,
    );
    const assent = await api(
      'POST',
      `/students/${a.student.id}/consents/AI_PERSONALIZATION/child-assent`,
      { child: bToken },
      { decision: 'GIVEN' },
    );
    expect(assent.status).toBe(404);
  });

  it("leaves the other household's child untouched", async () => {
    const state = StudentConsentsResponseSchema.parse(
      (await api('GET', `/students/${a.student.id}/consents`, { parent: a.parent })).body,
    );
    expect(state.consents.find((c) => c.type === 'CORE_SERVICE')!.effective).toBe(true);
    expect(state.history).toHaveLength(1);
    expect((await login(a)).status).toBe(200);
    const audits = await sql`
      select 1 from ops.audit_logs where target_id = ${a.student.id} and actor_id <> ${a.parent.userId}`;
    expect(audits).toHaveLength(0);
  });

  it('a parent without a household has no export', async () => {
    expect((await api('POST', '/privacy/export', { parent: noHousehold })).status).toBe(404);
    expect((await api('GET', `/privacy/export/${randomUUID()}`, { parent: a.parent })).status).toBe(
      404,
    );
  });

  it('child tokens cannot use parent privacy routes', async () => {
    expect((await api('POST', '/privacy/export', { child: bToken })).status).toBe(403);
    expect(
      (
        await api('POST', `/students/${b.student.id}/consents/CORE_SERVICE/revoke`, {
          child: bToken,
        })
      ).status,
    ).toBe(403);
  });
});

describe('privacy tables are not reachable by client roles', () => {
  it('anon/authenticated have no privileges; the export bucket is private', async () => {
    for (const table of [
      'app.policy_versions',
      'app.policy_acceptances',
      'app.consent_records',
      'app.privacy_requests',
      'app.data_export_jobs',
      'app.data_deletion_jobs',
      'ops.consent_job_queues',
      'ops.ledger_registry',
    ]) {
      const rows = await sql<{ allowed: boolean }[]>`
        select bool_or(has_table_privilege(r, ${table}, 'select,insert,update,delete')) as allowed
        from unnest(array['anon', 'authenticated']) as r`;
      expect(rows[0]!.allowed, table).toBe(false);
    }
    const [bucket] = await sql`select public from storage.buckets where id = 'privacy-exports'`;
    expect(bucket!.public).toBe(false);
    const policies = await sql`
      select 1 from pg_policies where schemaname = 'storage' and qual like '%privacy-exports%'`;
    expect(policies).toHaveLength(0);
  });
});

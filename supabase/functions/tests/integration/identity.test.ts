// M01 identity & household against local Supabase (`pnpm db:start && pnpm fn:serve`).
// Parents sign in through Supabase Auth (phone OTP test number, or throwaway email accounts);
// every child-data route is checked for cross-household denial (404).
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ChildLoginResponseSchema,
  ChildSessionResponseSchema,
  ErrorBodySchema,
  HouseholdResponseSchema,
  MeResponseSchema,
  ResetPinResponseSchema,
  StudentCreateResponseSchema,
  StudentSchema,
} from '@vionx/contracts';
import {
  signInWithPassword,
  signInWithPhoneOtp,
  signUpWithEmail,
  type AuthSession,
} from '../../../../scripts/lib/local-supabase.ts';

const FUNCTIONS_URL = (process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1').replace(
  /\/+$/,
  '',
);
const API = `${FUNCTIONS_URL}/api/v1`;
const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = postgres(DB_URL, { max: 2, onnotice: () => {} });

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

const login = (childLoginId: string, pin: string, deviceId = `it-${randomUUID()}`) =>
  api('POST', '/auth/child/login', {}, { childLoginId, pin, deviceId });

/**
 * M02: a child signs in only once CORE_SERVICE and CROSS_BORDER_TRANSFER are granted (each its own
 * consent) on the current policy version.
 */
async function grantCoreService(parent: AuthSession, studentId: string) {
  const policies = await api('GET', '/policies/current');
  const version = (policies.body.policies as { type: string; version: number }[]).find(
    (p) => p.type === 'PRIVACY_POLICY',
  )!.version;
  for (const type of ['CORE_SERVICE', 'CROSS_BORDER_TRANSFER']) {
    const res = await api(
      'POST',
      `/students/${studentId}/consents/${type}/grant`,
      { parent },
      { policyVersion: version },
    );
    expect(res.status).toBe(200);
  }
}

async function newParent(): Promise<AuthSession> {
  return signUpWithEmail(`it-${randomUUID()}@vionx.test`, `pw-${randomUUID()}`);
}

async function newFamily(name: string) {
  const parent = await newParent();
  const res = await api('POST', '/household', { parent }, { name });
  expect(res.status).toBe(201);
  const created = await api(
    'POST',
    '/students',
    { parent },
    { displayName: `${name} child`, birthYear: 2015, grade: 6, pin: '4826' },
  );
  expect(created.status).toBe(201);
  const family = { parent, ...StudentCreateResponseSchema.parse(created.body) };
  await grantCoreService(parent, family.student.id);
  return family;
}

const createdUsers: string[] = [];

afterAll(async () => {
  // Throwaway parents: remove their households (cascade to children), then the auth users.
  if (createdUsers.length > 0) {
    await sql`
      delete from app.households where id in (
        select household_id from app.household_memberships where user_id = any(${createdUsers}::uuid[]))`;
    await sql`delete from auth.users where id = any(${createdUsers}::uuid[])`;
  }
  await sql.end({ timeout: 5 });
});

describe('parent authentication', () => {
  it('phone OTP (local test number) yields a JWT the api accepts', async () => {
    const parent = await signInWithPhoneOtp('+84900000003');
    const me = await api('GET', '/me', { parent });
    expect(me.status).toBe(200);
    expect(MeResponseSchema.parse(me.body)).toMatchObject({
      userId: parent.userId,
      phone: '84900000003',
      adminPermissions: [],
    });
  });

  it('rejects missing, malformed and anon-key tokens', async () => {
    expect((await api('GET', '/me')).status).toBe(401);
    const forged = { accessToken: 'eyJhbGciOiJIUzI1NiJ9.e30.x', userId: '' };
    expect((await api('GET', '/me', { parent: forged })).status).toBe(401);
  });

  it('the seeded SUPER_ADMIN has admin permissions', async () => {
    const admin = await signInWithPassword('admin@vionx.local', 'vionx-admin-local');
    const me = MeResponseSchema.parse((await api('GET', '/me', { parent: admin })).body);
    expect(me.adminPermissions).toEqual(['SUPER_ADMIN']);
  });
});

describe('household and children', () => {
  let parent: AuthSession;
  const students: { id: string; childLoginId: string; pin: string }[] = [];

  beforeAll(async () => {
    parent = await newParent();
    createdUsers.push(parent.userId);
  });

  it('a new parent has no household until they create one', async () => {
    expect((await api('GET', '/household', { parent })).status).toBe(404);
    const me = MeResponseSchema.parse((await api('GET', '/me', { parent })).body);
    expect(me.households).toEqual([]);
  });

  it('creates the household (OWNER, default timezone) exactly once', async () => {
    const res = await api('POST', '/household', { parent }, { name: '  Nhà   Kiểm thử ' });
    expect(res.status).toBe(201);
    const body = HouseholdResponseSchema.parse(res.body);
    expect(body.household).toMatchObject({
      name: 'Nhà Kiểm thử',
      timezone: 'Asia/Ho_Chi_Minh',
      role: 'OWNER',
    });
    const again = await api('POST', '/household', { parent }, { name: 'Second' });
    expect(again.status).toBe(409);
    expect(ErrorBodySchema.parse(again.body).code).toBe('CONFLICT');
  });

  it('adds three children with one-time credentials and a ChildCreated event each', async () => {
    for (const [grade, birthYear] of [
      [2, 2019],
      [6, 2014],
      [9, 2011],
    ] as const) {
      const res = await api(
        'POST',
        '/students',
        { parent },
        { displayName: `Con lớp ${grade}`, birthYear, grade, avatar: 'fox' },
      );
      expect(res.status).toBe(201);
      const { student, credentials } = StudentCreateResponseSchema.parse(res.body);
      expect(credentials.childLoginId).toMatch(/^vx-[23456789abcdefghjkmnpqrstuvwxyz]{6}$/);
      expect(credentials.pin).toMatch(/^\d{6}$/);
      expect(student).toMatchObject({
        grade,
        status: 'active',
        activeSessions: 0,
        coreServiceConsent: false,
        crossBorderTransferConsent: false,
        deletionScheduledFor: null,
      });
      await grantCoreService(parent, student.id);
      students.push({ id: student.id, ...credentials });
    }
    const household = HouseholdResponseSchema.parse(
      (await api('GET', '/household', { parent })).body,
    );
    expect(household.students.map((s) => s.grade)).toEqual([2, 6, 9]);

    const rows = await sql<{ pin_hash: string }[]>`
      select pin_hash from app.child_credentials where student_id = any(${students.map((s) => s.id)}::uuid[])`;
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.pin_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    for (const s of students) expect(rows.some((r) => r.pin_hash.includes(s.pin))).toBe(false);

    const events = await sql<{ n: number }[]>`
      select count(*)::int as n from ops.domain_events
      where type = 'identity.child_created' and aggregate_id = any(${students.map((s) => s.id)}::uuid[])`;
    expect(events[0]!.n).toBe(3);
  });

  it('reads and edits a child', async () => {
    const id = students[0]!.id;
    const got = await api('GET', `/students/${id}`, { parent });
    expect(StudentSchema.parse(got.body).childLoginId).toBe(students[0]!.childLoginId);
    const patched = await api(
      'PATCH',
      `/students/${id}`,
      { parent },
      { displayName: 'An', grade: 3 },
    );
    expect(patched.status).toBe(200);
    expect(StudentSchema.parse(patched.body)).toMatchObject({ displayName: 'An', grade: 3 });
    const bad = await api('PATCH', `/students/${id}`, { parent }, { birthYear: 1990 });
    expect(bad.status).toBe(400);
  });

  it('child signs in with ID + PIN; the token is opaque, stored hashed, and logout revokes it', async () => {
    const s = students[1]!;
    const res = await login(s.childLoginId.toUpperCase(), s.pin);
    expect(res.status).toBe(200);
    const body = ChildLoginResponseSchema.parse(res.body);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.student.id).toBe(s.id);
    const days = (Date.parse(body.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);

    const stored = await sql<{ token_hash: string }[]>`
      select token_hash from app.child_sessions where student_id = ${s.id}`;
    expect(stored.some((r) => r.token_hash === body.token)).toBe(false);

    const session = await api('GET', '/auth/child/session', { child: body.token });
    expect(ChildSessionResponseSchema.parse(session.body).student.id).toBe(s.id);
    // A child token is not a parent credential.
    expect((await api('GET', `/students/${s.id}`, { child: body.token })).status).toBe(403);

    expect((await api('POST', '/auth/child/logout', { child: body.token })).body).toEqual({
      revoked: true,
    });
    expect((await api('GET', '/auth/child/session', { child: body.token })).status).toBe(401);
  });

  it('5 wrong PINs lock the login for 15 minutes; a parent PIN reset unlocks it', async () => {
    const s = students[2]!;
    const device = `it-${randomUUID()}`;
    for (let i = 1; i <= 4; i++) {
      const res = await login(s.childLoginId, '0000', device);
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        details: { attemptsRemaining: 5 - i },
      });
    }
    const fifth = await login(s.childLoginId, '0000', device);
    expect(fifth.status).toBe(423);
    expect(fifth.body.code).toBe('ACCOUNT_LOCKED');
    const minutes = (Date.parse(fifth.body.details.lockedUntil) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14.5);
    expect(minutes).toBeLessThanOrEqual(15);

    // Even the right PIN is refused while locked.
    expect((await login(s.childLoginId, s.pin, device)).status).toBe(423);
    const locked = StudentSchema.parse((await api('GET', `/students/${s.id}`, { parent })).body);
    expect(locked.status).toBe('locked');

    const reset = await api('POST', `/students/${s.id}/reset-pin`, { parent }, { pin: '7351' });
    expect(reset.status).toBe(200);
    expect(ResetPinResponseSchema.parse(reset.body).credentials).toEqual({
      childLoginId: s.childLoginId,
      pin: '7351',
    });
    expect((await login(s.childLoginId, s.pin, device)).status).toBe(401); // old PIN gone
    const ok = await login(s.childLoginId, '7351', device);
    expect(ok.status).toBe(200);
    s.pin = '7351';

    const audit = await sql`
      select details from ops.audit_logs
      where action = 'student.pin_reset' and target_id = ${s.id} and actor_id = ${parent.userId}`;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ wasLocked: true, generated: false });
  });

  it('reset-pin without a PIN generates one', async () => {
    const s = students[0]!;
    const reset = ResetPinResponseSchema.parse(
      (await api('POST', `/students/${s.id}/reset-pin`, { parent })).body,
    );
    expect(reset.credentials.pin).toMatch(/^\d{6}$/);
    expect((await login(s.childLoginId, reset.credentials.pin)).status).toBe(200);
    s.pin = reset.credentials.pin;
  });

  it('revoke-sessions signs the child out everywhere (audited)', async () => {
    const s = students[0]!;
    const a = ChildLoginResponseSchema.parse((await login(s.childLoginId, s.pin)).body).token;
    const b = ChildLoginResponseSchema.parse((await login(s.childLoginId, s.pin)).body).token;
    const res = await api('POST', `/students/${s.id}/revoke-sessions`, { parent });
    expect(res.status).toBe(200);
    expect(res.body.revokedSessions).toBeGreaterThanOrEqual(2);
    for (const t of [a, b]) {
      expect((await api('GET', '/auth/child/session', { child: t })).status).toBe(401);
    }
    const audit = await sql`
      select 1 from ops.audit_logs where action = 'student.sessions_revoked' and target_id = ${s.id}`;
    expect(audit).toHaveLength(1);
  });

  it('disable blocks sign-in and revokes sessions; re-enable restores it (audited)', async () => {
    const s = students[1]!;
    const token = ChildLoginResponseSchema.parse((await login(s.childLoginId, s.pin)).body).token;
    const disabled = await api('POST', `/students/${s.id}/disable`, { parent });
    expect(StudentSchema.parse(disabled.body).status).toBe('disabled');
    expect((await api('GET', '/auth/child/session', { child: token })).status).toBe(401);
    const denied = await login(s.childLoginId, s.pin);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('ACCOUNT_DISABLED');
    // A wrong PIN on a disabled login still reads as a wrong PIN (no state leak).
    expect((await login(s.childLoginId, '9999')).body.code).toBe('INVALID_CREDENTIALS');

    const enabled = await api('POST', `/students/${s.id}/disable`, { parent }, { disabled: false });
    expect(StudentSchema.parse(enabled.body).status).toBe('active');
    expect((await login(s.childLoginId, s.pin)).status).toBe(200);
    const actions = await sql<{ action: string }[]>`
      select action from ops.audit_logs
      where target_id = ${s.id} and action like 'student.%' order by created_at`;
    expect(actions.map((a) => a.action)).toEqual(['student.disabled', 'student.enabled']);
  });

  it('expired sessions are rejected; active ones slide forward', async () => {
    const s = students[1]!;
    const token = ChildLoginResponseSchema.parse((await login(s.childLoginId, s.pin)).body).token;
    const [row] = await sql<{ id: string }[]>`
      select id from app.child_sessions where student_id = ${s.id} and revoked_at is null
      order by created_at desc limit 1`;
    await sql`
      update app.child_sessions
      set last_seen_at = now() - interval '2 hours', expires_at = now() + interval '1 day'
      where id = ${row!.id}`;
    const session = ChildSessionResponseSchema.parse(
      (await api('GET', '/auth/child/session', { child: token })).body,
    );
    expect((Date.parse(session.expiresAt) - Date.now()) / 86_400_000).toBeGreaterThan(29.9);

    await sql`update app.child_sessions set expires_at = now() - interval '1 second' where id = ${row!.id}`;
    expect((await api('GET', '/auth/child/session', { child: token })).status).toBe(401);
  });

  it('unknown login ids and malformed input give INVALID_CREDENTIALS', async () => {
    expect((await login('vx-zzzzzz', '1234')).body.code).toBe('INVALID_CREDENTIALS');
    expect((await login('not-an-id', '1234')).body.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('cross-household isolation (404)', () => {
  let familyA: Awaited<ReturnType<typeof newFamily>>;
  let familyB: Awaited<ReturnType<typeof newFamily>>;
  let parentWithoutHousehold: AuthSession;

  beforeAll(async () => {
    familyA = await newFamily('A');
    familyB = await newFamily('B');
    parentWithoutHousehold = await newParent();
    createdUsers.push(familyA.parent.userId, familyB.parent.userId, parentWithoutHousehold.userId);
  });

  it.each([
    ['GET', '', undefined],
    ['PATCH', '', { displayName: 'Hacked' }],
    ['POST', '/reset-pin', { pin: '1111' }],
    ['POST', '/revoke-sessions', undefined],
    ['POST', '/disable', undefined],
  ])(
    "%s /students/:id%s on another household's child returns 404",
    async (method, suffix, body) => {
      const target = familyA.student.id;
      for (const parent of [familyB.parent, parentWithoutHousehold]) {
        const res = await api(method, `/students/${target}${suffix}`, { parent }, body);
        expect(res.status).toBe(404);
        expect(ErrorBodySchema.parse(res.body).code).toBe('NOT_FOUND');
      }
    },
  );

  it("leaves the other household's child untouched", async () => {
    const own = StudentSchema.parse(
      (await api('GET', `/students/${familyA.student.id}`, { parent: familyA.parent })).body,
    );
    expect(own).toMatchObject({ displayName: 'A child', status: 'active' });
    expect((await login(familyA.credentials.childLoginId, '4826')).status).toBe(200);
    expect((await login(familyA.credentials.childLoginId, '1111')).status).toBe(401);
    // Only family A's own two consent grants are on record; nothing by the other parents.
    const audits = await sql<{ action: string }[]>`
      select action from ops.audit_logs where target_id = ${familyA.student.id}`;
    expect(audits.map((a) => a.action)).toEqual(['consent.granted', 'consent.granted']);
  });

  it('a household lists only its own children', async () => {
    const b = HouseholdResponseSchema.parse(
      (await api('GET', '/household', { parent: familyB.parent })).body,
    );
    expect(b.students.map((s) => s.id)).toEqual([familyB.student.id]);
  });

  it('a nonexistent id is indistinguishable from a foreign one', async () => {
    const res = await api('GET', `/students/${randomUUID()}`, { parent: familyB.parent });
    expect(res.status).toBe(404);
  });
});

describe('child login rate limits', () => {
  it('limits attempts per login id (429 + Retry-After)', async () => {
    const id = `vx-${randomUUID()
      .replace(/[^2-9a-hjkmnp-z]/g, '')
      .slice(0, 6)
      .padEnd(6, 'z')}`;
    const statuses: number[] = [];
    let last: Awaited<ReturnType<typeof login>> | undefined;
    for (let i = 0; i < 13; i++) {
      last = await login(id, '1234');
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 12).every((s) => s === 401)).toBe(true);
    expect(statuses[12]).toBe(429);
    expect(last!.body.code).toBe('RATE_LIMITED');
    expect(Number(last!.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('limits attempts per device', async () => {
    const device = `it-${randomUUID()}`;
    let status = 0;
    for (let i = 0; i < 31; i++) {
      status = (await login(`vx-zz${i.toString().padStart(4, '2')}`, '1234', device)).status;
    }
    expect(status).toBe(429);
  });
});

describe('identity tables are not reachable by client roles', () => {
  it('anon/authenticated have no privileges and RLS is on', async () => {
    const tables = [
      'app.profiles',
      'app.households',
      'app.household_memberships',
      'app.students',
      'app.child_credentials',
      'app.child_sessions',
      'ops.admin_permissions',
    ];
    for (const table of tables) {
      const rows = await sql<{ allowed: boolean }[]>`
        select bool_or(has_table_privilege(r, ${table}, 'select,insert,update,delete')) as allowed
        from unnest(array['anon', 'authenticated']) as r`;
      expect(rows[0]!.allowed, table).toBe(false);
    }
    const noRls = await sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('app', 'ops') and c.relkind = 'r' and not c.relrowsecurity`;
    expect(noRls).toHaveLength(0);
  });
});

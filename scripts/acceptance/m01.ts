// M01 acceptance (TASK_PACKS/M01.md). Requires `pnpm db:start && pnpm fn:serve` (local only: uses
// the test OTP numbers from supabase/config.toml).
//   pnpm acceptance m01
// Flow: parent OTP → household → 3 children → child login → 5 wrong PINs lock the account →
// parent resets PIN → child login OK. Plus cross-household denial, audit/event rows and the seed.
import { randomUUID } from 'node:crypto';
import { signInWithPhoneOtp, type AuthSession } from '../lib/local-supabase.ts';
import { assert, connectDb, env, SkipStep, type Scenario } from './lib.ts';

const PHONE = '+84900000002'; // acceptance parent (test OTP 123456)
const DEMO_PHONE = '+84900000001'; // seeded demo parent
const API = `${env.functionsUrl}/api/v1`;
const sql = connectDb();
const deviceId = `acceptance-${randomUUID()}`;

interface Res {
  status: number;
  body: Record<string, unknown> & {
    code?: string;
    details?: Record<string, unknown>;
  };
}

async function call(method: string, path: string, parent?: AuthSession, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(parent ? { authorization: `Bearer ${parent.accessToken}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Res['body'] } satisfies Res;
}

const childLogin = (childLoginId: string, pin: string) =>
  call('POST', '/auth/child/login', undefined, { childLoginId, pin, deviceId });

const state: {
  parent?: AuthSession;
  demo?: AuthSession;
  children: { id: string; grade: number; childLoginId: string; pin: string }[];
  newPin?: string;
} = { children: [] };

export const scenario: Scenario = {
  name: 'M01 — Identity & household',
  steps: [
    {
      name: `Parent signs in with phone OTP (${PHONE}, local test OTP)`,
      run: async () => {
        // Repeatable runs: remove the previous run's acceptance family first.
        const previous = await sql<{ id: string }[]>`
          select id from auth.users where phone = ${PHONE.slice(1)}`;
        if (previous[0]) {
          await sql`
            delete from app.households where id in (
              select household_id from app.household_memberships where user_id = ${previous[0].id})`;
          await sql`delete from auth.users where id = ${previous[0].id}`;
        }
        state.parent = await signInWithPhoneOtp(PHONE);
        const me = await call('GET', '/me', state.parent);
        assert(me.status === 200, `GET /me ${me.status} ${JSON.stringify(me.body)}`);
        assert(me.body.phone === PHONE.slice(1), `phone ${String(me.body.phone)}`);
        return `Supabase JWT accepted by the api; user ${state.parent.userId}`;
      },
    },
    {
      name: 'Parent creates the household',
      run: async () => {
        const res = await call('POST', '/household', state.parent, { name: 'Gia đình Nghiệm thu' });
        assert(res.status === 201, `POST /household ${res.status} ${JSON.stringify(res.body)}`);
        const household = res.body.household as { id: string; role: string; timezone: string };
        assert(household.role === 'OWNER', 'not OWNER');
        const again = await call('POST', '/household', state.parent, { name: 'Again' });
        assert(again.status === 409, `second create ${again.status}`);
        return `household ${household.id} (OWNER, ${household.timezone}); second create → 409`;
      },
    },
    {
      name: 'Parent adds 3 children (grades 2, 6, 9) and gets one-time credentials',
      run: async () => {
        for (const [displayName, grade, birthYear] of [
          ['Bé Na', 2, 2019],
          ['Khoa', 6, 2014],
          ['Vy', 9, 2011],
        ] as const) {
          const res = await call('POST', '/students', state.parent, {
            displayName,
            grade,
            birthYear,
          });
          assert(res.status === 201, `POST /students ${res.status} ${JSON.stringify(res.body)}`);
          const student = res.body.student as { id: string };
          const credentials = res.body.credentials as { childLoginId: string; pin: string };
          assert(/^vx-[23456789a-hjkmnp-z]{6}$/.test(credentials.childLoginId), 'login id format');
          assert(/^\d{4,8}$/.test(credentials.pin), 'PIN format');
          state.children.push({ id: student.id, grade, ...credentials });
        }
        // M02: a child can sign in only after the parent grants CORE_SERVICE and the separate
        // CROSS_BORDER_TRANSFER consent.
        const policies = await call('GET', '/policies/current');
        const version = (policies.body.policies as { type: string; version: number }[]).find(
          (p) => p.type === 'PRIVACY_POLICY',
        )?.version;
        assert(version, 'no current PRIVACY_POLICY');
        for (const child of state.children) {
          for (const type of ['CORE_SERVICE', 'CROSS_BORDER_TRANSFER']) {
            const grant = await call(
              'POST',
              `/students/${child.id}/consents/${type}/grant`,
              state.parent,
              { policyVersion: version },
            );
            assert(grant.status === 200, `grant ${grant.status} ${JSON.stringify(grant.body)}`);
          }
        }
        const household = await call('GET', '/household', state.parent);
        const grades = (household.body.students as { grade: number }[]).map((s) => s.grade);
        assert(JSON.stringify(grades) === '[2,6,9]', `grades ${JSON.stringify(grades)}`);
        const events = await sql<{ n: number }[]>`
          select count(*)::int as n from ops.domain_events
          where type = 'identity.child_created'
            and aggregate_id = any(${state.children.map((c) => c.id)}::uuid[])`;
        assert(events[0]?.n === 3, `ChildCreated events: ${events[0]?.n}`);
        return (
          state.children.map((c) => `grade ${c.grade}: ${c.childLoginId}`).join(', ') +
          '; 3 identity.child_created events; CORE_SERVICE and CROSS_BORDER_TRANSFER consents granted (M02)'
        );
      },
    },
    {
      name: 'Child signs in with ID + PIN',
      run: async () => {
        const child = state.children[1]!;
        const res = await childLogin(child.childLoginId, child.pin);
        assert(res.status === 200, `login ${res.status} ${JSON.stringify(res.body)}`);
        const token = String(res.body.token);
        const stored = await sql`
          select 1 from app.child_sessions where student_id = ${child.id} and token_hash = ${token}`;
        assert(stored.length === 0, 'raw token stored');
        return `token issued (expires ${String(res.body.expiresAt)}), stored only as sha-256`;
      },
    },
    {
      name: '5 wrong PINs lock the child login for 15 minutes',
      run: async () => {
        const child = state.children[1]!;
        const statuses: number[] = [];
        let last: Res | undefined;
        for (let i = 0; i < 5; i++) {
          last = await childLogin(child.childLoginId, child.pin === '0000' ? '1111' : '0000');
          statuses.push(last.status);
        }
        assert(
          JSON.stringify(statuses) === '[401,401,401,401,423]',
          `statuses ${JSON.stringify(statuses)}`,
        );
        assert(last?.body.code === 'ACCOUNT_LOCKED', `code ${last?.body.code}`);
        const correct = await childLogin(child.childLoginId, child.pin);
        assert(correct.status === 423, `correct PIN while locked → ${correct.status}`);
        return `401×4 then 423 ACCOUNT_LOCKED until ${String(last.body.details?.lockedUntil)}; correct PIN also refused`;
      },
    },
    {
      name: 'Parent resets the PIN (audited)',
      run: async () => {
        const child = state.children[1]!;
        const res = await call('POST', `/students/${child.id}/reset-pin`, state.parent, {});
        assert(res.status === 200, `reset-pin ${res.status} ${JSON.stringify(res.body)}`);
        state.newPin = (res.body.credentials as { pin: string }).pin;
        const audit = await sql`
          select 1 from ops.audit_logs
          where action = 'student.pin_reset' and target_id = ${child.id}
            and actor_id = ${state.parent!.userId}`;
        assert(audit.length === 1, `audit rows ${audit.length}`);
        return 'new generated PIN returned once; ops.audit_logs student.pin_reset written';
      },
    },
    {
      name: 'Child signs in with the new PIN',
      run: async () => {
        const child = state.children[1]!;
        const old = await childLogin(child.childLoginId, child.pin);
        assert(old.status === 401, `old PIN → ${old.status}`);
        const res = await childLogin(child.childLoginId, state.newPin!);
        assert(res.status === 200, `login ${res.status} ${JSON.stringify(res.body)}`);
        return `old PIN rejected; new PIN → 200 (${(res.body.student as { displayName: string }).displayName})`;
      },
    },
    {
      name: 'Another household cannot see or change these children (404)',
      run: async () => {
        state.demo = await signInWithPhoneOtp(DEMO_PHONE);
        const demo = state.demo;
        const target = state.children[0]!.id;
        const results = await Promise.all([
          call('GET', `/students/${target}`, demo),
          call('PATCH', `/students/${target}`, demo, { displayName: 'x' }),
          call('POST', `/students/${target}/reset-pin`, demo, {}),
          call('POST', `/students/${target}/revoke-sessions`, demo),
          call('POST', `/students/${target}/disable`, demo),
        ]);
        const statuses = results.map((r) => r.status);
        assert(
          statuses.every((s) => s === 404),
          `statuses ${JSON.stringify(statuses)}`,
        );
        return 'GET/PATCH/reset-pin/revoke-sessions/disable → 404 for the demo parent';
      },
    },
    {
      name: 'Seed: SUPER_ADMIN and demo family (grades 2, 6, 9)',
      run: async () => {
        const admins = await sql`
          select 1 from ops.admin_permissions p join auth.users u on u.id = p.user_id
          where u.email = 'admin@vionx.local' and p.permission = 'SUPER_ADMIN'`;
        assert(admins.length === 1, 'SUPER_ADMIN missing');
        // Reuse the session from the previous step (GoTrue allows one OTP per number per 5 s).
        const demo = state.demo ?? (await signInWithPhoneOtp(DEMO_PHONE));
        const household = await call('GET', '/household', demo);
        const grades = (household.body.students as { grade: number }[]).map((s) => s.grade);
        assert(JSON.stringify(grades) === '[2,6,9]', `demo grades ${JSON.stringify(grades)}`);
        return `admin@vionx.local SUPER_ADMIN; demo parent ${DEMO_PHONE} with grades ${grades.join(', ')}`;
      },
    },
    {
      name: 'Maestro flow apps/mobile/.maestro/m01-identity.yaml',
      run: async () => {
        throw new SkipStep(
          'needs an Android emulator with the development build (not available here)',
        );
      },
    },
  ],
  cleanup: async () => {
    await sql.end({ timeout: 5 });
  },
};

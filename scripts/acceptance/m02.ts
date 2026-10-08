// M02 acceptance (TASK_PACKS/M02.md). Requires `pnpm db:start && pnpm fn:serve` (local only: signs
// up throwaway email parents and simulates the 30-day clock in the database).
//   pnpm acceptance m02
// Flow: policies accepted → no child login before CORE_SERVICE consent → grant → login → AI consent
// with child assent → revoke → CONSENT_REQUIRED and queued AI jobs dropped → export contains only the
// own household → delete request blocks login at once → pg_cron purge after 30 days anonymises
// ledgers. Plus the public deletion page and the legal drafts.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { signUpWithEmail, type AuthSession } from '../lib/local-supabase.ts';
import { assert, connectDb, env, SkipStep, type Scenario } from './lib.ts';

const API = `${env.functionsUrl}/api/v1`;
const root = resolve(import.meta.dirname, '../..');
const sql = connectDb();
const deviceId = `acceptance-${randomUUID()}`;
const LEDGER = 'ops.acceptance_m02_ledger';

interface Res {
  status: number;
  body: Record<string, unknown> & { code?: string; details?: Record<string, unknown> };
}

async function call(
  method: string,
  path: string,
  auth?: { parent?: AuthSession; child?: string },
  body?: unknown,
): Promise<Res> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth?.parent ? { authorization: `Bearer ${auth.parent.accessToken}` } : {}),
      ...(auth?.child ? { 'x-vionx-child-session': auth.child } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Res['body'] };
}

async function tickWorker(): Promise<void> {
  const res = await fetch(`${env.functionsUrl}/worker`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vionx-service-secret': env.serviceSecret },
    body: '{}',
  });
  assert(res.ok, `worker responded ${res.status}`);
}

/** Minimal zip reader (central directory + deflate/store) so the script needs no extra package. */
function unzip(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  assert(eocd >= 0, 'not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    files.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

interface Family {
  email: string;
  parent: AuthSession;
  householdId: string;
  child: { id: string; childLoginId: string; pin: string };
}

const state: {
  a?: Family;
  b?: Family;
  policyVersion?: number;
  childToken?: string;
} = {};
const users: string[] = [];

async function newFamily(label: string): Promise<Family> {
  const email = `acceptance-m02-${label}-${randomUUID()}@vionx.test`;
  const parent = await signUpWithEmail(email, `pw-${randomUUID()}`);
  users.push(parent.userId);
  const household = await call('POST', '/household', { parent }, { name: `Gia đình ${label}` });
  assert(household.status === 201, `POST /household ${household.status}`);
  const student = await call(
    'POST',
    '/students',
    { parent },
    { displayName: `Con ${label}`, grade: 6, birthYear: 2014 },
  );
  assert(
    student.status === 201,
    `POST /students ${student.status} ${JSON.stringify(student.body)}`,
  );
  return {
    email,
    parent,
    householdId: (household.body.household as { id: string }).id,
    child: {
      id: (student.body.student as { id: string }).id,
      ...(student.body.credentials as { childLoginId: string; pin: string }),
    },
  };
}

const childLogin = (f: Family) =>
  call('POST', '/auth/child/login', undefined, {
    childLoginId: f.child.childLoginId,
    pin: f.child.pin,
    deviceId,
  });

const grant = (f: Family, type: string) =>
  call(
    'POST',
    `/students/${f.child.id}/consents/${type}/grant`,
    { parent: f.parent },
    { policyVersion: state.policyVersion },
  );

export const scenario: Scenario = {
  name: 'M02 — Consent & privacy core',
  steps: [
    {
      name: 'Parent sees the current policies and must accept them once',
      run: async () => {
        state.a = await newFamily('A');
        state.b = await newFamily('B');
        const before = await call('GET', '/policies/current?locale=vi', { parent: state.a.parent });
        assert(before.status === 200, `GET /policies/current ${before.status}`);
        assert(before.body.needsAcceptance === true, 'needsAcceptance should be true');
        const policies = before.body.policies as { type: string; version: number }[];
        state.policyVersion = policies.find((p) => p.type === 'PRIVACY_POLICY')?.version;
        assert(state.policyVersion, 'no PRIVACY_POLICY');
        for (const f of [state.a, state.b]) {
          const accept = await call(
            'POST',
            '/policies/accept',
            { parent: f.parent },
            { policies: policies.map((p) => ({ type: p.type, version: p.version })), deviceId },
          );
          assert(accept.status === 200, `accept ${accept.status} ${JSON.stringify(accept.body)}`);
        }
        const after = await call('GET', '/policies/current', { parent: state.a.parent });
        assert(after.body.needsAcceptance === false, 'still needs acceptance');
        return `${policies.map((p) => `${p.type} v${p.version}`).join(', ')}; needsAcceptance true → false`;
      },
    },
    {
      name: 'Child cannot sign in before the parent grants CORE_SERVICE',
      run: async () => {
        const res = await childLogin(state.a!);
        assert(res.status === 403, `login ${res.status} ${JSON.stringify(res.body)}`);
        assert(res.body.code === 'CONSENT_REQUIRED', `code ${res.body.code}`);
        assert(res.body.details?.consentType === 'CORE_SERVICE', 'consentType');
        return `403 CONSENT_REQUIRED (${String(res.body.details?.reason)})`;
      },
    },
    {
      name: 'Parent grants CORE_SERVICE → child signs in',
      run: async () => {
        for (const f of [state.a!, state.b!]) {
          const res = await grant(f, 'CORE_SERVICE');
          assert(res.status === 200, `grant ${res.status} ${JSON.stringify(res.body)}`);
          assert(res.body.effective === true, 'not effective');
        }
        const login = await childLogin(state.a!);
        assert(login.status === 200, `login ${login.status} ${JSON.stringify(login.body)}`);
        state.childToken = String(login.body.token);
        const audit = await sql`
          select 1 from ops.audit_logs where action = 'consent.granted' and target_id = ${state.a!.child.id}`;
        assert(audit.length === 1, `consent.granted audit rows ${audit.length}`);
        return 'grant → 200 effective; child login → 200; audit consent.granted written';
      },
    },
    {
      name: 'AI consent needs the child’s assent (age ≥ 7); revoking it returns CONSENT_REQUIRED and drops queued AI jobs',
      run: async () => {
        const a = state.a!;
        const child = { child: state.childToken! };
        const granted = await grant(a, 'AI_PERSONALIZATION');
        assert(granted.body.reason === 'CHILD_ASSENT_PENDING', `reason ${granted.body.reason}`);
        const pending = await call('GET', '/child/consents/AI_PERSONALIZATION', child);
        assert(pending.status === 403, `guard while pending ${pending.status}`);
        const assent = await call(
          'POST',
          `/students/${a.child.id}/consents/AI_PERSONALIZATION/child-assent`,
          child,
          { decision: 'GIVEN' },
        );
        assert(assent.status === 200, `assent ${assent.status} ${JSON.stringify(assent.body)}`);
        const ok = await call('GET', '/child/consents/AI_PERSONALIZATION', child);
        assert(ok.status === 200, `guard after assent ${ok.status}`);

        await sql`select pgmq.send('ai_jobs', ${sql.json({ student_id: a.child.id, kind: 'acceptance' })}::jsonb)`;
        const revoke = await call(
          'POST',
          `/students/${a.child.id}/consents/AI_PERSONALIZATION/revoke`,
          { parent: a.parent },
          {},
        );
        assert(revoke.status === 200, `revoke ${revoke.status}`);
        const denied = await call('GET', '/child/consents/AI_PERSONALIZATION', child);
        assert(denied.status === 403 && denied.body.code === 'CONSENT_REQUIRED', 'not denied');
        await tickWorker();
        const left = await sql`
          select 1 from pgmq.q_ai_jobs where message->>'student_id' = ${a.child.id}`;
        assert(left.length === 0, `${left.length} AI jobs still queued`);
        return `grant → CHILD_ASSENT_PENDING; assent GIVEN → 200; revoke → 403 CONSENT_REQUIRED (${String(denied.body.details?.reason)}); queued ai_jobs removed by the worker`;
      },
    },
    {
      name: 'Export: worker zips only the own household’s data into private Storage with a 24 h signed link',
      run: async () => {
        const a = state.a!;
        const req = await call('POST', '/privacy/export', { parent: a.parent }, {});
        assert(req.status === 202, `export ${req.status} ${JSON.stringify(req.body)}`);
        const jobId = (req.body.job as { id: string }).id;
        let job:
          { status: string; downloadUrl: string | null; expiresAt: string | null } | undefined;
        for (let i = 0; i < 10 && job?.status !== 'READY'; i++) {
          await tickWorker();
          job = (await call('GET', `/privacy/export/${jobId}`, { parent: a.parent })).body
            .job as typeof job;
        }
        assert(job?.status === 'READY' && job.downloadUrl, `job ${JSON.stringify(job)}`);
        const hours = (Date.parse(job.expiresAt!) - Date.now()) / 3_600_000;
        assert(hours > 23.5 && hours <= 24, `expires in ${hours.toFixed(2)} h`);
        const zip = Buffer.from(await (await fetch(job.downloadUrl)).arrayBuffer());
        const files = unzip(zip);
        const all = [...files.values()].join('\n');
        assert(all.includes(a.child.id) && all.includes(a.householdId), 'own data missing');
        assert(!all.includes(state.b!.child.id), 'other household’s child leaked');
        assert(!all.includes(state.b!.householdId), 'other household leaked');
        assert(!/pin_hash|token_hash/.test(all), 'secret columns exported');
        const objectPath = new URL(job.downloadUrl).pathname.replace(/.*\/sign\//, '');
        const unsigned = await fetch(
          `${new URL(job.downloadUrl).origin}/storage/v1/object/public/${objectPath}`,
        );
        assert(unsigned.status >= 400, `unsigned access ${unsigned.status}`);
        const otherParent = await call('GET', `/privacy/export/${jobId}`, {
          parent: state.b!.parent,
        });
        assert(otherParent.status === 404, `other parent → ${otherParent.status}`);
        const push = await sql`
          select 1 from ops.domain_events
          where type = 'notification.push_requested' and payload::text like ${`%${jobId}%`}`;
        assert(push.length === 1, `push notifier rows ${push.length}`);
        return `${files.size} files (${zip.length} B), no data of household B, no PIN/token hashes; bucket private; other parent → 404; push notifier called`;
      },
    },
    {
      name: 'Delete request disables the child at once; pg_cron purge after 30 days deletes it and anonymises ledgers',
      run: async () => {
        const a = state.a!;
        await sql.unsafe(`
          create table if not exists ${LEDGER} (
            id uuid primary key default gen_random_uuid(),
            household_id uuid not null, student_id uuid not null, amount integer not null);
          drop trigger if exists acceptance_ledger_append_only on ${LEDGER};
          create trigger acceptance_ledger_append_only before update or delete on ${LEDGER}
            for each row execute function ops.ledger_append_only();`);
        await sql`
          insert into ops.ledger_registry (table_name, student_column, household_column)
          values (${LEDGER}, 'student_id', 'household_id') on conflict do nothing`;
        await sql`insert into ${sql(LEDGER)} (household_id, student_id, amount)
          values (${a.householdId}, ${a.child.id}, 7)`;

        const other = await call(
          'POST',
          `/students/${a.child.id}/delete-request`,
          { parent: state.b!.parent },
          { confirm: true },
        );
        assert(other.status === 404, `other household → ${other.status}`);
        const res = await call(
          'POST',
          `/students/${a.child.id}/delete-request`,
          { parent: a.parent },
          { confirm: true, source: 'app' },
        );
        assert(res.status === 202, `delete-request ${res.status} ${JSON.stringify(res.body)}`);
        const deletion = res.body.deletion as { requestedAt: string; purgeAfter: string };
        const days =
          (Date.parse(deletion.purgeAfter) - Date.parse(deletion.requestedAt)) / 86_400_000;
        assert(Math.round(days) === 30, `grace ${days} days`);
        const login = await childLogin(a);
        assert(login.body.code === 'ACCOUNT_DISABLED', `login after request ${login.status}`);
        const session = await call('GET', '/auth/child/session', { child: state.childToken! });
        assert(session.status === 401, `old session → ${session.status}`);

        const cron = await sql`select active from cron.job where jobname = 'vionx-privacy-purge'`;
        assert(cron[0]?.active, 'cron job vionx-privacy-purge missing');
        // Simulate the 30 days, then run what pg_cron runs.
        await sql`
          update app.data_deletion_jobs set purge_after = now() - interval '1 minute'
          where student_id = ${a.child.id} and status = 'SCHEDULED'`;
        await sql`select ops.purge_due_deletions()`;
        const gone = await sql`select 1 from app.students where id = ${a.child.id}`;
        assert(gone.length === 0, 'student still present');
        const ledger = await sql<{ student_id: string; amount: number }[]>`
          select student_id, amount from ${sql(LEDGER)}`;
        assert(ledger.length === 1 && ledger[0]!.amount === 7, 'ledger row lost');
        assert(ledger[0]!.student_id !== a.child.id, 'ledger not anonymised');
        return `202, purge after ${Math.round(days)} days; login → ACCOUNT_DISABLED, session revoked; cron vionx-privacy-purge active; purge deleted the child, ledger row kept with an anonymised id`;
      },
    },
    {
      name: 'Account deletion (in-app path) signs the parent out and hides the household',
      run: async () => {
        const b = state.b!;
        const res = await call(
          'POST',
          '/account/delete-request',
          { parent: b.parent },
          { confirm: true, source: 'app' },
        );
        assert(res.status === 202, `account delete ${res.status} ${JSON.stringify(res.body)}`);
        const login = await childLogin(b);
        assert(login.body.code === 'ACCOUNT_DISABLED', `child login ${login.status}`);
        const [user] = await sql<{ banned: boolean }[]>`
          select banned_until > now() as banned from auth.users where id = ${b.parent.userId}`;
        assert(user?.banned, 'parent not banned');
        return 'scope ACCOUNT scheduled; child login → ACCOUNT_DISABLED; parent auth user banned';
      },
    },
    {
      name: 'Public account-deletion page /delete-account (admin SPA, no login)',
      run: async () => {
        const router = readFileSync(resolve(root, 'apps/admin/src/router.tsx'), 'utf8');
        assert(/path: '\/delete-account'/.test(router), 'route missing');
        assert(
          /getParentRoute: \(\) => rootRoute,\s*path: '\/delete-account'/.test(router),
          'route is inside the authenticated shell',
        );
        const dist = resolve(root, 'apps/admin/dist');
        if (!existsSync(resolve(dist, 'index.html'))) {
          throw new SkipStep('apps/admin/dist missing; run `pnpm --filter @vionx/admin build`');
        }
        const redirects = readFileSync(resolve(dist, '_redirects'), 'utf8');
        assert(/^\/\*\s+\/index\.html\s+200/m.test(redirects), 'SPA fallback missing');
        return 'route registered outside the admin shell; build has index.html + SPA fallback';
      },
    },
    {
      name: 'Legal drafts (vi + en) marked DRAFT, disclosing Supabase Singapore and Anthropic, published as policy v1',
      run: async () => {
        const out: string[] = [];
        for (const [file, type, locale] of [
          ['privacy-policy.vi.md', 'PRIVACY_POLICY', 'vi'],
          ['privacy-policy.en.md', 'PRIVACY_POLICY', 'en'],
          ['terms.vi.md', 'TERMS_OF_SERVICE', 'vi'],
          ['terms.en.md', 'TERMS_OF_SERVICE', 'en'],
        ] as const) {
          const text = readFileSync(resolve(root, 'docs/legal', file), 'utf8');
          assert(/DRAFT/.test(text), `${file} not marked DRAFT`);
          if (type === 'PRIVACY_POLICY') {
            assert(/Singapore/.test(text) && /Supabase/.test(text), `${file}: hosting`);
            assert(/Anthropic/.test(text), `${file}: AI processor`);
          }
          const [row] = await sql<{ content_md: string }[]>`
            select content_md from app.policy_versions
            where type = ${type} and locale = ${locale} and version = 1`;
          assert(row?.content_md.trim() === text.trim(), `${file} differs from policy_versions v1`);
          out.push(file);
        }
        return `${out.join(', ')} match app.policy_versions v1; owner legal review pending`;
      },
    },
    {
      name: 'Maestro flow apps/mobile/.maestro/m02-consent.yaml',
      run: async () => {
        throw new SkipStep(
          'needs an Android emulator with the development build (not available here)',
        );
      },
    },
  ],
  cleanup: async () => {
    await sql`delete from ops.ledger_registry where table_name = ${LEDGER}`;
    await sql.unsafe(`drop table if exists ${LEDGER}`);
    for (const id of users) {
      await sql`
        delete from app.households where id in (
          select household_id from app.household_memberships where user_id = ${id})`;
      await sql`delete from auth.users where id = ${id}`;
    }
    await sql.end({ timeout: 5 });
  },
};

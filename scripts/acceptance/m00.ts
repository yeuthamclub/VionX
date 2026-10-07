// M00 acceptance (TASK_PACKS/M00.md). Requires `pnpm db:start && pnpm fn:serve`.
//   pnpm acceptance m00
// Optional: ANTHROPIC_API_KEY (runs ai:check), SKIP_ADMIN_BUILD=1, CRON_WAIT_MS (default 75000).
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, connectDb, env, SkipStep, waitFor, type Scenario } from './lib.ts';

const root = resolve(import.meta.dirname, '../..');
const sql = connectDb();
const cronWaitMs = Number(process.env.CRON_WAIT_MS ?? 75_000);

function run(cmd: string, args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    timeout: 300_000,
  });
}

async function postWorker(secret?: string): Promise<Response> {
  return fetch(`${env.functionsUrl}/worker`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-vionx-service-secret': secret } : {}),
    },
    body: '{}',
  });
}

export const scenario: Scenario = {
  name: 'M00 — Foundation',
  steps: [
    {
      name: 'supabase start + fn:serve → GET /api/v1/health is OK',
      run: async () => {
        const res = await fetch(`${env.functionsUrl}/api/v1/health`);
        const body = (await res.json()) as {
          status: string;
          checks: Record<string, { ok: boolean; detail?: string }>;
        };
        assert(
          res.status === 200 && body.status === 'ok',
          `health ${res.status} ${JSON.stringify(body)}`,
        );
        for (const name of ['db', 'storage', 'queue']) {
          assert(body.checks[name]?.ok, `${name} check failed: ${body.checks[name]?.detail}`);
        }
        return `status=ok db/storage/queue ok; ai key present=${body.checks.ai?.ok}`;
      },
    },
    {
      name: 'OpenAPI served at /api/v1/openapi.json matches docs/api/openapi.json',
      run: async () => {
        const served = (await (await fetch(`${env.functionsUrl}/api/v1/openapi.json`)).json()) as {
          paths: Record<string, unknown>;
        };
        const committed = JSON.parse(
          await readFile(resolve(root, 'docs/api/openapi.json'), 'utf8'),
        ) as { paths: Record<string, unknown> };
        assert(
          JSON.stringify(Object.keys(served.paths).sort()) ===
            JSON.stringify(Object.keys(committed.paths).sort()),
          'served paths differ from committed document',
        );
        return `paths: ${Object.keys(served.paths).join(', ')}`;
      },
    },
    {
      name: 'Database: schemas, extensions, seeded ai_task_config, no client grants',
      run: async () => {
        const schemas = await sql<{ n: string }[]>`
          select nspname as n from pg_namespace where nspname in ('app','library','ops') order by 1`;
        assert(schemas.length === 3, 'missing schemas');
        const ext = await sql<{ n: string }[]>`
          select extname as n from pg_extension
          where extname in ('pgmq','pg_cron','pg_net','unaccent') order by 1`;
        assert(ext.length === 4, `extensions: ${ext.map((e) => e.n).join(',')}`);
        const tasks = await sql`select task, model from ops.ai_task_config`;
        assert(tasks.length === 14, `ai_task_config rows: ${tasks.length}`);
        const grants = await sql<{ n: number }[]>`
          select count(*)::int as n from information_schema.role_table_grants
          where grantee in ('anon','authenticated') and table_schema in ('app','library','ops')`;
        assert(grants[0]?.n === 0, 'client roles have table grants');
        const noRls = await sql<{ t: string }[]>`
          select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('app','library','ops') and c.relkind = 'r' and not c.relrowsecurity`;
        assert(noRls.length === 0, `RLS off on: ${noRls.map((r) => r.t).join(',')}`);
        return 'app/library/ops + pgmq/pg_cron/pg_net/unaccent; 14 ai tasks; RLS on, no grants';
      },
    },
    {
      name: 'Outbox ledger is append-only',
      run: async () => {
        const [row] = await sql<{ id: string }[]>`
          insert into ops.domain_events (type, payload) values ('system.ping', '{"probe":"append-only"}')
          returning id`;
        try {
          await sql`update ops.domain_events set payload = '{}' where id = ${row!.id}`;
        } catch (error) {
          return `UPDATE rejected: ${(error as Error).message}`;
        }
        throw new Error('UPDATE on ops.domain_events succeeded');
      },
    },
    {
      name: 'Worker rejects calls without the service secret',
      run: async () => {
        const res = await postWorker();
        await res.body?.cancel();
        assert(res.status === 401, `expected 401, got ${res.status}`);
        return '401 UNAUTHENTICATED';
      },
    },
    {
      name: 'Inserted domain_events row is consumed exactly once (pg_cron → pg_net → worker)',
      run: async () => {
        const job = await sql`select active from cron.job where jobname = 'vionx-worker-tick'`;
        assert(job[0]?.active, 'cron job vionx-worker-tick missing or inactive');

        const [event] = await sql<{ id: string }[]>`
          insert into ops.domain_events (type, payload, idempotency_key)
          values ('system.ping', '{"probe":"m00"}', ${`m00-${randomUUID()}`}) returning id`;
        const id = event!.id;

        // 1) Wait for the cron tick to consume it (no direct worker call).
        const consumedByCron = await waitFor(async () => {
          const rows = await sql`select 1 from ops.processed_events where event_id = ${id}`;
          return rows.length > 0 ? true : undefined;
        }, cronWaitMs);
        assert(consumedByCron, `not consumed by cron within ${cronWaitMs} ms`);

        // 2) Redeliver the same event (duplicate queue message) and run the worker twice more.
        await sql`select pgmq.send('events', ${sql.json({ event_id: id, type: 'system.ping' })}::jsonb)`;
        for (let i = 0; i < 2; i++) {
          const res = await postWorker(env.serviceSecret);
          assert(res.ok, `worker responded ${res.status}`);
          await res.json();
        }

        const processed = await sql<{ n: number }[]>`
          select count(*)::int as n from ops.processed_events where event_id = ${id}`;
        assert(processed[0]?.n === 1, `processed rows: ${processed[0]?.n}`);
        const pending = await sql<{ n: number }[]>`
          select count(*)::int as n from pgmq.q_events where message->>'event_id' = ${id}`;
        assert(pending[0]?.n === 0, `messages still queued: ${pending[0]?.n}`);
        const archived = await sql<{ n: number }[]>`
          select count(*)::int as n from pgmq.a_events where message->>'event_id' = ${id}`;
        return `event ${id}: 1 processed row, ${archived[0]?.n} queue messages archived (1 duplicate ignored)`;
      },
    },
    {
      name: 'pnpm ai:check succeeds with a real key',
      run: async () => {
        if (!process.env.ANTHROPIC_API_KEY) throw new SkipStep('ANTHROPIC_API_KEY not set');
        const result = run('pnpm', ['--silent', 'ai:check']);
        assert(result.status === 0, `ai:check exit ${result.status}: ${result.stderr}`);
        return result.stdout.trim().split('\n').slice(0, 4).join(' ');
      },
    },
    {
      name: 'Admin `pnpm build` passes',
      run: async () => {
        if (process.env.SKIP_ADMIN_BUILD === '1') throw new SkipStep('SKIP_ADMIN_BUILD=1');
        const result = run('pnpm', ['--filter', '@vionx/admin', 'build']);
        assert(result.status === 0, `build exit ${result.status}: ${result.stderr.slice(-500)}`);
        return 'apps/admin/dist built';
      },
    },
    {
      name: 'Android dev build shows the health status',
      run: async () => {
        throw new SkipStep(
          'manual / Maestro: maestro test apps/mobile/.maestro/m00-health.yaml on an emulator',
        );
      },
    },
  ],
  cleanup: async () => {
    await sql.end({ timeout: 5 });
  },
};

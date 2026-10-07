// API integration tests against local Supabase. Run: pnpm db:start && pnpm fn:serve, then
// pnpm test:api. Defaults match `supabase start`; override with FUNCTIONS_URL / DB_URL.
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthResponseSchema, ErrorBodySchema } from '@vionx/contracts';

const FUNCTIONS_URL = (process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1').replace(
  /\/+$/,
  '',
);
const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SECRET = process.env.VIONX_SERVICE_SECRET ?? 'local-dev-service-secret';

const sql = postgres(DB_URL, { max: 2, onnotice: () => {} });

const post = (fn: string, body: unknown, secret: string | null = SECRET) =>
  fetch(`${FUNCTIONS_URL}/${fn}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-vionx-service-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });

let aiKeyPresent = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${FUNCTIONS_URL}/api/v1/health`);
    aiKeyPresent = ((await res.json()) as { checks: { ai: { ok: boolean } } }).checks.ai.ok;
  } catch (error) {
    throw new Error(
      `API not reachable at ${FUNCTIONS_URL}. Start it with \`pnpm db:start && pnpm fn:serve\`.`,
      { cause: error },
    );
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe('api function', () => {
  it('GET /api/v1/health returns ok with a valid body', async () => {
    const res = await fetch(`${FUNCTIONS_URL}/api/v1/health`, {
      headers: { 'x-request-id': 'it-health-1' },
    });
    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ status: 'ok', requestId: 'it-health-1' });
    expect(body.checks.db.ok && body.checks.storage.ok && body.checks.queue.ok).toBe(true);
  });

  it('serves the OpenAPI 3.1 document', async () => {
    const res = await fetch(`${FUNCTIONS_URL}/api/v1/openapi.json`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ openapi: '3.1.0' });
  });

  it('returns the stable error shape for unknown routes', async () => {
    const res = await fetch(`${FUNCTIONS_URL}/api/v1/does-not-exist`);
    expect(res.status).toBe(404);
    expect(ErrorBodySchema.parse(await res.json()).code).toBe('NOT_FOUND');
  });
});

describe('client roles have no direct table access', () => {
  it('anon and authenticated cannot read ops tables', async () => {
    const rows = await sql<{ role: string; allowed: boolean }[]>`
      select r as role, has_table_privilege(r, 'ops.domain_events', 'select') as allowed
      from unnest(array['anon', 'authenticated']) as r`;
    expect(rows.every((r) => !r.allowed)).toBe(true);
  });
});

describe('worker function', () => {
  it('requires the service secret', async () => {
    const res = await post('worker', {}, null);
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  it('consumes an outbox event exactly once, even if redelivered', async () => {
    const [event] = await sql<{ id: string }[]>`
      insert into ops.domain_events (type, payload, idempotency_key)
      values ('system.ping', '{}', ${`it-${randomUUID()}`}) returning id`;
    const id = event!.id;
    await sql`select pgmq.send('events', ${sql.json({ event_id: id, type: 'system.ping' })}::jsonb)`;

    for (let i = 0; i < 3; i++) {
      const res = await post('worker', {});
      expect(res.status).toBe(200);
      await res.json();
    }

    const [processed] = await sql<{ n: number }[]>`
      select count(*)::int as n from ops.processed_events where event_id = ${id}`;
    expect(processed!.n).toBe(1);
    const [pending] = await sql<{ n: number }[]>`
      select count(*)::int as n from pgmq.q_events where message->>'event_id' = ${id}`;
    expect(pending!.n).toBe(0);
  });

  it('rejects updates to the outbox (append-only)', async () => {
    await expect(sql`update ops.domain_events set payload = '{}'`).rejects.toThrow(/append-only/);
  });
});

describe('ai-batch function (FakeAiProvider when no key is configured)', () => {
  it('submits and collects a batch, logging ops.ai_runs', async (ctx) => {
    if (aiKeyPresent) ctx.skip(); // never spend money in tests (CONTRACT §6)
    const promptVersion = `it-${randomUUID()}`;
    const submit = await post('ai-batch', {
      action: 'submit',
      task: 'item_verification',
      promptVersion,
      outputSchema: { type: 'object' },
      items: [{ customId: 'item-1', input: { stem: '2 + 2 = ?' } }],
    });
    expect(submit.status).toBe(200);
    const { batchId } = (await submit.json()) as { batchId: string };

    // The fake provider lives per isolate; collect may land on a fresh isolate, so only the
    // submit row is asserted here. Real collection is exercised by X01/M10.
    const rows = await sql<{ status: string; model: string }[]>`
      select status, model from ops.ai_runs where batch_id = ${batchId}`;
    expect(rows).toEqual([{ status: 'batch_submitted', model: 'claude-haiku-4-5' }]);
  });
});

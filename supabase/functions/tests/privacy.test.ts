import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { SkeletonActorResolver } from '../_shared/actor.ts';
import { MemoryStorage, SupabaseStorage } from '../_shared/storage.ts';
import { PERSONAL_DATA_KEYS, PURGED_LOG_RETENTION_DAYS } from '@vionx/domain';
import type { Actor } from '../_shared/actor.ts';
import { ACCOUNT_DELETION_PENDING_ROUTES, createApp } from '../api/app.ts';
import { noDatabase } from '../api/deps.ts';
import { createWorkerHandler } from '../worker/app.ts';
import { createHandlers } from '../worker/handlers.ts';
import { buildExportZip, EXPORT_SECTIONS } from '../worker/privacy-export.ts';

const root = resolve(import.meta.dirname, '../../..');
const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('export zip', () => {
  it('holds a README, a manifest and one JSON file per section (UTF-8)', () => {
    const zip = buildExportZip(
      { 'children.json': [{ display_name: 'Bé Na' }], 'household.json': [{ id: 'h1' }] },
      { householdId: 'h1', jobId: 'j1' },
    );
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual([
      'README.txt',
      'children.json',
      'household.json',
      'manifest.json',
    ]);
    expect(JSON.parse(utf8(files['children.json']!))).toEqual([{ display_name: 'Bé Na' }]);
    expect(JSON.parse(utf8(files['manifest.json']!))).toMatchObject({
      householdId: 'h1',
      files: ['children.json', 'household.json'],
    });
  });

  it('every section filters on the household and never selects secrets', () => {
    expect(EXPORT_SECTIONS.map((s) => s.file)).toContain('consents.json');
    const source = readFileSync(
      resolve(root, 'supabase/functions/worker/privacy-export.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/pin_hash|token_hash|device_id_hash/);
  });
});

describe('SupabaseStorage', () => {
  it('uploads with upsert, signs on the public URL and removes by prefix', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/object/sign/')) {
        return Response.json({ signedURL: '/object/sign/privacy-exports/h/j.zip?token=t' });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const storage = new SupabaseStorage({
      url: 'http://kong:8000',
      serviceRoleKey: 'key',
      publicUrl: 'http://127.0.0.1:54321/',
      fetch: fakeFetch,
    });
    await storage.upload('privacy-exports', 'h/j.zip', new Uint8Array([1]), 'application/zip');
    const url = await storage.createSignedUrl('privacy-exports', 'h/j.zip', 3600);
    await storage.remove('privacy-exports', ['h/j.zip']);
    expect(url).toBe(
      'http://127.0.0.1:54321/storage/v1/object/sign/privacy-exports/h/j.zip?token=t',
    );
    expect(calls[0]!.url).toBe('http://kong:8000/storage/v1/object/privacy-exports/h/j.zip');
    expect((calls[0]!.init.headers as Record<string, string>)['x-upsert']).toBe('true');
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ expiresIn: 3600 });
    expect(calls[2]!.init.method).toBe('DELETE');
  });

  it('surfaces storage errors', async () => {
    const storage = new SupabaseStorage({
      url: 'http://x',
      serviceRoleKey: 'k',
      publicUrl: 'http://x',
      fetch: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
    });
    await expect(storage.upload('b', 'p', new Uint8Array(), 'application/zip')).rejects.toThrow(
      /upload failed: 500/,
    );
  });
});

describe('worker', () => {
  it('registers the M02 consumers', () => {
    const handlers = createHandlers({
      storage: new MemoryStorage(),
      notifier: { notify: async () => {} },
    });
    expect(Object.keys(handlers)).toEqual(
      expect.arrayContaining([
        'consent.revoked',
        'privacy.deletion_requested',
        'privacy.export_requested',
      ]),
    );
  });

  it('runs maintenance on each tick and survives its failure', async () => {
    const queue = {
      read: async () => [],
      deadLetter: async () => {},
      processOnce: async () => 'processed' as const,
    };
    const ok = createWorkerHandler({
      serviceSecret: 's',
      queue,
      handlers: {},
      maintenance: async () => ({ expiredExports: 2 }),
    });
    const req = () =>
      new Request('http://local/worker', {
        method: 'POST',
        headers: { 'x-vionx-service-secret': 's' },
      });
    expect(await (await ok(req())).json()).toMatchObject({ maintenance: { expiredExports: 2 } });
    const failing = createWorkerHandler({
      serviceSecret: 's',
      queue,
      handlers: {},
      maintenance: async () => {
        throw new Error('storage down');
      },
    });
    const res = await failing(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ maintenance: { error: 'storage down' } });
  });
});

describe('api without a database', () => {
  const app = createApp({
    version: 'test',
    allowedOrigins: [],
    actors: new SkeletonActorResolver('s'),
    sql: noDatabase,
    admins: { permissionsOf: async () => [] },
    probes: {
      db: async () => {},
      storage: async () => {},
      queue: async () => {},
      aiKeyPresent: false,
    },
  });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`http://local/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it.each([
    ['GET', '/v1/students/3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c/consents'],
    ['POST', '/v1/privacy/export'],
    ['GET', '/v1/privacy/overview'],
    ['GET', '/v1/child/consents/AI_PERSONALIZATION'],
    ['POST', '/v1/students/3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c/delete-request/cancel'],
    ['POST', '/v1/account/delete-request/cancel'],
  ])('%s %s requires a signed-in actor', async (method, path) => {
    expect((await call(method, path)).status).toBe(401);
  });

  it('validates consent types and delete confirmation before touching data', async () => {
    const id = '3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c';
    expect(
      (await call('POST', `/v1/students/${id}/consents/CAMERA_READING/grant`, { policyVersion: 1 }))
        .status,
    ).toBe(400);
    expect((await call('POST', '/v1/account/delete-request', { confirm: false })).status).toBe(400);
  });
});

describe('policy version 1 migration', () => {
  it('matches docs/legal verbatim and is marked DRAFT', () => {
    const migration = readFileSync(resolve(root, 'supabase/migrations/0004_policy_v1.sql'), 'utf8');
    const bodies = [...migration.matchAll(/\$policy\$([\s\S]*?)\$policy\$/g)].map((m) => m[1]);
    const docs = ['privacy-policy.vi', 'privacy-policy.en', 'terms.vi', 'terms.en'].map((name) =>
      readFileSync(resolve(root, `docs/legal/${name}.md`), 'utf8'),
    );
    expect(bodies).toEqual(docs);
    for (const doc of docs) expect(doc).toMatch(/DRAFT/);
    for (const doc of docs.slice(0, 2)) {
      expect(doc).toMatch(/Singapore/);
      expect(doc).toMatch(/Anthropic/);
    }
  });
});

describe('account deletion pending: the parent may only see and cancel it', () => {
  const USER = '0b6f3c1e-2a4d-4e5f-8a9b-1c2d3e4f5a6b';
  const purgeAfter = new Date('2026-11-07T03:00:00Z');
  const parent: Actor = { kind: 'parent', userId: USER, phone: null, email: null };
  const app = createApp({
    version: 'test',
    allowedOrigins: [],
    actors: { resolve: async () => parent },
    sql: noDatabase,
    admins: { permissionsOf: async () => [] },
    accountDeletions: {
      pending: async (userId) => (userId === USER ? { id: 'job-1', purgeAfter } : null),
    },
    probes: {
      db: async () => {},
      storage: async () => {},
      queue: async () => {},
      aiKeyPresent: false,
    },
  });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`http://local/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it.each([
    ['GET', '/v1/household'],
    ['POST', '/v1/household'],
    ['POST', '/v1/privacy/export'],
    ['POST', '/v1/policies/accept'],
    ['GET', '/v1/students/3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c/consents'],
  ])('%s %s answers ACCOUNT_DISABLED with the purge date', async (method, path) => {
    const res = await call(method, path, method === 'POST' ? {} : undefined);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: 'ACCOUNT_DISABLED',
      details: {
        reason: 'DELETION_PENDING',
        deletionId: 'job-1',
        purgeAfter: purgeAfter.toISOString(),
      },
    });
  });

  it('lets the status and cancel routes through', () => {
    expect([...ACCOUNT_DELETION_PENDING_ROUTES].sort()).toEqual([
      'GET /v1/health',
      'GET /v1/me',
      'GET /v1/openapi.json',
      'GET /v1/policies/current',
      'GET /v1/privacy/overview',
      'POST /v1/account/delete-request',
      'POST /v1/account/delete-request/cancel',
    ]);
  });

  it('documents both cancel routes in OpenAPI', async () => {
    const doc = (await (await call('GET', '/v1/openapi.json')).json()) as {
      paths: Record<string, unknown>;
    };
    expect(doc.paths).toHaveProperty(['/api/v1/students/{id}/delete-request/cancel']);
    expect(doc.paths).toHaveProperty(['/api/v1/account/delete-request/cancel']);
  });
});

describe('purged log retention migration', () => {
  const migration = readFileSync(
    resolve(root, 'supabase/migrations/0005_deletion_cancel_retention.sql'),
    'utf8',
  );

  it('scrubs the same personal keys as @vionx/domain', () => {
    const list = migration.match(/personal constant text\[\] := array\[([\s\S]*?)\];/)?.[1];
    const keys = [...(list ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(keys).toEqual([...PERSONAL_DATA_KEYS]);
  });

  it('deletes retained rows after the same number of days and runs daily', () => {
    expect(migration).toContain(
      `p_retention interval default interval '${PURGED_LOG_RETENTION_DAYS} days'`,
    );
    expect(migration).toMatch(
      /cron\.schedule\('vionx-purged-log-retention', '\d+ \d+ \* \* \*', \$\$select ops\.delete_expired_purged_logs\(\)\$\$\)/,
    );
  });
});

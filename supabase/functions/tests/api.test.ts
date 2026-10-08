import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from '@vionx/contracts';
import { SkeletonActorResolver, requireActor, type Actor } from '../_shared/actor.ts';
import { createApp } from '../api/app.ts';
import type { ApiDeps } from '../api/deps.ts';

const SECRET = 'test-secret';

function deps(overrides: Partial<ApiDeps['probes']> = {}): ApiDeps {
  return {
    version: 'test',
    allowedOrigins: ['http://localhost:5173'],
    actors: new SkeletonActorResolver(SECRET),
    probeTimeoutMs: 50,
    probes: {
      db: async () => {},
      storage: async () => {},
      queue: async () => 'events queue length 0',
      aiKeyPresent: true,
      ...overrides,
    },
  };
}

const get = (app: ReturnType<typeof createApp>, path: string, init?: RequestInit) =>
  app.request(`http://local/api${path}`, init);

describe('GET /v1/health', () => {
  it('returns ok with all checks', async () => {
    const res = await get(createApp(deps()), '/v1/health');
    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.status).toBe('ok');
    expect(body.checks.queue.detail).toBe('events queue length 0');
    expect(res.headers.get('x-request-id')).toBe(body.requestId);
  });

  it('reports a missing AI key without degrading', async () => {
    const res = await get(createApp(deps({ aiKeyPresent: false })), '/v1/health');
    const body = HealthResponseSchema.parse(await res.json());
    expect(res.status).toBe(200);
    expect(body.checks.ai).toMatchObject({ ok: false, critical: false });
  });

  it('degrades with 503 when a critical probe fails or times out', async () => {
    const app = createApp(
      deps({
        db: async () => {
          throw new Error('connection refused');
        },
        storage: () => new Promise(() => {}),
      }),
    );
    const res = await get(app, '/v1/health');
    expect(res.status).toBe(503);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.status).toBe('degraded');
    expect(body.checks.db).toMatchObject({ ok: false, detail: 'connection refused' });
    expect(body.checks.storage.detail).toMatch(/timed out/);
  });

  it('echoes a valid incoming request id', async () => {
    const res = await get(createApp(deps()), '/v1/health', {
      headers: { 'x-request-id': 'req-123' },
    });
    expect(res.headers.get('x-request-id')).toBe('req-123');
    expect(((await res.json()) as { requestId: string }).requestId).toBe('req-123');
  });

  it('allows CORS only for configured origins', async () => {
    const app = createApp(deps());
    const allowed = await get(app, '/v1/health', { headers: { origin: 'http://localhost:5173' } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const denied = await get(app, '/v1/health', { headers: { origin: 'https://evil.example' } });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('errors and docs', () => {
  it('renders unknown routes with the stable error shape', async () => {
    const res = await get(createApp(deps()), '/v1/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'NOT_FOUND', requestId: expect.any(String) });
  });

  it('serves the OpenAPI document', async () => {
    const res = await get(createApp(deps()), '/v1/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toContain('/api/v1/health');
  });
});

describe('actor resolver skeleton', () => {
  const resolver = new SkeletonActorResolver(SECRET);
  const req = (headers: Record<string, string>) => new Request('http://local/', { headers });

  it('recognises the system actor by service secret', async () => {
    expect(await resolver.resolve(req({ 'x-vionx-service-secret': SECRET }))).toEqual({
      kind: 'system',
    });
    expect(await resolver.resolve(req({ 'x-vionx-service-secret': 'wrong' }))).toEqual({
      kind: 'anonymous',
    });
  });

  it('treats unverified bearer tokens as anonymous until M01', async () => {
    expect(await resolver.resolve(req({ authorization: 'Bearer abc' }))).toEqual({
      kind: 'anonymous',
    });
  });

  it('requireActor enforces actor kinds', () => {
    const system: Actor = { kind: 'system' };
    expect(requireActor(system, 'system')).toBe(system);
    expect(() => requireActor({ kind: 'anonymous' }, 'parent')).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }),
    );
    expect(() => requireActor(system, 'parent', 'admin')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });
});

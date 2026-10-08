import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import type { HealthCheck } from '@vionx/contracts';
import type { ApiDeps, Probe } from '../deps.ts';
import type { AppEnv } from '../app.ts';
import { ErrorBodySchema, HealthResponseSchema, type HealthResponse } from './schemas.ts';

const healthRoute = createRoute({
  method: 'get',
  path: '/v1/health',
  tags: ['system'],
  summary: 'Service health',
  description:
    'Checks the database, storage and the pgmq "events" queue, and reports whether an Anthropic API key is configured. Public; no authentication.',
  responses: {
    200: {
      content: { 'application/json': { schema: HealthResponseSchema } },
      description: 'All critical checks pass',
    },
    503: {
      content: { 'application/json': { schema: HealthResponseSchema } },
      description: 'At least one critical check failed',
    },
    500: {
      content: { 'application/json': { schema: ErrorBodySchema } },
      description: 'Unexpected error',
    },
  },
});

async function runProbe(probe: Probe, timeoutMs: number): Promise<HealthCheck> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const detail = await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    const check: HealthCheck = { ok: true, critical: true, latencyMs: Date.now() - started };
    if (typeof detail === 'string') check.detail = detail;
    return check;
  } catch (error) {
    return {
      ok: false,
      critical: true,
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function registerSystemRoutes(app: OpenAPIHono<AppEnv>, deps: ApiDeps): void {
  app.openapi(healthRoute, async (c) => {
    const timeoutMs = deps.probeTimeoutMs ?? 3000;
    const [db, storage, queue] = await Promise.all([
      runProbe(deps.probes.db, timeoutMs),
      runProbe(deps.probes.storage, timeoutMs),
      runProbe(deps.probes.queue, timeoutMs),
    ]);
    const ai: HealthCheck = deps.probes.aiKeyPresent
      ? { ok: true, critical: false }
      : { ok: false, critical: false, detail: 'ANTHROPIC_API_KEY is not set' };
    const checks = { db, storage, queue, ai };
    const healthy = Object.values(checks).every((check) => check.ok || !check.critical);
    const body: HealthResponse = {
      status: healthy ? 'ok' : 'degraded',
      version: deps.version,
      time: new Date().toISOString(),
      requestId: c.get('requestId'),
      checks,
    };
    return healthy ? c.json(body, 200) : c.json(body, 503);
  });
}

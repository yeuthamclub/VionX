// Runtime-neutral construction of the `api` Hono app. `index.ts` (Deno) wires real deps;
// Vitest (Node) and the OpenAPI generator call createApp with fakes.
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import type { Actor } from '../_shared/actor.ts';
import { ApiError, errorBody } from '../_shared/errors.ts';
import type { ApiDeps } from './deps.ts';
import { registerSystemRoutes } from './system/routes.ts';

export type AppEnv = { Variables: { requestId: string; actor: Actor } };

/** Supabase serves the function at /functions/v1/api; Hono sees paths starting with /api. */
export const BASE_PATH = '/api';

export const OPENAPI_INFO: Parameters<OpenAPIHono['getOpenAPI31Document']>[0] = {
  openapi: '3.1.0',
  info: {
    title: 'VionX API',
    version: '1.0.0',
    description:
      'Single entry point for the VionX Android app and admin SPA (Supabase Edge Function `api`).',
  },
  servers: [{ url: '/functions/v1', description: 'Supabase Edge Functions base' }],
};

export function createApp(deps: ApiDeps) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const error = new ApiError('VALIDATION_FAILED', 'Request is invalid', result.error.issues);
        return c.json(errorBody(error, c.get('requestId')), 400);
      }
    },
  }).basePath(BASE_PATH);

  app.use('*', requestId({ headerName: 'x-request-id' }));
  app.use(
    '*',
    cors({
      origin: (origin) => (deps.allowedOrigins.includes(origin) ? origin : null),
      allowHeaders: ['authorization', 'content-type', 'x-request-id', 'x-vionx-child-session'],
      exposeHeaders: ['x-request-id'],
      maxAge: 600,
    }),
  );
  app.use('*', async (c, next) => {
    c.set('actor', await deps.actors.resolve(c.req.raw));
    await next();
  });

  registerSystemRoutes(app, deps);

  app.doc31('/v1/openapi.json', OPENAPI_INFO);

  app.notFound((c) =>
    c.json(errorBody(new ApiError('NOT_FOUND', 'Route not found'), c.get('requestId')), 404),
  );
  app.onError((error, c) => {
    const id = c.get('requestId') ?? 'unknown';
    if (error instanceof ApiError) {
      return c.json(errorBody(error, id), error.status as 400);
    }
    console.error(JSON.stringify({ level: 'error', requestId: id, error: String(error) }));
    return c.json(errorBody(new ApiError('INTERNAL', 'Internal error'), id), 500);
  });

  return app;
}

export type ApiApp = ReturnType<typeof createApp>;

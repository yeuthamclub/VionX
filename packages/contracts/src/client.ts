import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './generated/openapi.ts';

export type { paths as ApiPaths } from './generated/openapi.ts';
export type HealthResponse = components['schemas']['HealthResponse'];
export type ApiErrorBody = components['schemas']['Error'];

export interface ApiClientOptions {
  /** e.g. `http://10.0.2.2:54321/functions/v1` (Android emulator → local Supabase). */
  baseUrl: string;
  /** Returns auth headers per request (parent JWT or child session token from M01). */
  getHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
  fetch?: typeof fetch;
}

/** Typed client for the `api` Edge Function, generated from docs/api/openapi.json. */
export function createApiClient(options: ApiClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  if (options.getHeaders) {
    const getHeaders = options.getHeaders;
    const auth: Middleware = {
      async onRequest({ request }) {
        for (const [key, value] of Object.entries(await getHeaders())) {
          request.headers.set(key, value);
        }
        return request;
      },
    };
    client.use(auth);
  }
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

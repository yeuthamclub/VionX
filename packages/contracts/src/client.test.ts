import { describe, expect, it } from 'vitest';
import { createApiClient } from './client.ts';

describe('createApiClient', () => {
  it('calls the api function with typed paths and injected headers', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const client = createApiClient({
      baseUrl: 'http://localhost:54321/functions/v1/',
      getHeaders: () => ({ authorization: 'Bearer test' }),
      fetch: (async (input: Request) => {
        seen.push({ url: input.url, auth: input.headers.get('authorization') });
        return Response.json({ status: 'ok' });
      }) as typeof fetch,
    });
    const { data } = await client.GET('/api/v1/health');
    expect(data?.status).toBe('ok');
    expect(seen).toEqual([
      { url: 'http://localhost:54321/functions/v1/api/v1/health', auth: 'Bearer test' },
    ]);
  });
});

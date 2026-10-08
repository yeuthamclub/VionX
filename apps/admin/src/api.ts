import { createApiClient, type MeResponse } from '@vionx/contracts/client';
import { currentAccessToken } from './auth.ts';

/** Base URL of the Supabase Edge Functions (the api function lives at `${base}/api`). */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_URL ?? 'http://localhost:54321/functions/v1';

export const api = createApiClient({
  baseUrl: API_BASE_URL,
  getHeaders: async (): Promise<Record<string, string>> => {
    const token = await currentAccessToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  },
});

/** GET /v1/me; null when the session is missing or rejected. */
export async function fetchMe(): Promise<MeResponse | null> {
  const { data, response } = await api.GET('/api/v1/me');
  if (response.status === 401) return null;
  if (!data) throw new Error(`API responded ${response.status}`);
  return data;
}

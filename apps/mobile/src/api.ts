import { CHILD_SESSION_HEADER, createApiClient } from '@vionx/contracts/client';
import { API_URL } from './config.ts';
import { childToken } from './state/device.ts';
import { parentAccessToken } from './state/supabase.ts';

/** Unauthenticated calls (health, child login). */
export const api = createApiClient({ baseUrl: API_URL });

/** Parent calls: Supabase Auth access token as Bearer. */
export const parentApi = createApiClient({
  baseUrl: API_URL,
  getHeaders: async (): Promise<Record<string, string>> => {
    const token = await parentAccessToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  },
});

/** Child calls: opaque session token from expo-secure-store. */
export const childApi = createApiClient({
  baseUrl: API_URL,
  getHeaders: async (): Promise<Record<string, string>> => {
    const token = await childToken.get();
    return token ? { [CHILD_SESSION_HEADER]: token } : {};
  },
});

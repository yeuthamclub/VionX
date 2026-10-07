import { createApiClient } from '@vionx/contracts/client';

/** Base URL of the Supabase Edge Functions (the api function lives at `${base}/api`). */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_URL ?? 'http://localhost:54321/functions/v1';

export const api = createApiClient({ baseUrl: API_BASE_URL });

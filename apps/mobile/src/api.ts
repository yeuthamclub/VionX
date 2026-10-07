import { createApiClient } from '@vionx/contracts/client';
import { API_URL } from './config.ts';

export const api = createApiClient({ baseUrl: API_URL });

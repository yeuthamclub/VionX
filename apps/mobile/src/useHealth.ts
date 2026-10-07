import type { HealthResponse } from '@vionx/contracts/client';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';

export type HealthState =
  | { kind: 'loading' }
  | { kind: 'ready'; health: HealthResponse }
  | { kind: 'offline'; message: string };

/** Calls GET /api/v1/health. A 503 still carries the health body describing what is down. */
export function useHealth() {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const { data, error } = await api.GET('/api/v1/health', { signal: controller.signal });
      clearTimeout(timer);
      const body = (data ?? error) as HealthResponse | undefined;
      if (body && 'checks' in body) setState({ kind: 'ready', health: body });
      else setState({ kind: 'offline', message: 'Unexpected response' });
    } catch (e) {
      setState({ kind: 'offline', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, refresh };
}

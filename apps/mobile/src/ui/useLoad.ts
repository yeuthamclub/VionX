import { useCallback, useEffect, useState } from 'react';

export type Loadable<T> =
  { kind: 'loading' } | { kind: 'error'; error: unknown } | { kind: 'ready'; data: T };

/** Loads data on mount (and on `reload`), tracking loading / error / ready. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<Loadable<T>>({ kind: 'loading' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(() => {
    setState({ kind: 'loading' });
    run().then(
      (data) => setState({ kind: 'ready', data }),
      (error: unknown) => setState({ kind: 'error', error }),
    );
  }, [run]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { state, reload, setState };
}

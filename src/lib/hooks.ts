import { useCallback, useEffect, useRef, useState } from 'react';

/** Load an async resource with manual reload. */
export function useQuery<T>(factory: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const factoryRef = useRef(factory);
  factoryRef.current = factory;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await factoryRef.current();
      if (alive.current) setData(result);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** Wrap an async action with busy/error state. */
export function useMutation<TArgs extends unknown[], T>(fn: (...args: TArgs) => Promise<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (...args: TArgs) => {
    setBusy(true);
    setError(null);
    try {
      return await fn(...args);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }, [fn]);
  return { run, busy, error, setError };
}

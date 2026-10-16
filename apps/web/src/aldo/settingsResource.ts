// Settings data lives for this tab, not for a mounted panel. Reopening a panel
// uses the last answer immediately; stale answers refresh in the background.
// Nothing is written to browser storage (the vault here is metadata only).
import { useEffect, useSyncExternalStore } from "react";

export function createSettingsResource<T>(
  read: (refresh?: boolean) => Promise<T>,
  staleMs = 30_000,
) {
  let snapshot: { data: T | undefined; error: string | null; cause: unknown; loading: boolean } = {
    data: undefined,
    error: null,
    cause: null,
    loading: false,
  };
  let loadedAt = 0;
  let version = 0;
  let pending: Promise<T> | null = null;
  let writes: Promise<void> = Promise.resolve();
  let writing = 0;
  let confirmed: T | undefined;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const set = (data: T) => {
    version++;
    pending = null;
    loadedAt = Date.now();
    snapshot = { data, error: null, cause: null, loading: false };
    notify();
  };
  const load = (force = false): Promise<T> => {
    if (pending) return pending;
    if (writing && snapshot.data !== undefined) return Promise.resolve(snapshot.data);
    if (!force && snapshot.data !== undefined && Date.now() - loadedAt < staleMs)
      return Promise.resolve(snapshot.data);
    const ticket = ++version;
    snapshot = { ...snapshot, loading: true };
    notify();
    const request = read(force)
      .then(
        (data) => {
          if (ticket === version) {
            loadedAt = Date.now();
            snapshot = { data, error: null, cause: null, loading: false };
            notify();
          }
          return data;
        },
        (cause: unknown) => {
          if (ticket === version) {
            snapshot = {
              ...snapshot,
              error: cause instanceof Error ? cause.message : String(cause),
              cause,
              loading: false,
            };
            notify();
          }
          throw cause;
        },
      )
      .finally(() => {
        if (ticket === version) pending = null;
      });
    pending = request;
    return request;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    set,
    /** Show the choice now, save in order, and restore the last confirmed answer on failure. */
    mutate: (optimistic: (data: T) => T, write: () => Promise<T>): Promise<T> => {
      if (snapshot.data === undefined)
        return Promise.reject(new Error("Settings haven't loaded yet."));
      if (!writing) confirmed = snapshot.data;
      writing++;
      set(optimistic(snapshot.data));
      const ticket = version;
      const task = writes.then(write);
      writes = task
        .then(
          (data) => {
            confirmed = data;
            if (ticket === version) set(data);
          },
          () => {
            if (ticket === version && confirmed !== undefined) set(confirmed);
          },
        )
        .finally(() => {
          writing--;
        });
      return task;
    },
    // A write or sign-in supersedes any read already in flight.
    refresh: () => {
      if (writing) return load();
      version++;
      pending = null;
      return load(true);
    },
  };
}

export function useSettingsResource<T>(
  resource: ReturnType<typeof createSettingsResource<T>>,
  enabled = true,
  refreshOnFocus = true,
) {
  const snapshot = useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot,
  );
  useEffect(() => {
    if (!enabled) return;
    const load = () => {
      void resource.load().catch(() => undefined);
    };
    load();
    if (refreshOnFocus) window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [enabled, refreshOnFocus, resource]);
  return snapshot;
}

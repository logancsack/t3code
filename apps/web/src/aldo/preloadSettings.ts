// Whether Aldo starts cloud agents ahead of use (see preload.ts). Saved per
// browser; both are on unless the user turns them off.

import { useSyncExternalStore } from "react";

export interface AldoPreloadSettings {
  /** Create a new thread's cloud agent as soon as the thread opens. */
  readonly newThreads: boolean;
  /** Wake a thread's cloud agent as soon as the thread is opened. */
  readonly openedThreads: boolean;
}

const STORAGE_KEY = "aldo:preload";
const DEFAULTS: AldoPreloadSettings = { newThreads: true, openedThreads: true };
const listeners = new Set<() => void>();

function read(): AldoPreloadSettings {
  try {
    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as Partial<AldoPreloadSettings>;
    return {
      newThreads: typeof stored.newThreads === "boolean" ? stored.newThreads : DEFAULTS.newThreads,
      openedThreads:
        typeof stored.openedThreads === "boolean" ? stored.openedThreads : DEFAULTS.openedThreads,
    };
  } catch {
    return DEFAULTS;
  }
}

let current = read();

export function getAldoPreloadSettings(): AldoPreloadSettings {
  return current;
}

export function setAldoPreloadSettings(patch: Partial<AldoPreloadSettings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Kept for this session only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAldoPreloadSettings(): AldoPreloadSettings {
  return useSyncExternalStore(subscribe, getAldoPreloadSettings, getAldoPreloadSettings);
}

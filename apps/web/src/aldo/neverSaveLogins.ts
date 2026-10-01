// Sites the user said never to offer saving a login for (the Browser panel's
// "Never for this site"), kept per browser. Settings → Vault lists them, to
// offer again.

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "aldo:never-save-logins";
const listeners = new Set<() => void>();

function read(): ReadonlySet<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return new Set(
      Array.isArray(stored) ? stored.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}

let current = read();
const NONE: ReadonlySet<string> = new Set();

function write(next: ReadonlySet<string>): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // Kept for this session only.
  }
  for (const listener of listeners) listener();
}

/** Stop offering to save logins for `origin` in this browser. */
export function neverSaveLoginsFor(origin: string): void {
  write(new Set(current).add(origin));
}

/** Offer to save logins for `origin` again. */
export function offerSavingLoginsFor(origin: string): void {
  const next = new Set(current);
  next.delete(origin);
  write(next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAldoNeverSaveLogins(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => NONE,
  );
}

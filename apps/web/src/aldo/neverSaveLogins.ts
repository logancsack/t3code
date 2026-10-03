// Sites the user said never to offer saving a login for (the Browser panel's
// "Never for this site"). Aldo keeps them for the user (/api/vault/never-save),
// so no thread's browser offers a sign-in there, on any device. An Aldo from
// before that has nowhere to keep them, so this browser does, and gives them to
// Aldo once it can. Settings → Vault lists them, to offer again.

import { useSyncExternalStore } from "react";

import { AldoApiError, aldoVault } from "./cloud";

const STORAGE_KEY = "aldo:never-save-logins";
const listeners = new Set<() => void>();

export interface AldoNeverSaveLogins {
  readonly origins: ReadonlySet<string>;
  /** Kept by Aldo for the user, not by this browser alone. */
  readonly synced: boolean;
}

function readLocal(): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return new Set(
      Array.isArray(stored) ? stored.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function writeLocal(origins: ReadonlySet<string>): void {
  try {
    if (origins.size) localStorage.setItem(STORAGE_KEY, JSON.stringify([...origins]));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Kept for this session only.
  }
}

let current: AldoNeverSaveLogins = { origins: readLocal(), synced: false };
const NONE: AldoNeverSaveLogins = { origins: new Set(), synced: false };
let loading: Promise<void> | null = null;
let loaded = false;

function set(next: AldoNeverSaveLogins): void {
  current = next;
  for (const listener of listeners) listener();
}

/** An Aldo from before it kept them: no such route (or only the vault item one). */
const olderAldo = (cause: unknown) =>
  cause instanceof AldoApiError && (cause.status === 404 || cause.status === 405);

/** Reads Aldo's list, giving it what this browser kept. */
export function refreshAldoNeverSaveLogins(): Promise<void> {
  loaded = true;
  loading ??= (async () => {
    try {
      const origins = new Set(await aldoVault.neverSave());
      const kept = new Set<string>();
      for (const origin of readLocal()) {
        if (origins.has(origin)) continue;
        // One Aldo couldn't take stays here, and goes with the next read.
        await aldoVault.setNeverSave(origin, true).then(
          () => origins.add(origin),
          () => kept.add(origin),
        );
      }
      writeLocal(kept);
      set({ origins: new Set([...origins, ...kept]), synced: true });
    } catch (cause) {
      // Otherwise (offline, a hiccup) the list stays as it was until the next read.
      if (olderAldo(cause)) set({ origins: readLocal(), synced: false });
    }
  })().finally(() => {
    loading = null;
  });
  return loading;
}

/** Stops offering to save logins for `origin`: everywhere, or in this browser when Aldo can't keep it. */
export async function neverSaveLoginsFor(origin: string): Promise<void> {
  set({ ...current, origins: new Set(current.origins).add(origin) });
  try {
    await aldoVault.setNeverSave(origin, true);
  } catch {
    writeLocal(readLocal().add(origin));
  }
}

/** Offers to save logins for `origin` again. Throws if Aldo couldn't be told. */
export async function offerSavingLoginsFor(origin: string): Promise<void> {
  const local = readLocal();
  if (local.delete(origin)) writeLocal(local);
  if (current.synced) await aldoVault.setNeverSave(origin, false);
  const origins = new Set(current.origins);
  origins.delete(origin);
  set({ ...current, origins });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!loaded) void refreshAldoNeverSaveLogins();
  return () => listeners.delete(listener);
}

export function useAldoNeverSaveLogins(): AldoNeverSaveLogins {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => NONE,
  );
}

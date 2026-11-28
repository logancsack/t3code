// Whether this account sees the developer tools: pull requests, Code
// settings, and the Terminal and Diff in a thread (onboarding.logic.ts). Away
// from Aldo, and for accounts that never had the welcome, they're always
// there; a git host's connection is read only for an answer without code.
// Users can also turn them on or off explicitly in Preferences (saved per
// device, overriding the welcome/git-host default).

import { useSyncExternalStore } from "react";

import { isAldoCloud } from "./api";
import { type AldoHostKind } from "./accountApi";
import { useAldoInterests } from "./onboarding";
import { aldoDeveloperToolsShown } from "./onboarding.logic";
import { settingsAccounts } from "./settingsData";
import { useSettingsResource } from "./settingsResource";

const GIT_HOSTS: ReadonlyArray<AldoHostKind> = ["github", "gitlab", "bitbucket", "azure"];
const ALDO_DEVELOPER_TOOLS_STORAGE_KEY = "aldo:developer-tools";

const listeners = new Set<() => void>();

function readOverride(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ALDO_DEVELOPER_TOOLS_STORAGE_KEY);
    if (raw === "on") return true;
    if (raw === "off") return false;
    return null;
  } catch {
    return null;
  }
}

let cachedOverride: boolean | null = readOverride();

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== ALDO_DEVELOPER_TOOLS_STORAGE_KEY) return;
  const next = readOverride();
  if (next === cachedOverride) return;
  cachedOverride = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (typeof window !== "undefined" && listeners.size === 0) {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined" && listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function getAldoDeveloperToolsOverride(): boolean | null {
  return cachedOverride;
}

/** Explicitly turns developer tools on or off on this device; null restores automatic behavior. */
export function setAldoDeveloperTools(next: boolean | null): void {
  cachedOverride = next;
  try {
    if (next === null) window.localStorage.removeItem(ALDO_DEVELOPER_TOOLS_STORAGE_KEY);
    else window.localStorage.setItem(ALDO_DEVELOPER_TOOLS_STORAGE_KEY, next ? "on" : "off");
  } catch {
    // Kept for this session only.
  }
  for (const listener of listeners) listener();
}

/** Whether they're shown; undefined while that isn't known yet. */
export function useAldoDeveloperToolsState(): boolean | undefined {
  const override = useSyncExternalStore(subscribe, getAldoDeveloperToolsOverride, () => null);
  const interests = useAldoInterests();
  const asks = override === null && interests != null && !interests.includes("code");
  const accounts = useSettingsResource(settingsAccounts, asks, false).data;
  if (!isAldoCloud) return true;
  if (override !== null) return override;
  const gitHost = accounts ? GIT_HOSTS.some((kind) => accounts[kind]?.connected === true) : null;
  return aldoDeveloperToolsShown({ interests, gitHost });
}

/** Whether to show them now: not while that isn't known. */
export function useAldoDeveloperTools(): boolean {
  return useAldoDeveloperToolsState() === true;
}

/** The shortcuts that open the Terminal or the Diff in a thread, which wait with them. */
export const ALDO_DEVELOPER_COMMANDS: ReadonlySet<string> = new Set([
  "terminal.toggle",
  "terminal.split",
  "terminal.splitVertical",
  "terminal.new",
  "diff.toggle",
]);

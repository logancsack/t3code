// The user's T3 settings that Aldo keeps (machineSettings.logic.ts), as this
// tab last had them: loaded at start and again as the page shows (another
// device may have changed one), and changed at once as Settings saves one.
// Sleeping machines' cached configs take them too (shells.ts), so a new
// thread there starts as the machine will once it wakes.

import { useSyncExternalStore } from "react";

import { toastManager } from "../components/ui/toast";
import { fetchAldoMachineSettings, isAldoCloud, saveAldoMachineSettings } from "./cloud";
import {
  aldoMachineSettingsOf,
  type AldoMachineSettings,
  type AldoSettingsScope,
} from "./machineSettings.logic";

/** Null until Aldo answers, and from an Aldo that doesn't keep them: Settings works as before. */
let kept: AldoMachineSettings | null = null;
/** Counts the changes made here, so an answer a later change overtook isn't applied. */
let version = 0;
let loadedAt = 0;
let firstLoad: Promise<void> | null = null;
const listeners = new Set<() => void>();
const STALE_MS = 60_000;

function set(next: AldoMachineSettings | null): void {
  kept = next;
  for (const listener of listeners) listener();
}

async function load(): Promise<void> {
  const before = version;
  try {
    const raw = await fetchAldoMachineSettings();
    loadedAt = Date.now();
    if (version === before) set(raw === null ? null : aldoMachineSettingsOf(raw));
  } catch {
    // As they were; asked again as the page next shows.
  }
}

/** Loads them at start, and again when the page shows after a while away. */
export function installAldoMachineSettings(): void {
  if (!isAldoCloud) return;
  firstLoad = load();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - loadedAt > STALE_MS) void load();
  });
}

/** The user's kept settings once Aldo has answered (null from an Aldo without them). */
export async function loadAldoMachineSettings(): Promise<AldoMachineSettings | null> {
  if (!isAldoCloud) return null;
  firstLoad ??= load();
  await firstLoad;
  return kept;
}

/** Calls `listener` whenever they change. */
export function subscribeAldoMachineSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAldoMachineSettings(): AldoMachineSettings | null {
  return kept;
}

export function useAldoMachineSettings(): AldoMachineSettings | null {
  return useSyncExternalStore(
    subscribeAldoMachineSettings,
    getAldoMachineSettings,
    getAldoMachineSettings,
  );
}

/**
 * Saves the patch's kept settings to Aldo as well, when Settings saves the
 * user's (`aldo`, at "All environments"): `plan` still writes the machines
 * that are connected. A plan with nowhere to write its server keys is
 * returned as saved when Aldo keeps all of them.
 */
export function keepAldoMachineSettings<
  P extends { readonly clientPatch: object; readonly unavailableReason: string | null },
>(aldo: AldoSettingsScope | null, patch: object, plan: P): P {
  if (!aldo || kept === null) return plan;
  const changed = aldoMachineSettingsOf(patch);
  if (Object.keys(changed).length === 0) return plan;
  const mine = ++version;
  set({ ...kept, ...changed });
  saveAldoMachineSettings(changed)
    .then((saved) => {
      if (version === mine) set(aldoMachineSettingsOf(saved));
    })
    .catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Setting not saved for every thread",
        description: error instanceof Error ? error.message : String(error),
      });
      void load();
    });
  const serverKeys = Object.keys(patch).filter((key) => !Object.hasOwn(plan.clientPatch, key));
  return serverKeys.every((key) => Object.hasOwn(changed, key))
    ? { ...plan, unavailableReason: null }
    : plan;
}

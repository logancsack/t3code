// A sleeping machine's thread opens with its messages on any device, without
// waking it. T3 shows a thread from its live connection or, when it isn't
// connected, from this browser's copy (its thread cache); a browser that never
// had the thread open while its machine ran had none, so the thread stayed
// "loading" and nothing could be sent to it. Aldo keeps each thread's detail as
// its machine last reported it. When T3 opens a thread whose machine isn't
// connected, it reads Aldo's copy if that's newer than the cache, and caches
// it (connection/storage.ts). A thread neither has (its machine hasn't run
// since machines began reporting them) wakes its machine once to load
// (preload.ts), and the machine then reports it.

import type { EnvironmentId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "../state/presentation";
import {
  aldoMachineIsNew,
  fetchAldoThreadDetail,
  isAldoCloud,
  isAldoEnvironmentId,
  setAldoThreadDetailSource,
} from "./cloud";
import { readAldoThreadDetail } from "./threadDetails.logic";

/** A thread still opens (as "loading") if Aldo doesn't answer by then. */
const FETCH_TIMEOUT_MS = 5_000;

/** Threads that neither Aldo nor this browser had a detail of when T3 last opened them. */
const missing = new Set<string>();
const listeners = new Set<() => void>();

function keyOf(environmentId: string, threadId: string): string {
  return `${environmentId}\u0000${threadId}`;
}

function setMissing(key: string, value: boolean): void {
  if (missing.has(key) === value) return;
  if (value) missing.add(key);
  else missing.delete(key);
  for (const listener of listeners) listener();
}

function isConnected(environmentId: string): boolean {
  const presentation = appAtomRegistry
    .get(environmentPresentations.presentationsAtom)
    .get(environmentId as EnvironmentId);
  return presentation?.connection.phase === "connected";
}

async function newerDetail(
  environmentId: string,
  threadId: string,
  cachedSequence: number | null,
): Promise<unknown> {
  // A connected machine shows the thread itself; one not created yet has nothing to show.
  if (
    !isAldoEnvironmentId(environmentId) ||
    isConnected(environmentId) ||
    aldoMachineIsNew(environmentId)
  ) {
    return null;
  }
  const response = await fetchAldoThreadDetail(
    environmentId,
    threadId,
    cachedSequence,
    AbortSignal.timeout(FETCH_TIMEOUT_MS),
  ).catch(() => null);
  // An Aldo without copies, or out of reach, says nothing either way.
  if (!response) return null;
  const { detail, missing: none } = readAldoThreadDetail(cachedSequence, response);
  setMissing(keyOf(environmentId, threadId), none);
  return detail;
}

/** Lets T3's thread cache open threads from Aldo's copies. */
export function installAldoThreadDetails(): void {
  if (!isAldoCloud) return;
  setAldoThreadDetailSource(newerDetail);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether neither Aldo nor this browser had this thread's detail when it was opened. */
export function useAldoThreadDetailMissing(
  environmentId: string | null,
  threadId: string | null,
): boolean {
  const read = () =>
    environmentId !== null && threadId !== null && missing.has(keyOf(environmentId, threadId));
  return useSyncExternalStore(subscribe, read, read);
}

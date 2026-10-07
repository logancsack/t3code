// How Aldo's start of a thread stands, from the directory (cloud.ts), for the
// thread (AldoThreadLoading.tsx) and the sidebar to show instead of an empty
// thread "Working". The words are threadStart.logic.ts's.

import { useMemo, useSyncExternalStore } from "react";

import {
  getAldoEnvironments,
  isAldoCloud,
  isAldoEnvironmentId,
  subscribeAldoEnvironments,
  type AldoEnvironment,
  type AldoStartState,
} from "./cloud";
import { describeAldoThreadStart, type AldoThreadStartView } from "./threadStart.logic";

function environmentOf(environmentId: string): AldoEnvironment | null {
  return getAldoEnvironments()?.find((entry) => entry.environmentId === environmentId) ?? null;
}

const subscribeNever = () => () => undefined;

/**
 * Aldo's start of this thread, in words; null when Aldo isn't starting it.
 * Rows read only their start and their machine's state, so a directory fetch
 * re-renders the threads that are starting, not every row.
 */
export function useAldoThreadStart(
  environmentId: string | null,
  threadId: string | null,
): AldoThreadStartView | null {
  const applies =
    isAldoCloud &&
    environmentId !== null &&
    threadId !== null &&
    isAldoEnvironmentId(environmentId);
  const subscribe = applies ? subscribeAldoEnvironments : subscribeNever;
  const readStart = (): AldoStartState | null =>
    applies ? (environmentOf(environmentId)?.starts?.[threadId] ?? null) : null;
  const start = useSyncExternalStore(subscribe, readStart, readStart);
  const readMachine = (): AldoEnvironment["state"] | null =>
    applies && start ? (environmentOf(environmentId)?.state ?? null) : null;
  const machine = useSyncExternalStore(subscribe, readMachine, readMachine);
  return useMemo(() => {
    if (!start || environmentId === null) return null;
    const environment = environmentOf(environmentId);
    return describeAldoThreadStart({
      start,
      machine,
      repos: environment ? (environment.repos ?? [environment.repo]) : [],
    });
  }, [environmentId, machine, start]);
}

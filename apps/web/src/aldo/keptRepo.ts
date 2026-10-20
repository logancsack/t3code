// A thread whose repository Aldo keeps (General's folder, or one of the
// user's projects: a business, a process, a trip) isn't software work, so the
// thread leaves out what's only about code: branches, pull requests, git
// actions, editors and project scripts.

import { useSyncExternalStore } from "react";

import { aldoThreadInGeneral, aldoThreadInKeptRepo, subscribeAldoEnvironments } from "./directory";
import { isAldoCloud } from "./api";
import { useAldoSimpleMode } from "./simpleMode";

/** Whether this machine's thread works in a repository Aldo keeps (always false outside Aldo). */
export function useAldoKeptRepo(environmentId: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribeAldoEnvironments,
    () => isAldoCloud && !!environmentId && aldoThreadInKeptRepo(environmentId),
    () => false,
  );
}

/** Whether this machine's thread works in General, outside any repository or project (always false outside Aldo). */
export function useAldoGeneral(environmentId: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribeAldoEnvironments,
    () => isAldoCloud && !!environmentId && aldoThreadInGeneral(environmentId),
    () => false,
  );
}

/**
 * Whether a thread shows its work quietly, in plain words and folded between
 * messages: in a repository Aldo keeps, or anywhere in Simple mode (always
 * false outside Aldo). Code threads keep the full work log.
 */
export function useAldoQuietWork(environmentId: string | null | undefined): boolean {
  const kept = useAldoKeptRepo(environmentId);
  const simple = useAldoSimpleMode();
  return kept || (isAldoCloud && simple);
}

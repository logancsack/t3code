// A thread whose repository Aldo keeps (General's folder, or one of the
// user's projects: a business, a process, a trip) isn't software work, so the
// thread leaves out what's only about code: branches, pull requests, git
// actions, editors and project scripts.

import { useSyncExternalStore } from "react";

import { aldoThreadInKeptRepo, isAldoCloud, subscribeAldoEnvironments } from "./cloud";

/** Whether this machine's thread works in a repository Aldo keeps (always false outside Aldo). */
export function useAldoKeptRepo(environmentId: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribeAldoEnvironments,
    () => isAldoCloud && !!environmentId && aldoThreadInKeptRepo(environmentId),
    () => false,
  );
}

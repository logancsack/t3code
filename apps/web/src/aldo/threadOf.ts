// A thread's place in the directory, by its computer: to link to the thread
// a share came from (the Library), or to go there and ask for a change (the
// viewer).

import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useCallback, useSyncExternalStore } from "react";

import { getAldoEnvironments, subscribeAldoEnvironments } from "./directory";

export function useAldoThreadOf(): (environmentId: string | undefined) => {
  readonly label: string;
  readonly threadRef: ScopedThreadRef;
} | null {
  const environments = useSyncExternalStore(
    subscribeAldoEnvironments,
    getAldoEnvironments,
    () => null,
  );
  return useCallback(
    (environmentId) => {
      const environment = environmentId
        ? environments?.find((entry) => entry.environmentId === environmentId)
        : undefined;
      return environment
        ? {
            label: environment.label,
            threadRef: {
              environmentId: environment.environmentId as EnvironmentId,
              threadId: environment.threadId as ThreadId,
            },
          }
        : null;
    },
    [environments],
  );
}

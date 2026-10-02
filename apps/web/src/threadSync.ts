import type { EnvironmentShellStatus } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";

export type ThreadSyncPhase = "loading" | "syncing";

export function resolveThreadSyncPhase(input: {
  readonly detailExists: boolean;
  readonly shellExists: boolean;
  readonly status: EnvironmentThreadStatus;
}): ThreadSyncPhase | null {
  if (!input.shellExists) {
    return null;
  }

  switch (input.status) {
    case "empty":
    case "cached":
    case "synchronizing":
      return input.detailExists ? "syncing" : "loading";
    case "deleted":
    case "live":
      return null;
  }
}

export function threadSyncLabel(phase: ThreadSyncPhase): string {
  return phase === "loading" ? "Loading messages..." : "Syncing messages...";
}

/**
 * Whether a thread taken for deleted should be followed again: the server's
 * live shell lists it, so it exists. A thread asked for before it existed (its
 * first message still on its way, its cloud agent still coming up) is taken
 * for deleted after a few "not found"s in a row, and is no longer followed
 * even once it exists, so its route showed the draft it was sent from.
 */
export function shouldRefollowThread(input: {
  readonly status: EnvironmentThreadStatus;
  readonly shellExists: boolean;
  readonly environmentShellStatus: EnvironmentShellStatus | undefined;
}): boolean {
  return input.status === "deleted" && input.shellExists && input.environmentShellStatus === "live";
}

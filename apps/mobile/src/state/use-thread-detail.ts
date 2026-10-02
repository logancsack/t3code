import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentShellStatus,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  refollowThreadOnce,
  shouldRefollowThread,
  type EnvironmentThreadState,
} from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";
import { useEffect } from "react";

import { scopedThreadKey } from "../lib/scopedEntities";
import { appAtomRegistry } from "./atom-registry";
import { environmentShell } from "./shell";
import { environmentThreads, useEnvironmentThread } from "./threads";
import { useThreadSelection } from "./use-thread-selection";

const NO_SHELL_STATUS_ATOM = Atom.make<EnvironmentShellStatus | undefined>(undefined).pipe(
  Atom.withLabel("mobile-shell-status:none"),
);
const shellStatusAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get): EnvironmentShellStatus | undefined =>
      get(environmentShell.stateValueAtom(environmentId)).status,
  ).pipe(Atom.withLabel(`mobile-shell-status:${environmentId}`)),
);

export interface ThreadDetailTarget {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}

export function useThreadDetail(target: ThreadDetailTarget) {
  return useEnvironmentThread(target.environmentId, target.threadId);
}

export function useSelectedThreadDetailState() {
  const { selectedThread } = useThreadSelection();
  return useThreadDetail({
    environmentId: selectedThread?.environmentId ?? null,
    threadId: selectedThread?.id ?? null,
  });
}

export function useSelectedThreadDetail() {
  return Option.getOrNull(useSelectedThreadDetailState().data);
}

/**
 * Follows a thread taken for deleted again once the server lists it
 * (shouldRefollowThread). Returns whether it's being followed again, for the
 * thread to show as loading meanwhile rather than unavailable.
 */
export function useRefollowListedThread(
  thread: EnvironmentThreadShell | null,
  state: EnvironmentThreadState,
): boolean {
  const environmentId = thread?.environmentId ?? null;
  const threadId = thread?.id ?? null;
  const shellStatus = useAtomValue(
    environmentId === null ? NO_SHELL_STATUS_ATOM : shellStatusAtom(environmentId),
  );
  const refollow = shouldRefollowThread({ state, listed: thread !== null, shellStatus });
  const version = thread?.updatedAt ?? null;
  useEffect(() => {
    if (!refollow || environmentId === null || threadId === null || version === null) return;
    refollowThreadOnce(scopedThreadKey(environmentId, threadId), version, () =>
      appAtomRegistry.refresh(environmentThreads.stateAtom(environmentId, threadId)),
    );
  }, [environmentId, refollow, threadId, version]);
  return refollow;
}

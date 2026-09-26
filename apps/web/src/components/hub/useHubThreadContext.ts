import type {
  EnvironmentId,
  OrchestrationLatestTurn,
  RepositoryIdentity,
  ThreadId,
} from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useMemo, useState } from "react";

import { HUB_DEFAULT_BASE_REF, useIsHubEnvironment } from "../../hubMode";
import { useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { deriveThreadMachineView, type ThreadMachineView } from "../../threadMachine";
import type { ComposerBannerStackItem } from "../chat/ComposerBannerStack";
import { buildThreadMachineBannerItem } from "../ThreadMachineStatus";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { requestThreadMachineWake, THREAD_MACHINE_WAKE_SUPPORTED } from "./threadMachineActions";

export interface HubThreadContext {
  /** The thread's environment is a hub: every thread runs on its own machine. */
  readonly hub: boolean;
  /** A hub draft: its machine does not exist until the first send. */
  readonly draftWithoutMachine: boolean;
  /** Machine-backed surfaces (terminals, files, scripts) make sense for this thread. */
  readonly workspaceAvailable: boolean;
  /** A hub draft is a repository exactly when its project records one. */
  readonly isGitRepoOverride: boolean | null;
  /** Every hub thread gets a fresh checkout on its own machine. */
  readonly forcedEnvMode: "worktree" | null;
  /** Base ref sent when the user picked none. */
  readonly defaultBaseRef: string | null;
  readonly machineView: ThreadMachineView | null;
  readonly machineTransitional: boolean;
  /** Progress text while the machine is preparing or starting. */
  readonly machineDetail: string | null;
  /** The machine cannot serve reads right now (asleep or failed). */
  readonly machineUnavailable: boolean;
  readonly machineBannerItem: ComposerBannerStackItem | null;
  /** Say so when an action (opening a terminal) is about to wake the machine. */
  readonly announceMachineWake: () => void;
}

export interface HubThreadContextInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly isServerThread: boolean;
  readonly projectRepositoryIdentity: RepositoryIdentity | null | undefined;
  readonly latestTurn: Pick<OrchestrationLatestTurn, "turnId" | "state"> | null;
}

/** Pure part of the context, shared with tests. */
export function resolveHubThreadContext(input: {
  readonly hub: boolean;
  readonly isServerThread: boolean;
  readonly projectRepositoryIdentity: RepositoryIdentity | null | undefined;
  readonly machineView: ThreadMachineView | null;
}): Omit<HubThreadContext, "machineBannerItem" | "announceMachineWake"> {
  const { hub, machineView } = input;
  const draftWithoutMachine = hub && !input.isServerThread;
  const machineTransitional = hub && machineView?.phase === "transitional";
  return {
    hub,
    draftWithoutMachine,
    workspaceAvailable: !draftWithoutMachine,
    isGitRepoOverride: draftWithoutMachine ? input.projectRepositoryIdentity != null : null,
    forcedEnvMode: hub ? "worktree" : null,
    defaultBaseRef: hub ? HUB_DEFAULT_BASE_REF : null,
    machineView: hub ? machineView : null,
    machineTransitional,
    machineDetail: machineTransitional ? (machineView?.detail ?? null) : null,
    machineUnavailable: hub && (machineView?.phase === "asleep" || machineView?.phase === "failed"),
  };
}

const dismissedMachineBanners = new Set<string>();

/**
 * Everything ChatView needs to know about hub mode for the active thread, so
 * the view itself only swaps values at the points where hub threads differ.
 */
export function useHubThreadContext(input: HubThreadContextInput): HubThreadContext {
  const hub = useIsHubEnvironment(input.environmentId);
  const threadRef = useMemo(
    () =>
      hub && input.isServerThread && input.threadId
        ? scopeThreadRef(input.environmentId, input.threadId)
        : null,
    [hub, input.environmentId, input.isServerThread, input.threadId],
  );
  const machine = useThreadShell(threadRef)?.machine;
  const machineView = useMemo(() => deriveThreadMachineView(machine), [machine]);
  const base = resolveHubThreadContext({
    hub,
    isServerThread: input.isServerThread,
    projectRepositoryIdentity: input.projectRepositoryIdentity,
    machineView,
  });

  const retryTurn = useAtomCommand(threadEnvironment.retryTurn, { reportFailure: false });
  const [retrying, setRetrying] = useState(false);
  const [, setDismissTick] = useState(0);
  const failedTurnId = input.latestTurn?.state === "error" ? input.latestTurn.turnId : null;
  const canRetry =
    base.machineView?.phase === "failed" &&
    threadRef !== null &&
    (failedTurnId !== null || THREAD_MACHINE_WAKE_SUPPORTED);
  const onRetry = useCallback(() => {
    if (!threadRef) return;
    setRetrying(true);
    void (async () => {
      if (failedTurnId !== null) {
        // Re-driving the failed turn wakes (or recreates) the machine.
        const result = await retryTurn({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, turnId: failedTurnId },
        });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not retry",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      } else {
        await requestThreadMachineWake(threadRef);
      }
      setRetrying(false);
    })();
  }, [failedTurnId, retryTurn, threadRef]);

  const threadKey = threadRef ? scopedThreadKey(threadRef) : null;
  const bannerView = base.machineView;
  const bannerId = threadKey && bannerView ? `${threadKey}:${bannerView.state}` : null;
  // Re-read on every render; dismissing bumps the tick to trigger one.
  const bannerDismissed = bannerId !== null && dismissedMachineBanners.has(bannerId);
  const machineBannerItem = useMemo(() => {
    if (threadKey === null || bannerId === null || bannerDismissed) return null;
    return buildThreadMachineBannerItem({
      threadKey,
      view: bannerView,
      onRetry: canRetry ? onRetry : null,
      retrying,
      onDismiss: () => {
        dismissedMachineBanners.add(bannerId);
        setDismissTick((tick) => tick + 1);
      },
    });
  }, [bannerDismissed, bannerId, bannerView, canRetry, onRetry, retrying, threadKey]);

  const machineWakes = base.machineView !== null && base.machineView.phase !== "running";
  const announceMachineWake = useCallback(() => {
    if (!machineWakes) return;
    toastManager.add(
      stackedThreadToast({
        type: "info",
        title: "Waking this thread's machine",
        description: "The terminal connects as soon as it is running.",
        timeout: 5_000,
      }),
    );
  }, [machineWakes]);

  return { ...base, machineBannerItem, announceMachineWake };
}

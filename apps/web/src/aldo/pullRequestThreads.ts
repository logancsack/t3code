// Every action on an owned pull request goes back to its original conversation.

import {
  EnvironmentId,
  ThreadId,
  type ScopedThreadRef,
  type ScopedProjectRef,
} from "@t3tools/contracts";

import { toastManager } from "../components/ui/toast";
import type { DraftId } from "../composerDraftStore";
import { aldoReusesPullRequestThreads } from "./directory";
import { api, threadIdForEnvironment } from "./api";
import {
  aldoOpensPullRequestThread,
  aldoPullRequestThreadOpened,
  aldoPullRequestThreadRequest,
  type AldoPullRequestShown,
} from "./pullRequestThreads.logic";

export { ALDO_PULL_REQUEST_CHECKOUT } from "./pullRequestThreads.logic";

/** Whether the panel offers to check this pull request out (aldoOpensPullRequestThread). */
export function aldoOpensThreadOn(
  pullRequest: Pick<AldoPullRequestShown, "state"> | null,
): boolean {
  return aldoOpensPullRequestThread(aldoReusesPullRequestThreads(), pullRequest);
}

/**
 * Opens a thread on the pull request, in the repositories of the machine the
 * panel reads it from, with `openThread` (the panel's new-thread handler,
 * which opens the draft on the machine just recorded), and puts the task in
 * its composer with `land`: null for none, a checkout.
 */
export async function openAldoPullRequestThread(
  fromEnvironmentId: string,
  pullRequest: AldoPullRequestShown,
  openThread: (projectRef: ScopedProjectRef) => Promise<{ readonly draftId: DraftId } | null>,
  land: ((target: DraftId | ScopedThreadRef) => void) | null,
  reuse: (target: ScopedThreadRef) => Promise<void> | void,
): Promise<void> {
  // The panel hides its checkout from an Aldo that would put the thread on a branch of its own;
  // a finding's Fix button is still there.
  if (!aldoReusesPullRequestThreads()) {
    toastManager.add({
      type: "error",
      title: "Aldo can't open a thread on a pull request yet",
      description: "Reload in a few minutes, once Aldo has updated.",
    });
    return;
  }
  const toastId = toastManager.add({
    type: "loading",
    title: "Opening the pull request's thread...",
  });
  try {
    const result = await api<{ owner: { environmentId: string; threadId: string | null } | null }>(
      `/api/environments/${encodeURIComponent(threadIdForEnvironment(fromEnvironmentId))}/prs?url=${encodeURIComponent(pullRequest.url)}`,
    );
    if (!Object.hasOwn(result, "owner"))
      throw new Error("Aldo cannot resolve PR ownership yet. Reload once the server has updated.");
    const { owner } = result;
    if (owner) {
      if (!owner.threadId)
        throw new Error(
          "The original conversation is unavailable. Restore it in its original thread.",
        );
      const target = {
        environmentId: EnvironmentId.make(owner.environmentId),
        threadId: ThreadId.make(owner.threadId),
      };
      land?.(target);
      await reuse(target);
      toastManager.update(toastId, {
        type: "success",
        title: "Opened the original thread",
        description: land
          ? "The task is in the composer — read it over, then send."
          : "All work on this change stays here.",
      });
      return;
    }
    if (pullRequest.state !== "open")
      throw new Error(
        `This pull request is ${pullRequest.state} and has no original thread to continue.`,
      );
  } catch (error) {
    toastManager.update(toastId, {
      type: "error",
      title: "Could not open the PR thread",
      description: error instanceof Error ? error.message : "Try again.",
    });
    return;
  }
  // Loaded here, so the panel (and its upstream tests) don't import Aldo's machines with it.
  // When Aldo doesn't record the thread (a fork's pull request, say), startAldoSandbox says why.
  const { discardAldoSandbox, startAldoSandbox } = await import("./threads");
  const projectRef = await startAldoSandbox(
    aldoPullRequestThreadRequest(fromEnvironmentId, pullRequest),
  ).catch(() => null);
  if (projectRef === null) {
    toastManager.close(toastId);
    return;
  }
  const opened = await openThread(projectRef).catch(() => null);
  if (opened === null) {
    // Recorded for this thread alone: no other thread takes a pull request's machine.
    void discardAldoSandbox(projectRef.environmentId).catch(() => undefined);
    toastManager.update(toastId, {
      type: "error",
      title: "Could not open the thread",
      description: "Try again from the pull request.",
    });
    return;
  }
  land?.(opened.draftId);
  toastManager.update(toastId, {
    type: "success",
    ...aldoPullRequestThreadOpened(land !== null, pullRequest.headBranch),
  });
}

// The pull request panel's Check out, Fix and Resolve conflicts in Aldo. T3
// checks the pull request out on the machine the panel reads it from, which
// is another thread's; in Aldo each opens a thread of its own instead, on a
// machine of its own that Aldo puts on the pull request's branch as it starts
// (Aldo refuses one from a fork, whose branch isn't in the repository, and
// one that isn't open). As in T3, a task waits in the new thread's composer
// to be read over and sent: T3's own send, so its agent gets the same first
// message, review comments and all.

import type { ScopedProjectRef } from "@t3tools/contracts";

import { toastManager } from "../components/ui/toast";
import type { DraftId } from "../composerDraftStore";
import { aldoStartsPullRequestThreads } from "./cloud";
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
  return aldoOpensPullRequestThread(aldoStartsPullRequestThreads(), pullRequest);
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
  land: ((draftId: DraftId) => void) | null,
): Promise<void> {
  // The panel hides its checkout from an Aldo that would put the thread on a branch of its own;
  // a finding's Fix button is still there.
  if (!aldoStartsPullRequestThreads()) {
    toastManager.add({
      type: "error",
      title: "Aldo can't open a thread on a pull request yet",
      description: "Reload in a few minutes, once Aldo has updated.",
    });
    return;
  }
  // Aldo works only on an open one: a finding's Fix is still there on one that's merged or closed.
  if (pullRequest.state !== "open") {
    toastManager.add({
      type: "error",
      title: `This pull request is ${pullRequest.state}`,
      description: "A thread works only on an open pull request's branch.",
    });
    return;
  }
  const toastId = toastManager.add({
    type: "loading",
    title: "Opening a thread on the pull request's branch...",
  });
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

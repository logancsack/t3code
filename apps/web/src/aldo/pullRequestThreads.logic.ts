// What a pull request's Check out, Fix and Resolve conflicts ask Aldo for,
// and what they say, in Aldo (pullRequestThreads.ts). Pure, so it's tested on
// its own.

import { type AldoPullRequestBranch } from "./directory";

/** The pull request as the panel has it, summary or detail. */
export interface AldoPullRequestShown {
  readonly number: number;
  readonly headBranch: string;
  readonly state: string;
}

/** The checkout menu's one item in Aldo, in place of T3's worktree and "In this repository". */
export const ALDO_PULL_REQUEST_CHECKOUT = {
  label: "In a new thread",
  detail: "On a computer of its own, on the pull request's branch.",
} as const;

/**
 * Whether these open a thread on the pull request: Aldo has to start threads
 * on a pull request's branch, and works only on an open one.
 */
export function aldoOpensPullRequestThread(
  aldoStartsThem: boolean,
  pullRequest: Pick<AldoPullRequestShown, "state"> | null,
): boolean {
  return aldoStartsThem && pullRequest?.state === "open";
}

/**
 * What startAldoSandbox is asked for: a machine in the repositories of the
 * thread the panel reads the pull request from, on the pull request's branch.
 * The branch the panel showed goes along, so Aldo refuses a pull request of
 * the same number in another repository.
 */
export function aldoPullRequestThreadRequest(
  fromEnvironmentId: string,
  pullRequest: AldoPullRequestShown,
): { readonly fromEnvironmentId: string; readonly pullRequest: AldoPullRequestBranch } {
  return {
    fromEnvironmentId,
    pullRequest: { number: pullRequest.number, headBranch: pullRequest.headBranch },
  };
}

/** What the toast says once the thread is open, with a task in its composer or none. */
export function aldoPullRequestThreadOpened(
  hasTask: boolean,
  headBranch: string,
): { readonly title: string; readonly description: string } {
  return {
    title: "Opened a thread on the pull request's branch",
    description: hasTask
      ? "The task is in the composer — read it over, then send."
      : `Its computer checks out \`${headBranch}\` as it starts.`,
  };
}

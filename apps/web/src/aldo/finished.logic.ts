// What finished, and where it honestly stands: for the Finished group under
// Needs you (AldoFinished.tsx) and for the conversation's finished lines
// (AldoFeed.tsx). A thread that's done isn't finished business while its pull
// requests are still on their way: checks failing or running, a merge Aldo
// makes on its own soon, a deploy going. Only what's done and passing gets a
// green check. One whose next step is the user's (a merge that's theirs to
// make, a question) is in Needs you instead, so nothing shows twice. A result
// that isn't a pull request settles once it's delivered (Aldo's
// src/lib/settlement.ts), so it isn't kept here.

import { type AldoHome, type AldoHomeConversation, type AldoHomePullRequest } from "./homeApi";
import { aldoDecisions, decisionThread, putAway } from "./decisions.logic";
import { queuedComputer, sameTarget } from "./home.logic";

/**
 * Where a result stands, as its icon and color say it: `failing` (amber),
 * `running` (checks or a deploy going), `merging` (Aldo merges it soon, on its
 * own), `yours` (ready, or held, for the user's merge), `draft`, `shipped`
 * (merged or deployed: the only green check), `done` (no pull request), and
 * `quiet` (closed, or no longer followed).
 */
export type AldoResultTone =
  | "failing"
  | "running"
  | "merging"
  | "yours"
  | "draft"
  | "shipped"
  | "done"
  | "quiet";

export interface AldoResultState {
  readonly tone: AldoResultTone;
  /** A few words: "2 checks failing", "Merges in 9 min", "Deployed". */
  readonly words: string;
  /** The pull request it's about, when it's about one. */
  readonly pullRequest: AldoHomePullRequest | null;
}

/** First what's gone wrong, then what waits on the user, then what's coming, then what's done. */
const RANK: Record<AldoResultTone, number> = {
  failing: 0,
  yours: 1,
  merging: 2,
  draft: 3,
  running: 4,
  shipped: 5,
  done: 6,
  quiet: 7,
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * When Aldo merges it: "Merges in 9 min" (`clock`: "Merges at 3:24 PM", for a
 * line that isn't redrawn as time passes), or "Merging" once that's past
 * (it waits for the agent to be idle).
 */
export function mergeWords(mergesAt: string, now: number, clock = false): string {
  const ms = Date.parse(mergesAt) - now;
  if (ms <= 0) return "Merging";
  if (clock) return `Merges at ${clockOf(mergesAt)}`;
  const minutes = Math.ceil(ms / 60_000);
  return minutes < 60 ? `Merges in ${minutes} min` : `Merges at ${clockOf(mergesAt)}`;
}

/** Where one pull request stands. */
export function pullRequestState(
  pr: AldoHomePullRequest,
  now: number,
  options: { readonly clock?: boolean } = {},
): AldoResultState {
  const state = (tone: AldoResultTone, words: string): AldoResultState => ({
    tone,
    words,
    pullRequest: pr,
  });
  const checks = pr.checks;
  switch (pr.stage) {
    case "checks-failing":
      return state(
        "failing",
        checks && checks.failed > 0
          ? `${plural(checks.failed, "check")} failing`
          : "Checks failing",
      );
    case "deploy-failed":
      return state("failing", "Deploy failed");
    case "checks-running": {
      const total = checks ? checks.passed + checks.failed + checks.running : 0;
      return state(
        "running",
        checks && total > 0 ? `Checks ${checks.passed} of ${total}` : "Checks running",
      );
    }
    case "deploying":
      return state("running", "Deploying");
    case "draft":
      return state("draft", "Draft");
    case "green":
      if (pr.status !== "watching") return state("quiet", "Not followed");
      if (pr.held) return state("yours", "Held for your merge");
      return pr.mergesAt
        ? state("merging", mergeWords(pr.mergesAt, now, options.clock))
        : state("yours", "Ready to merge");
    case "merged":
      return state("shipped", "Merged");
    case "deployed":
      return state("shipped", "Deployed");
    case "closed":
      return state("quiet", "Closed");
    case "stopped":
      return state("quiet", "Not followed");
  }
}

/** A thread's pull requests, as Aldo follows them. */
export function pullRequestsOf(
  home: Pick<AldoHome, "pullRequests">,
  c: Pick<AldoHomeConversation, "thread">,
): ReadonlyArray<AldoHomePullRequest> {
  return home.pullRequests.filter((pr) => sameTarget(pr.thread, c.thread));
}

/**
 * Where a finished thread stands: its most pressing pull request ("#611: 2
 * checks failing" when it has more than one), or done.
 */
export function resultState(
  prs: ReadonlyArray<AldoHomePullRequest>,
  now: number,
  options: { readonly clock?: boolean } = {},
): AldoResultState {
  const states = prs
    .map((pr) => pullRequestState(pr, now, options))
    .sort((a, b) => RANK[a.tone] - RANK[b.tone]);
  const top = states[0];
  if (!top) return { tone: "done", words: "Finished", pullRequest: null };
  return prs.length > 1 ? { ...top, words: `#${top.pullRequest!.number}: ${top.words}` } : top;
}

/** Still on its way: not merged yet, or merged and its deploy going or failed. */
function inFlight(pr: AldoHomePullRequest): boolean {
  if (pr.status === "watching") return true;
  return pr.status === "merged" && (pr.stage === "deploying" || pr.stage === "deploy-failed");
}

export interface AldoFinishedResult {
  readonly key: string;
  readonly conversation: AldoHomeConversation;
  /** Its pull requests still on their way, the most pressing first. */
  readonly pullRequests: ReadonlyArray<AldoHomePullRequest>;
  readonly state: AldoResultState;
  /** When it finished. */
  readonly at: string;
}

/**
 * Threads that are done and whose pull requests are still on their way, in
 * the order to look at them: what's gone wrong, what Aldo merges soonest,
 * then the rest, newest first. Not one put away, a routine's run (its
 * routine says how it went), or one with anything in Needs you.
 */
export function finishedResults(home: AldoHome, now: number): ReadonlyArray<AldoFinishedResult> {
  const needsYou = aldoDecisions(home, now).flatMap((d) => {
    const thread = decisionThread(d);
    return thread ? [thread] : [];
  });
  return home.conversations
    .filter(
      (c) =>
        c.state === "done" &&
        !queuedComputer(c) &&
        !putAway(c, now) &&
        !c.routine &&
        !needsYou.some((t) => sameTarget(t, c.thread)),
    )
    .flatMap((c): AldoFinishedResult[] => {
      const prs = pullRequestsOf(home, c).filter(inFlight);
      if (prs.length === 0) return [];
      const state = resultState(prs, now);
      const pullRequests = [...prs].sort(
        (a, b) => RANK[pullRequestState(a, now).tone] - RANK[pullRequestState(b, now).tone],
      );
      return [
        { key: `finished:${c.ref}`, conversation: c, pullRequests, state, at: c.stateAt ?? c.at },
      ];
    })
    .sort((a, b) => {
      const rank = RANK[a.state.tone] - RANK[b.state.tone];
      if (rank !== 0) return rank;
      const soon = (r: AldoFinishedResult) => r.state.pullRequest?.mergesAt ?? "";
      if (a.state.tone === "merging") return soon(a).localeCompare(soon(b));
      return b.at.localeCompare(a.at);
    });
}

/** Whether it's waiting only on checks or a deploy: a quiet line under the group, not a row, until it's ready. */
export function onlyWaiting(result: AldoFinishedResult): boolean {
  return result.state.tone === "running";
}

/** What its checks say, in a line: "11 of 13 checks passed, 2 failing". */
export function checksLine(checks: AldoHomePullRequest["checks"]): string | null {
  if (!checks) return null;
  const total = checks.passed + checks.failed + checks.running;
  if (total === 0) return null;
  if (checks.failed === 0 && checks.running === 0) return `${plural(total, "check")} passed`;
  const rest = [
    checks.failed > 0 ? `${checks.failed} failing` : null,
    checks.running > 0 ? `${checks.running} running` : null,
  ].filter(Boolean);
  return `${checks.passed} of ${plural(total, "check")} passed, ${rest.join(", ")}`;
}

/** How many times Aldo sent it back to the agent for its checks or reviews. */
export function followupsLine(followups: number): string | null {
  if (followups <= 0) return null;
  return followups === 1
    ? "Aldo sent it back to the agent once"
    : `Aldo sent it back to the agent ${followups} times`;
}

// What waits on a decision from the user, each with what deciding it takes:
// an Aldo approval (an email to send, an event to add, a thread to start), a
// thread's question, approval or plan, a pull request ready to merge, and a
// thread that stopped or waits on them otherwise (which only the thread
// answers). The brief's "Top of mind" (AldoBrief.tsx), the phone's Agents tab
// and going through them with Aldo on a call (walkthrough.ts) all read the
// same list, from Aldo's home read. Pure, so it's tested on its own.

import { waitingApprovals } from "./approvals.logic";
import {
  type AldoApproval,
  type AldoChatDecision,
  type AldoHome,
  type AldoHomeConversation,
  type AldoHomePending,
  type AldoHomePullRequest,
} from "./homeApi";
import { boardFor, isPausedMidTurn, needsYouKind, sameTarget } from "./home.logic";

export type AldoDecision =
  | { readonly kind: "aldo-approval"; readonly key: string; readonly approval: AldoApproval }
  | {
      readonly kind: "question";
      readonly key: string;
      readonly conversation: AldoHomeConversation;
      readonly pending: Extract<AldoHomePending, { kind: "question" }>;
    }
  | {
      readonly kind: "approval";
      readonly key: string;
      readonly conversation: AldoHomeConversation;
      readonly pending: Extract<AldoHomePending, { kind: "approval" }>;
    }
  | {
      readonly kind: "handoff";
      readonly key: string;
      readonly conversation: AldoHomeConversation;
      readonly pending: Extract<AldoHomePending, { kind: "handoff" }>;
    }
  | {
      readonly kind: "plan";
      readonly key: string;
      readonly conversation: AldoHomeConversation;
      readonly plan: { readonly id: string; readonly text: string };
    }
  | { readonly kind: "merge"; readonly key: string; readonly pullRequest: AldoHomePullRequest }
  | {
      readonly kind: "failed" | "waiting";
      readonly key: string;
      readonly conversation: AldoHomeConversation;
    };

/** A conversation's decision, keyed by what it asks (a new question is a new decision). */
function conversationDecision(c: AldoHomeConversation): AldoDecision | null {
  const kind = needsYouKind(c);
  if (kind === "question" && c.pending?.kind === "question")
    return {
      kind,
      key: `question:${c.ref}:${c.pending.requestId}`,
      conversation: c,
      pending: c.pending,
    };
  if (kind === "approval" && c.pending?.kind === "approval")
    return {
      kind,
      key: `approval:${c.ref}:${c.pending.requestId}`,
      conversation: c,
      pending: c.pending,
    };
  if (kind === "handoff" && c.pending?.kind === "handoff")
    return {
      kind,
      key: `handoff:${c.ref}:${c.pending.requestId}`,
      conversation: c,
      pending: c.pending,
    };
  if (kind === "plan" && c.plan)
    return { kind, key: `plan:${c.ref}:${c.plan.id}`, conversation: c, plan: c.plan };
  // By when it got there (a rename or a pin moves `at`, not this), as Aldo's brief keys it.
  if (kind === "failed" || kind === "waiting")
    return { kind, key: `${kind}:${c.ref}:${c.stateAt ?? c.at}`, conversation: c };
  return null;
}

/** Put away in the user's list: settled, or snoozed (still, by `now`) without asking them anything. */
export function putAway(c: AldoHomeConversation, now: number): boolean {
  if (c.settled === true) return true;
  return (
    c.snoozedUntil !== undefined && Date.parse(c.snoozedUntil) > now && c.pending === undefined
  );
}

/**
 * Everything waiting on the user, in the order to go through it: Aldo's
 * approvals (not ones already being carried out), then threads (waited
 * longest first, not ones they put away), then pull requests that can merge,
 * whose thread isn't on the list already and that Aldo won't merge on its
 * own. Aldo's brief picks from the same (src/lib/assistant/brief.ts).
 */
export function aldoDecisions(home: AldoHome, now: number): ReadonlyArray<AldoDecision> {
  // A thread paused mid-turn needs opening, not a decision (Aldo's brief leaves it out too).
  const needsYou = boardFor(home.conversations, now).needsYou.filter(
    (c) => !putAway(c, now) && !isPausedMidTurn(c),
  );
  const fromThreads = needsYou.flatMap((c) => {
    const decision = conversationDecision(c);
    return decision ? [decision] : [];
  });
  const merges: AldoDecision[] = home.pullRequests
    .filter((pr) => pr.status === "watching" && pr.stage === "green" && pr.mergesAt === null)
    // Its thread's own decision comes first; a thread put away puts away its pull request too.
    .filter(
      (pr) =>
        !needsYou.some((c) => sameTarget(pr.thread, c.thread)) &&
        !home.conversations.some((c) => sameTarget(pr.thread, c.thread) && putAway(c, now)),
    )
    .map((pullRequest) => ({
      kind: "merge",
      key: `merge:${pullRequest.repo}#${pullRequest.number}`,
      pullRequest,
    }));
  return [
    ...waitingApprovals(home.approvals)
      .filter((approval) => approval.status === "pending")
      .map((approval): AldoDecision => ({
        kind: "aldo-approval",
        key: `aldo:${approval.id}`,
        approval,
      })),
    ...fromThreads,
    ...merges,
  ];
}

/**
 * How many things wait on the user, for the phone's badge and summary: the
 * decisions, and the threads paused mid-turn (not put away), which opening
 * them carries on rather than a decision. `answered`: decisions' keys the user
 * has just decided, which the home read hasn't caught up with.
 */
export function aldoWaitingCount(
  home: AldoHome,
  now: number,
  answered: ReadonlyArray<string> = [],
): number {
  const paused = home.conversations.filter((c) => isPausedMidTurn(c) && !putAway(c, now));
  const decisions = aldoDecisions(home, now).filter((d) => !answered.includes(d.key));
  return decisions.length + paused.length;
}

/** Whether a decision can be made without opening its thread: a tap, or a few words. */
export function decidesInPlace(decision: AldoDecision): boolean {
  return decision.kind !== "failed" && decision.kind !== "waiting";
}

/** What a decision is called, in a line. */
export function decisionTitle(decision: AldoDecision): string {
  switch (decision.kind) {
    case "aldo-approval":
      return decision.approval.title;
    case "merge":
      return `Merge #${decision.pullRequest.number} ${decision.pullRequest.title}`;
    default:
      return decision.conversation.title;
  }
}

/** What it asks of the user, in a line. */
export function decisionAsk(decision: AldoDecision): string {
  switch (decision.kind) {
    case "aldo-approval":
      return decision.approval.summary;
    case "question": {
      const first = decision.pending.questions[0];
      return first ? first.question : "It asks you something";
    }
    case "approval":
      return decision.pending.summary;
    case "handoff":
      return decision.pending.summary || "Needs you in its browser";
    case "plan":
      return "Has a plan for you to approve";
    case "merge": {
      const checks = decision.pullRequest.checks;
      const total = checks ? checks.passed + checks.failed + checks.running : 0;
      return checks && total > 0 ? `${checks.passed}/${total} checks` : "Green";
    }
    case "failed":
      return decision.conversation.summary ?? "Stopped with an error";
    case "waiting":
      return decision.conversation.summary ?? "Waiting on you";
  }
}

/** The thread a decision belongs to, if any. */
export function decisionThread(
  decision: AldoDecision,
): { readonly environmentId: string; readonly threadId: string } | null {
  switch (decision.kind) {
    case "aldo-approval":
      return decision.approval.thread;
    case "merge":
      return decision.pullRequest.thread;
    default:
      return decision.conversation.thread;
  }
}

/** Whether a decision (by key) still waits in this read of the home screen. */
export function decisionOpen(home: AldoHome, key: string, now: number): boolean {
  return aldoDecisions(home, now).some((d) => d.key === key);
}

/**
 * What Aldo is told about a decision on a call, to put it to the user: what
 * it is, what it asks, its choices, and what to call to act on it.
 */
export function decisionBrief(decision: AldoDecision): string {
  switch (decision.kind) {
    case "aldo-approval": {
      const a = decision.approval;
      const what =
        a.kind === "email"
          ? "an email draft"
          : a.kind === "event"
            ? "a calendar event"
            : a.kind === "confirm"
              ? "a step an agent takes only once the user says yes (a purchase, booking, cancellation, submission or call)"
              : "a thread to start";
      return [
        `${what} waiting on the user's OK: "${a.title}" (${a.summary}).`,
        a.body ? `It says: ${a.body.slice(0, 600)}` : "",
        `Their choices: "${a.approveLabel}" or "${a.discardLabel}" (approval id ${a.id}).`,
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "question": {
      const c = decision.conversation;
      const questions = decision.pending.questions
        .map((q) => {
          const options = q.options.map((o) => `"${o.label}"`).join(", ");
          return `"${q.question}"${options ? ` (choices: ${options}${q.multiSelect ? ", any of them" : ""})` : ""}`;
        })
        .join("; ");
      return `The thread "${c.title}" (ref ${c.ref}) asks: ${questions}. The user can pick a choice or answer in their own words.`;
    }
    case "approval": {
      const c = decision.conversation;
      const options = decision.pending.options.map((o) => `"${o.label}"`).join(", ");
      return `The thread "${c.title}" (ref ${c.ref}) asks the user's OK: ${decision.pending.summary}. Their choices: ${options}.`;
    }
    case "handoff": {
      const c = decision.conversation;
      return `The thread "${c.title}" (ref ${c.ref}) needs the user in its browser: ${decision.pending.summary || "something only they can get past"}. They do it from the card, which offers the way in for this step (the agent's browser, a box for a code, or the site on their phone); or skip it there.`;
    }
    case "plan":
      return `The thread "${decision.conversation.title}" (ref ${decision.conversation.ref}) has a plan to approve: ${decision.plan.text.slice(0, 600)}. The user can approve it, or ask for changes.`;
    case "merge": {
      const pr = decision.pullRequest;
      return `Pull request #${pr.number} "${pr.title}" in ${pr.repo} is green and ready to merge${pr.thread ? ` (from the thread "${pr.threadTitle}")` : ""}. The user can merge it now, or leave it.`;
    }
    case "failed":
      return `The thread "${decision.conversation.title}" (ref ${decision.conversation.ref}) stopped with an error: ${decision.conversation.summary ?? "no reason given"}.`;
    case "waiting":
      return `The thread "${decision.conversation.title}" (ref ${decision.conversation.ref}) waits on the user: ${decision.conversation.summary ?? "it didn't say why"}.`;
  }
}

/** Presentation of this pending item in Aldo chat; overview still uses the complete list. */
export function chatDecisionOf(decision: AldoDecision): AldoChatDecision | undefined {
  return decision.kind === "aldo-approval"
    ? decision.approval.chatDecision
    : decision.kind === "merge"
      ? decision.pullRequest.chatDecision
      : decision.conversation.chatDecision;
}

export function aldoChatDecisions(home: AldoHome, now: number): ReadonlyArray<AldoDecision> {
  return aldoDecisions(home, now).filter((d) => !chatDecisionOf(d)?.dismissed);
}

/**
 * What waits on the user that they hid from Aldo's conversation (it still
 * waits in its thread, and counts in aldoWaitingCount): a line each, to show
 * again.
 */
export function aldoHiddenFromChat(
  home: AldoHome,
  now: number,
): ReadonlyArray<{ readonly title: string; readonly chatDecision: AldoChatDecision }> {
  const decisions = aldoDecisions(home, now).flatMap((d) => {
    const chatDecision = chatDecisionOf(d);
    if (!chatDecision?.dismissed) return [];
    const title =
      d.kind === "aldo-approval"
        ? d.approval.title
        : d.kind === "merge"
          ? d.pullRequest.title
          : d.conversation.title;
    return [{ title, chatDecision }];
  });
  const paused = home.conversations.flatMap((c) =>
    c.chatDecision?.dismissed && isPausedMidTurn(c) && !putAway(c, now)
      ? [{ title: c.title, chatDecision: c.chatDecision }]
      : [],
  );
  return [...decisions, ...paused];
}

/** Threads paused mid-turn, in Aldo's conversation: not put away, not hidden from it. A line each that opens the thread. */
export function pausedInChat(home: AldoHome, now: number): ReadonlyArray<AldoHomeConversation> {
  return home.conversations.filter(
    (c) => isPausedMidTurn(c) && !putAway(c, now) && !c.chatDecision?.dismissed,
  );
}

/**
 * When a decision came up: an Aldo approval when it was asked for (or Aldo
 * last rewrote it), a pull request when it went green, a thread's when it
 * got to where it waits.
 */
export function decisionAt(decision: AldoDecision): string {
  switch (decision.kind) {
    case "aldo-approval":
      return decision.approval.revisedAt ?? decision.approval.createdAt;
    case "merge":
      return decision.pullRequest.greenSince ?? decision.pullRequest.updatedAt;
    default:
      return decision.conversation.stateAt ?? decision.conversation.at;
  }
}

/** A decision as the conversation places it: by when it came up. */
export interface AldoPlaceable {
  readonly key: string;
  readonly at: string;
  /** Under Aldo's first reply at or after `at`: a draft it rewrote, under the reply saying so. */
  readonly afterReply?: boolean;
}

/**
 * Where a decision goes: by when it came up, or under what raised it. A draft
 * Aldo rewrote goes under the reply saying so; one the day's brief brought up
 * (`brief`, its keys) under the brief, which went through them.
 */
export function placeableOf(
  decision: AldoDecision,
  brief?: { readonly at: string; readonly keys: ReadonlySet<string> } | null,
): AldoPlaceable {
  if (decision.kind === "aldo-approval" && decision.approval.revisedAt !== undefined)
    return { key: decision.key, at: decision.approval.revisedAt, afterReply: true };
  if (brief?.keys.has(decision.key)) return { key: decision.key, at: brief.at, afterReply: true };
  return { key: decision.key, at: decisionAt(decision) };
}

/** Aldo's turn, at its longest: what came up this long before a reply came up in it, so it goes under it. */
const TURN_MS = 5 * 60_000;

/**
 * Where each decision sits in Aldo's conversation: under what was said or
 * happened last before it came up, so the conversation reads in order, or
 * under Aldo's reply when it came up in the turn that reply ends (a draft Aldo
 * made as it answered). `items`
 * are the conversation's, each with its time (none for what belongs to the
 * line before it, as what Aldo did does to its reply) and whether it's Aldo's
 * reply. `before`: by index, the decisions to put before the item there. What
 * came up after all of it, or before it all (older than the conversation),
 * isn't placed: it waits at the end, as before. `at`: when, in the
 * conversation, each placed one is, so the line it becomes once it's decided
 * stays where it was.
 */
export function placeDecisions(
  items: ReadonlyArray<{ readonly at: string | null; readonly reply: boolean }>,
  decisions: ReadonlyArray<AldoPlaceable>,
): {
  readonly before: ReadonlyMap<number, ReadonlyArray<string>>;
  readonly at: ReadonlyMap<string, string>;
} {
  const before = new Map<number, string[]>();
  const at = new Map<string, string>();
  const times = items.map((item) => (item.at ? Date.parse(item.at) : null));
  const first = times.findIndex((time) => time !== null && !Number.isNaN(time));
  /** The first item from `from` with a time (after `after`, if given), or -1. */
  const next = (from: number, after = -Infinity) => {
    for (let index = from; index < items.length; index += 1) {
      const time = times[index];
      if (time !== null && time !== undefined && time > after) return index;
    }
    return -1;
  };
  for (const decision of decisions) {
    const time = Date.parse(decision.at);
    if (Number.isNaN(time) || first < 0 || time < times[first]!) continue;
    let index: number;
    let when = decision.at;
    const reply = items.findIndex(
      (item, i) => item.reply && times[i] !== null && times[i]! >= time,
    );
    if (decision.afterReply || (reply >= 0 && times[reply]! - time <= TURN_MS)) {
      if (reply < 0) continue;
      index = next(reply + 1);
      when = new Date(times[reply]! + 1).toISOString();
    } else index = next(first, time);
    if (index < 0) continue;
    before.set(index, [...(before.get(index) ?? []), decision.key]);
    at.set(decision.key, when);
  }
  return { before, at };
}

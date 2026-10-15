// What happened to the user's agents, in Aldo's conversation where it
// happened (AldoConversationPage.tsx): threads that finished, pull requests
// that shipped, and what Aldo did before this page opened (the page's own
// actions are in the conversation already). What waits on the user isn't
// here: it's the live "Up next" at the conversation's end, so it never sits
// buried in what was said. The newest of what Aldo did to a thread that's
// still going shows it live, as a card. All from Aldo's home read, so
// nothing is woken.
// Pure, so it's tested on its own.

import type { AldoHome, AldoHomeAction, AldoHomeConversation, AldoHomePullRequest } from "./cloud";
import { putAway } from "./decisions.logic";
import { sameTarget } from "./home.logic";

/** How far back the conversation shows what happened: as long as the board kept done threads. */
export const FEED_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export type AldoFeedEvent =
  | {
      readonly kind: "finished";
      readonly key: string;
      readonly at: string;
      readonly conversation: AldoHomeConversation;
    }
  | {
      readonly kind: "shipped";
      readonly key: string;
      readonly at: string;
      readonly pullRequest: AldoHomePullRequest;
    }
  | {
      readonly kind: "action";
      readonly key: string;
      readonly at: string;
      readonly action: AldoHomeAction;
      /** The newest action on a thread that's still going: shown as the thread, live. */
      readonly live: boolean;
    };

/** Aldo's actions worth a line in the conversation: what it changed about a thread or a pull request. */
const SHOWN_ACTIONS = new Set([
  "start_thread",
  "message_thread",
  "answer_thread",
  "approve_plan",
  "interrupt_thread",
  "merge_pull_request",
]);

/**
 * What happened, oldest first: from `from` (the conversation's start, so
 * nothing floats above it) and within the window. Aldo's actions only from
 * before `until` (when this page opened): later ones it shows itself.
 */
export function feedEvents(
  home: Pick<AldoHome, "conversations" | "pullRequests" | "actions">,
  options: { readonly now: number; readonly from: string | null; readonly until: number },
): ReadonlyArray<AldoFeedEvent> {
  const start = Math.max(
    options.now - FEED_WINDOW_MS,
    options.from ? Date.parse(options.from) : -Infinity,
  );
  const within = (at: string | null | undefined): at is string => {
    if (!at) return false;
    const time = Date.parse(at);
    return time >= start && time <= options.now;
  };
  const finished: AldoFeedEvent[] = home.conversations
    .filter((c) => c.state === "done" && !putAway(c, options.now) && within(c.stateAt ?? c.at))
    .map((c) => ({
      kind: "finished",
      key: `finished:${c.ref}:${c.stateAt ?? c.at}`,
      at: c.stateAt ?? c.at,
      conversation: c,
    }));
  const shipped: AldoFeedEvent[] = home.pullRequests
    .filter((pr) => pr.status === "merged" && within(pr.mergedAt))
    .map((pr) => ({
      kind: "shipped",
      key: `shipped:${pr.repo}#${pr.number}`,
      at: pr.mergedAt!,
      pullRequest: pr,
    }));
  const shown = home.actions
    .filter(
      (a) =>
        SHOWN_ACTIONS.has(a.tool) && !a.failed && within(a.at) && Date.parse(a.at) < options.until,
    )
    .sort((a, b) => a.at.localeCompare(b.at));
  const going = (thread: AldoHomeAction["thread"]) =>
    thread !== null &&
    home.conversations.some((c) => sameTarget(thread, c.thread) && c.state !== "done");
  const actions: AldoFeedEvent[] = shown.map((a, index) => ({
    kind: "action",
    key: `action:${a.id}`,
    at: a.at,
    action: a,
    live:
      going(a.thread) &&
      !shown.slice(index + 1).some((later) => a.thread && sameTarget(later.thread, a.thread)),
  }));
  return [...finished, ...shipped, ...actions].sort((a, b) => a.at.localeCompare(b.at));
}

export type AldoTimelineItem<E> =
  | { readonly kind: "entry"; readonly entry: E; readonly index: number }
  | {
      readonly kind: "events";
      readonly key: string;
      readonly events: ReadonlyArray<AldoFeedEvent>;
    };

/**
 * The conversation with what happened put where it happened: each run of
 * events between two things said is one block. An entry without a time (an
 * action Aldo took) belongs to what was said before it, so nothing comes
 * between a reply and what it did.
 */
export function interleave<E>(
  entries: ReadonlyArray<E>,
  events: ReadonlyArray<AldoFeedEvent>,
  timeOf: (entry: E) => string | null,
): ReadonlyArray<AldoTimelineItem<E>> {
  const items: AldoTimelineItem<E>[] = [];
  let next = 0;
  const flush = (before: string | null) => {
    const run: AldoFeedEvent[] = [];
    for (; next < events.length; next += 1) {
      const event = events[next]!;
      if (before !== null && event.at >= before) break;
      run.push(event);
    }
    if (run.length > 0) items.push({ kind: "events", key: run[0]!.key, events: run });
  };
  entries.forEach((entry, index) => {
    const at = timeOf(entry);
    if (at) flush(at);
    items.push({ kind: "entry", entry, index });
  });
  flush(null);
  return items;
}

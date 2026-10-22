// What happened to the user's agents, in Aldo's conversation where it
// happened (AldoConversationPage.tsx): threads that finished, pull requests
// that shipped, payments that went on from waiting on the user (approved,
// paid, declined), and what Aldo did, but for what this page shows itself (what
// it did here is in the conversation already; what it did
// from another device is only here). What waits on the user isn't
// here: it's the live "Up next" at the conversation's end, so it never sits
// buried in what was said. The newest of what Aldo did to a thread that's
// still going shows it live, as a card. All from Aldo's home read, so
// nothing is woken.
// What finished and shipped is quiet: a pull request's check after it merged
// is part of it shipping, a routine's run (and what it shipped) is the
// routine's, and a thread Aldo already told the user about needs no line of
// its own. Between two things said, it's one line that opens (digestOf).
// Pure, so it's tested on its own.

import {
  type AldoHome,
  type AldoHomeAction,
  type AldoHomeConversation,
  type AldoHomePullRequest,
  type AldoHomeTarget,
  type AldoPayment,
} from "./homeApi";
import { placeDecisions, putAway, type AldoPlaceable } from "./decisions.logic";
import { settledPayments } from "./payments.logic";
import { type AldoPlan } from "./plans.logic";
import { sameTarget } from "./home.logic";

/** How far back the conversation shows what happened: as long as the board kept done threads. */
const FEED_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
/** Aldo's message about a thread comes after the thread finished; this much before still counts (clocks differ). */
const TOLD_SLACK_MS = 60_000;

export type AldoFeedEvent =
  | {
      readonly kind: "finished";
      readonly key: string;
      readonly at: string;
      readonly conversation: AldoHomeConversation;
      /** The routine whose run it was. */
      readonly routine?: { readonly id: string; readonly title: string };
    }
  | {
      readonly kind: "shipped";
      readonly key: string;
      readonly at: string;
      readonly pullRequest: AldoHomePullRequest;
      /** The conversation checking it once it merged, while there's one. */
      readonly check?: AldoHomeConversation;
    }
  | {
      readonly kind: "action";
      readonly key: string;
      readonly at: string;
      readonly action: AldoHomeAction;
      /** The newest action on a thread that's still going: shown as the thread, live. */
      readonly live: boolean;
    }
  | {
      /** A payment that went on from waiting on the user (payments.logic.ts): how it stands, where it came up. */
      readonly kind: "payment";
      readonly key: string;
      readonly at: string;
      readonly payment: AldoPayment;
    }
  | {
      /** A plan Aldo proposed that has started (plans.logic.ts): its card, where it started. */
      readonly kind: "plan";
      readonly key: string;
      readonly at: string;
      readonly plan: AldoPlan;
    }
  | {
      /** A card the user answered this visit (receipts.ts): what was done. */
      readonly kind: "decided";
      readonly key: string;
      readonly at: string;
      readonly text: string;
      readonly thread: AldoHomeTarget | null;
    };

/** Aldo's actions worth a line in the conversation: what it changed about a thread or a pull request. */
const SHOWN_ACTIONS = new Set([
  "start_thread",
  "start_plan",
  "message_thread",
  "answer_thread",
  "approve_plan",
  "interrupt_thread",
  "merge_pull_request",
]);

/** One of Aldo's actions the page shows itself: what it did and to which thread. */
export interface AldoShownAction {
  readonly tool: string;
  readonly thread: AldoHomeTarget | null;
}

/**
 * What happened, oldest first: from `from` (the conversation's start, so
 * nothing floats above it) and within the window. Actions the conversation
 * already shows (`here`) are reconciled even after the home page remounts:
 * the conversation's entries live longer than the page does. `told`: what
 * Aldo said in the conversation, where a thread it reported on is linked
 * (src/lib/assistant/results.ts).
 */
export function feedEvents(
  home: Pick<AldoHome, "conversations" | "pullRequests" | "actions" | "routines" | "payments">,
  options: {
    readonly now: number;
    readonly from: string | null;
    readonly here?: ReadonlyArray<AldoShownAction>;
    readonly told?: ReadonlyArray<{ readonly text: string; readonly at: string }>;
  },
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
  const conversationAt = (thread: AldoHomeTarget | null | undefined) =>
    thread ? home.conversations.find((c) => sameTarget(thread, c.thread)) : undefined;
  const merged = home.pullRequests.filter((pr) => pr.status === "merged" && within(pr.mergedAt));
  // A merge's check is said by its line (a routine's, by its run's): one merged
  // before the feed leaves its check a line of its own.
  const checks = merged.flatMap((pr) => (pr.check ? [pr.check] : []));
  const told = (c: AldoHomeConversation, at: string) => {
    const path = `/${c.thread.environmentId}/${c.thread.threadId}`;
    const after = Date.parse(at) - TOLD_SLACK_MS;
    return (options.told ?? []).some((m) => Date.parse(m.at) >= after && m.text.includes(path));
  };
  const finished: AldoFeedEvent[] = home.conversations
    .filter((c) => c.state === "done" && !putAway(c, options.now) && within(c.stateAt ?? c.at))
    .filter(
      (c) => !checks.some((check) => sameTarget(check, c.thread)) && !told(c, c.stateAt ?? c.at),
    )
    .map((c) => {
      const routine = c.routine
        ? {
            id: c.routine,
            title: home.routines?.find((r) => r.id === c.routine)?.title ?? c.title,
          }
        : undefined;
      return {
        kind: "finished",
        key: `finished:${c.ref}:${c.stateAt ?? c.at}`,
        at: c.stateAt ?? c.at,
        conversation: c,
        ...(routine ? { routine } : {}),
      };
    });
  const shipped: AldoFeedEvent[] = merged
    .filter((pr) => !conversationAt(pr.thread)?.routine)
    .map((pr) => {
      const check = conversationAt(pr.check);
      return {
        kind: "shipped",
        key: `shipped:${pr.repo}#${pr.number}`,
        at: pr.mergedAt!,
        pullRequest: pr,
        ...(check ? { check } : {}),
      };
    });
  // Each of the page's own actions stands for one of Aldo's, the first like it:
  // another like it, later, came from elsewhere.
  const unmatched = [...(options.here ?? [])];
  const shownHere = (a: AldoHomeAction) => {
    const at = unmatched.findIndex(
      (h) =>
        h.tool === a.tool &&
        (h.thread === null || a.thread === null || sameTarget(h.thread, a.thread)),
    );
    if (at < 0) return false;
    unmatched.splice(at, 1);
    return true;
  };
  const shown = home.actions
    .filter((a) => SHOWN_ACTIONS.has(a.tool) && !a.failed && within(a.at))
    .sort((a, b) => a.at.localeCompare(b.at))
    .filter((a) => !shownHere(a));
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
  // Where it came up, where its card was while it waited; one asked before the conversation, when it last changed.
  const payments: AldoFeedEvent[] = settledPayments(home, options.now).flatMap((p) => {
    const at = within(p.createdAt) ? p.createdAt : within(p.updatedAt) ? p.updatedAt : null;
    return at ? [{ kind: "payment", key: `payment:${p.id}`, at, payment: p }] : [];
  });
  return [...finished, ...shipped, ...actions, ...payments].sort((a, b) =>
    a.at.localeCompare(b.at),
  );
}

/** One live card per thread across the saved feed and local tool results. */
export function dedupeLiveCards(
  events: ReadonlyArray<AldoFeedEvent>,
  shown: ReadonlyArray<AldoHomeTarget>,
): ReadonlyArray<AldoFeedEvent> {
  const key = (thread: AldoHomeTarget) => `${thread.environmentId}\n${thread.threadId}`;
  const seen = new Set(shown.map(key));
  // Local results own their cards; otherwise the newest live feed event does.
  return events
    .toReversed()
    .map((event) => {
      if (event.kind !== "action" || !event.live || !event.action.thread) return event;
      const id = key(event.action.thread);
      if (seen.has(id)) return { ...event, live: false };
      seen.add(id);
      return event;
    })
    .toReversed();
}

/** What happened with the cards the user answered this visit put in, where they were answered. */
export function withReceipts(
  events: ReadonlyArray<AldoFeedEvent>,
  receipts: ReadonlyArray<{
    readonly key: string;
    readonly at: string;
    readonly text: string;
    readonly thread?: AldoHomeTarget | null;
  }>,
): ReadonlyArray<AldoFeedEvent> {
  if (receipts.length === 0) return events;
  const decided: AldoFeedEvent[] = receipts.map((r) => ({
    kind: "decided",
    key: `decided:${r.key}`,
    at: r.at,
    text: r.text,
    thread: r.thread ?? null,
  }));
  return [...events, ...decided].sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Plans that started, where they started: from `from` (the conversation's
 * start) and within the window, as the rest. Open ones wait at the
 * conversation's end instead.
 */
export function withPlans(
  events: ReadonlyArray<AldoFeedEvent>,
  plans: ReadonlyArray<AldoPlan>,
  options: { readonly now: number; readonly from: string | null },
): ReadonlyArray<AldoFeedEvent> {
  const start = Math.max(
    options.now - FEED_WINDOW_MS,
    options.from ? Date.parse(options.from) : -Infinity,
  );
  const started: AldoFeedEvent[] = plans.flatMap((plan) =>
    plan.status === "started" && plan.startedAt && Date.parse(plan.startedAt) >= start
      ? [{ kind: "plan", key: `plan:${plan.id}`, at: plan.startedAt, plan }]
      : [],
  );
  if (started.length === 0) return events;
  return [...events, ...started].sort((a, b) => a.at.localeCompare(b.at));
}

type Finished = Extract<AldoFeedEvent, { readonly kind: "finished" }>;
type Shipped = Extract<AldoFeedEvent, { readonly kind: "shipped" }>;

/** What finished or shipped: quiet, so a run of it is one line (digestOf). */
export function isQuietEvent(event: AldoFeedEvent): event is Finished | Shipped {
  return event.kind === "finished" || event.kind === "shipped";
}

export interface AldoDigest {
  readonly shipped: ReadonlyArray<Shipped>;
  readonly finished: ReadonlyArray<Finished>;
  /** Routines' runs, a group each: its runs oldest first. */
  readonly routines: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly runs: ReadonlyArray<Finished>;
  }>;
  /** "3 shipped · 2 finished · 1 routine run" */
  readonly label: string;
}

/** A run of what finished and shipped, grouped: what shipped, what finished, and each routine's runs. */
export function digestOf(events: ReadonlyArray<AldoFeedEvent>): AldoDigest {
  const shipped = events.filter((e): e is Shipped => e.kind === "shipped");
  const done = events.filter((e): e is Finished => e.kind === "finished");
  const finished = done.filter((e) => !e.routine);
  const routines = new Map<string, { id: string; title: string; runs: Finished[] }>();
  for (const event of done) {
    if (!event.routine) continue;
    const group = routines.get(event.routine.id) ?? { ...event.routine, runs: [] };
    group.runs.push(event);
    routines.set(event.routine.id, group);
  }
  const runs = done.length - finished.length;
  const label = [
    shipped.length > 0 ? `${shipped.length} shipped` : null,
    finished.length > 0 ? `${finished.length} finished` : null,
    runs > 0 ? `${runs} routine ${runs === 1 ? "run" : "runs"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return { shipped, finished, routines: [...routines.values()], label };
}

/** Where a pull request that merged is now, in a word or two: its check working, then its merge commit's checks. */
export function shippedStatus(event: Shipped): string {
  const stage = event.pullRequest.stage;
  if (stage === "deploy-failed") return "Deploy failed";
  if (event.check && !["done", "failed", "waiting"].includes(event.check.state)) return "Checking";
  if (stage === "deployed") return "Deployed";
  if (stage === "deploying") return "Deploying";
  return "Merged";
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

/** Where each item is, as placeDecisions reads them: its time (none for what belongs to the line before it) and whether it's Aldo's reply. */
export type AldoTimelineSlot = { readonly at: string | null; readonly reply: boolean };

export function timelineSlots<E>(
  items: ReadonlyArray<AldoTimelineItem<E>>,
  slotOf: (entry: E) => AldoTimelineSlot,
): ReadonlyArray<AldoTimelineSlot> {
  return items.map((item) =>
    item.kind === "events" ? { at: item.events[0]!.at, reply: false } : slotOf(item.entry),
  );
}

/**
 * The conversation in order (interleave), with the events that were cards
 * waiting on the user (`decided`, each as it was placed as a decision: a
 * payment that went on) where the card was, among the rest, so it changes in
 * place rather than jumping to when it came up.
 */
export function interleaveInPlace<E>(
  entries: ReadonlyArray<E>,
  events: ReadonlyArray<AldoFeedEvent>,
  slotOf: (entry: E) => AldoTimelineSlot,
  decided: ReadonlyArray<AldoPlaceable>,
): ReadonlyArray<AldoTimelineItem<E>> {
  const timeOf = (entry: E) => slotOf(entry).at;
  const keys = new Set(decided.map((d) => d.key));
  const rest = events.filter((e) => !keys.has(e.key));
  if (rest.length === events.length) return interleave(entries, events, timeOf);
  const { at } = placeDecisions(timelineSlots(interleave(entries, rest, timeOf), slotOf), decided);
  const moved = events
    .map((e) => (at.has(e.key) ? { ...e, at: at.get(e.key)! } : e))
    .toSorted((a, b) => a.at.localeCompare(b.at));
  return interleave(entries, moved, timeOf);
}

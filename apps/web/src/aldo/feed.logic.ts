// What happened to the user's agents, in Aldo's conversation where it
// happened (AldoConversationPage.tsx): threads that finished, pull requests
// that shipped, payments that went on from waiting on the user (approved,
// paid, declined), and what Aldo did, but for what this page shows itself (what
// it did here is in the conversation already; what it did
// from another device is only here). Cards waiting on the user are
// interleaved at their creation time too. Every thread has a card from its
// start (it was created, however, or its routine's run began; a server that
// says when), live while it's going, settling into its finished line in the
// same place; Aldo acting on it later moves it there. All from Aldo's home
// read, so nothing is woken.
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
import { putAway, type AldoPlaceable } from "./decisions.logic";
import { settledPayments } from "./payments.logic";
import { openPlans, type AldoPlan } from "./plans.logic";
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
      /** Where its card was, rather than when it finished. */
      readonly settled?: true;
    }
  | {
      /** A thread that's going, where it started: its card, live. */
      readonly kind: "thread";
      readonly key: string;
      readonly at: string;
      readonly conversation: AldoHomeConversation;
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
      /** A plan Aldo proposed (plans.logic.ts): its card, where it was proposed. */
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

/** What starts a thread: once it's settled, its finished line says it. */
const STARTS = new Set(["start_thread", "start_plan"]);

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
  // What Aldo last did about a thread (starting it, too), where its card moved.
  const lastAction = (thread: AldoHomeTarget) =>
    home.actions
      .filter(
        (a) =>
          SHOWN_ACTIONS.has(a.tool) &&
          !a.failed &&
          within(a.at) &&
          a.thread !== null &&
          sameTarget(a.thread, thread),
      )
      .reduce<string | null>((last, a) => latest(a.at, last), null);
  const merged = home.pullRequests.filter((pr) => pr.status === "merged" && within(pr.mergedAt));
  // A merge's check is said by its line (a routine's, by its run's): one merged
  // before the feed leaves its check a line of its own.
  const checks = merged.flatMap((pr) => (pr.check ? [pr.check] : []));
  const told = (c: AldoHomeConversation, at: string) => {
    const path = `/${c.thread.environmentId}/${c.thread.threadId}`;
    const after = Date.parse(at) - TOLD_SLACK_MS;
    return (options.told ?? []).some((m) => Date.parse(m.at) >= after && m.text.includes(path));
  };
  const routineOf = (c: AldoHomeConversation) =>
    c.routine
      ? { id: c.routine, title: home.routines?.find((r) => r.id === c.routine)?.title ?? c.title }
      : undefined;
  const checked = (c: AldoHomeConversation) => checks.some((check) => sameTarget(check, c.thread));
  // Where a thread's card is: its start, from a server that says it.
  const startOf = (c: AldoHomeConversation) =>
    within(c.startedAt) && !checked(c) && !putAway(c, options.now) ? c.startedAt : null;
  const finished: AldoFeedEvent[] = home.conversations
    .filter((c) => c.state === "done" && !putAway(c, options.now) && !checked(c))
    .flatMap((c): AldoFeedEvent[] => {
      const start = startOf(c);
      const ended = c.stateAt ?? c.at;
      if (told(c, ended) || (!start && !within(ended))) return [];
      const routine = routineOf(c);
      return [
        {
          kind: "finished",
          key: `finished:${c.ref}:${start ?? ended}`,
          // Settled where its card was: its start, or what Aldo last did about it.
          at: start ? latest(start, lastAction(c.thread)) : ended,
          conversation: c,
          ...(routine ? { routine } : {}),
          ...(start ? { settled: true as const } : {}),
        },
      ];
    });
  const threads: AldoFeedEvent[] = home.conversations.flatMap((c) => {
    const start = c.state === "done" ? null : startOf(c);
    return start ? [{ kind: "thread", key: `thread:${c.ref}`, at: start, conversation: c }] : [];
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
  const settled = (thread: AldoHomeTarget | null) => {
    const c = conversationAt(thread);
    return c?.state === "done" && startOf(c) !== null;
  };
  const shown = home.actions
    .filter((a) => SHOWN_ACTIONS.has(a.tool) && !a.failed && within(a.at))
    .sort((a, b) => a.at.localeCompare(b.at))
    .filter((a) => !shownHere(a))
    .filter((a) => !(STARTS.has(a.tool) && settled(a.thread)));
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
  // Recently settled payments keep the creation time their pending cards used.
  const payments: AldoFeedEvent[] = settledPayments(home, options.now).flatMap((p) => {
    const at = within(p.createdAt) || within(p.updatedAt) ? p.createdAt : null;
    return at ? [{ kind: "payment", key: `payment:${p.id}`, at, payment: p }] : [];
  });
  return [...finished, ...threads, ...shipped, ...actions, ...payments].sort((a, b) =>
    a.at.localeCompare(b.at),
  );
}

function latest(a: string, b: string | null): string {
  return b && Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * One card per thread across the saved feed and local tool results: local
 * results own their cards; otherwise the newest live feed event does. A
 * thread's card at its start goes where a newer one is, and so does its
 * settled line where the page shows the thread's card itself.
 */
export function dedupeLiveCards(
  events: ReadonlyArray<AldoFeedEvent>,
  shown: ReadonlyArray<AldoHomeTarget>,
): ReadonlyArray<AldoFeedEvent> {
  const key = (thread: AldoHomeTarget) => `${thread.environmentId}\n${thread.threadId}`;
  const here = new Set(shown.map(key));
  const seen = new Set(here);
  return events
    .toReversed()
    .flatMap((event): AldoFeedEvent[] => {
      if (event.kind === "finished")
        return event.settled && here.has(key(event.conversation.thread)) ? [] : [event];
      if (event.kind === "thread") {
        const id = key(event.conversation.thread);
        if (seen.has(id)) return [];
        seen.add(id);
        return [event];
      }
      if (event.kind !== "action" || !event.live || !event.action.thread) return [event];
      const id = key(event.action.thread);
      if (seen.has(id)) return [{ ...event, live: false }];
      seen.add(id);
      return [event];
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
 * Open and recently started plans, always where they were proposed. Starting
 * changes the card in place; it does not give it a new time.
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
  const open = new Set(openPlans(plans, options.from, options.now).map((p) => p.id));
  const shown: AldoFeedEvent[] = plans.flatMap((plan) =>
    open.has(plan.id) ||
    (plan.status === "started" && plan.startedAt && Date.parse(plan.startedAt) >= start)
      ? [{ kind: "plan", key: `plan:${plan.id}`, at: plan.proposedAt, plan }]
      : [],
  );
  if (shown.length === 0) return events;
  return [...events, ...shown].sort((a, b) => a.at.localeCompare(b.at));
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
  | { readonly kind: "card"; readonly key: string; readonly at: string }
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
  cards: ReadonlyArray<AldoPlaceable> = [],
): ReadonlyArray<AldoTimelineItem<E>> {
  const items: AldoTimelineItem<E>[] = [];
  const timed = [
    ...events.map((event) => ({ kind: "event" as const, at: event.at, key: event.key, event })),
    ...cards.map((card) => ({ kind: "card" as const, ...card })),
  ].toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key));
  let next = 0;
  const flush = (before: string | null) => {
    let run: AldoFeedEvent[] = [];
    const flushRun = () => {
      if (run.length > 0) items.push({ kind: "events", key: run[0]!.key, events: run });
      run = [];
    };
    for (; next < timed.length; next += 1) {
      const item = timed[next]!;
      if (before !== null && Date.parse(item.at) >= Date.parse(before)) break;
      if (item.kind === "card") {
        flushRun();
        items.push(item);
      } else run.push(item.event);
    }
    flushRun();
  };
  entries.forEach((entry, index) => {
    const at = timeOf(entry);
    if (at) flush(at);
    items.push({ kind: "entry", entry, index });
  });
  flush(null);
  return items;
}

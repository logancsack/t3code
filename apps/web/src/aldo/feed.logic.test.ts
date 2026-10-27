import { describe, expect, it } from "vite-plus/test";

import {
  type AldoHomeAction,
  type AldoHomeConversation,
  type AldoHomePullRequest,
} from "./homeApi";
import { liveCardIndexes } from "./assistant.logic";
import {
  dedupeLiveCards,
  digestOf,
  feedEvents,
  interleave,
  shippedStatus,
  withPlans,
} from "./feed.logic";
import { parseAldoPlan, type AldoPlan } from "./plans.logic";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const target = { environmentId: "aldo-m1", threadId: "t1" };

function conversation(overrides: Partial<AldoHomeConversation>): AldoHomeConversation {
  return {
    ref: "m1:t1",
    thread: target,
    title: "Inbox triage",
    repos: [],
    branch: "",
    state: "done",
    machine: "asleep",
    at: at(30),
    ...overrides,
  };
}

function action(overrides: Partial<AldoHomeAction>): AldoHomeAction {
  return {
    id: "a1",
    tool: "start_thread",
    title: "Book dinner",
    asked: "Book dinner",
    failed: false,
    error: null,
    thread: target,
    at: at(50),
    ...overrides,
  };
}

function pullRequest(overrides: Partial<AldoHomePullRequest>): AldoHomePullRequest {
  return {
    environmentId: "aldo-m1",
    thread: target,
    threadTitle: "Inbox triage",
    repo: "acme/app",
    number: 7,
    url: "https://github.com/acme/app/pull/7",
    title: "Ship the inbox",
    status: "merged",
    stage: "deployed",
    checks: null,
    deploy: { passed: 3, failed: 0, running: 0 },
    followups: 0,
    reviewsExhausted: false,
    greenSince: null,
    mergesAt: null,
    mergedAt: at(40),
    updatedAt: at(40),
    ...overrides,
  };
}

const empty = { conversations: [], pullRequests: [], actions: [] };
const quiet = { now: NOW, from: null };

describe("feedEvents", () => {
  it("reconciles a local start after navigating away and mounting the home page again", () => {
    const events = feedEvents(
      {
        ...empty,
        conversations: [conversation({ state: "working" })],
        actions: [action({ at: at(5) })],
      },
      {
        now: NOW,
        from: at(10),
        here: [{ tool: "start_thread", thread: target }],
      },
    );
    expect(events).toEqual([]);
  });
});

describe("what finished and shipped", () => {
  const check = { environmentId: "aldo-m1", threadId: "check" };
  const run = { environmentId: "aldo-m2", threadId: "run" };

  it("folds a pull request's check into its shipping, saying where it stands", () => {
    const checking = conversation({
      ref: "m1:check",
      thread: check,
      title: "Check: Ship the inbox",
      state: "working",
    });
    const events = feedEvents(
      {
        ...empty,
        conversations: [conversation({}), checking],
        pullRequests: [pullRequest({ check })],
      },
      quiet,
    );
    expect(events.map((e) => e.kind)).toEqual(["shipped", "finished"]);
    const shipped = events[0]!;
    if (shipped.kind !== "shipped") throw new Error("shipped first");
    expect(shippedStatus(shipped)).toBe("Checking");
    const checked = feedEvents(
      {
        ...empty,
        conversations: [{ ...checking, state: "done", stateAt: at(10) }],
        pullRequests: [pullRequest({ check })],
      },
      quiet,
    );
    expect(checked.map((e) => e.kind)).toEqual(["shipped"]);
    expect(
      shippedStatus(checked[0] as Extract<(typeof checked)[number], { kind: "shipped" }>),
    ).toBe("Deployed");
  });

  it("says a check that finished after its merge left the feed on a line of its own", () => {
    const checked = conversation({
      ref: "m1:check",
      thread: check,
      title: "Check: Ship the inbox",
      stateAt: at(10),
    });
    const events = feedEvents(
      { ...empty, conversations: [checked], pullRequests: [pullRequest({ check })] },
      { now: NOW, from: at(20) },
    );
    expect(events.map((e) => [e.kind, e.key])).toEqual([
      ["finished", expect.stringContaining("m1:check")],
    ]);
  });

  it("puts a routine's runs, and what they shipped, under the routine", () => {
    const runs = [
      conversation({
        ref: "m2:run",
        thread: run,
        title: "Client pin, Oct 16, 12:27 PM",
        routine: "rt1",
        stateAt: at(20),
      }),
      conversation({
        ref: "m2:run2",
        thread: { ...run, threadId: "run2" },
        title: "Client pin, Oct 16, 12:46 PM",
        routine: "rt1",
        stateAt: at(5),
      }),
    ];
    const events = feedEvents(
      {
        ...empty,
        conversations: [conversation({}), ...runs],
        pullRequests: [pullRequest({ thread: run, title: "Pin the web client" })],
        routines: [{ id: "rt1", title: "Client pin" } as never],
      },
      quiet,
    );
    expect(events.some((e) => e.kind === "shipped")).toBe(false);
    const digest = digestOf(events);
    expect(digest.label).toBe("1 finished · 2 routine runs");
    expect(digest.routines).toMatchObject([{ id: "rt1", title: "Client pin", runs: [{}, {}] }]);
    expect(digest.finished.map((e) => e.conversation.title)).toEqual(["Inbox triage"]);
  });

  it("leaves out a thread Aldo already said finished, but not one that finished again since", () => {
    const home = { ...empty, conversations: [conversation({ stateAt: at(30) })] };
    const told = [
      { text: "Inbox triage is done.\n\nThread: https://aldo.example/aldo-m1/t1", at: at(29) },
    ];
    expect(feedEvents(home, { ...quiet, told })).toEqual([]);
    expect(feedEvents(home, { ...quiet, told: [{ ...told[0]!, at: at(45) }] })).toHaveLength(1);
    expect(
      feedEvents(home, {
        ...quiet,
        told: [{ text: "Thread: https://aldo.example/aldo-m1/t2", at: at(29) }],
      }),
    ).toHaveLength(1);
  });

  it("shows plain lines when an older Aldo doesn't say what's a check or a run", () => {
    const events = feedEvents(
      {
        ...empty,
        conversations: [
          conversation({ title: "Check: Ship the inbox", thread: check, ref: "m1:check" }),
        ],
        pullRequests: [pullRequest({})],
      },
      quiet,
    );
    expect(digestOf(events).label).toBe("1 shipped · 1 finished");
  });
});

describe("conversation thread cards", () => {
  const start = { kind: "action", tool: "start_thread", open: target };
  const home = {
    ...empty,
    conversations: [conversation({ state: "working" })],
    actions: [action({})],
  };
  const cards = (entries: ReadonlyArray<typeof start>, saved = home) => {
    const live = liveCardIndexes(entries);
    const events = feedEvents(saved, {
      now: NOW,
      from: null,
      here: entries.map((entry) => ({ tool: entry.tool, thread: entry.open })),
    });
    const feed = dedupeLiveCards(
      events,
      [...live].map((index) => entries[index]!.open),
    );
    return live.size + feed.filter((event) => event.kind === "action" && event.live).length;
  };

  it("shows one card while the chat reply is pending, when it arrives, and after a reload", () => {
    expect(cards([])).toBe(1); // Saved activity arrives before the chat response.
    expect(cards([start])).toBe(1);
    expect(cards([start, start])).toBe(1); // A repeated tool result.
    expect(cards([])).toBe(1); // Reload: only persisted activity remains.
  });

  it("keeps one card when a restated start returns the existing thread", () => {
    const restated = {
      ...home,
      actions: [...home.actions, action({ id: "restated", at: at(49) })],
    };
    expect(cards([start], restated)).toBe(1);
    expect(cards([start, start], restated)).toBe(1);
    expect(cards([], restated)).toBe(1);
  });

  it("deduplicates by thread across feed and local cards even when the tool names differ", () => {
    expect(cards([{ ...start, tool: "message_thread" }])).toBe(1);
    const events = feedEvents(home, { now: NOW, from: null });
    const duplicate = dedupeLiveCards(events, [target]);
    expect(duplicate).toMatchObject([{ kind: "action", live: false }]);
    // Keep the audit line, and don't mutate the saved activity.
    expect(events).toMatchObject([{ kind: "action", live: true }]);
  });

  it("keeps only the newest feed card if a feed event is delivered twice", () => {
    const events = feedEvents(home, { now: NOW, from: null });
    expect(dedupeLiveCards([...events, ...events], [])).toMatchObject([
      { live: false },
      { live: true },
    ]);
  });

  it("keeps distinct threads and the same thread id on another environment", () => {
    const events = feedEvents(home, { now: NOW, from: null });
    expect(
      dedupeLiveCards(events, [
        { ...target, threadId: "another-thread" },
        { ...target, environmentId: "aldo-other" },
      ]),
    ).toMatchObject([{ live: true }]);
  });
});

describe("a card for every thread", () => {
  const manual = target;
  const other = { environmentId: "aldo-m1", threadId: "t2" };
  const cardsOf = (
    events: ReturnType<typeof feedEvents>,
    shown: ReadonlyArray<typeof target> = [],
  ) =>
    dedupeLiveCards(events, shown).filter(
      (e) => e.kind === "thread" || (e.kind === "action" && e.live),
    );

  it("puts a thread started anywhere at its start, live, once", () => {
    const events = feedEvents(
      { ...empty, conversations: [conversation({ state: "working", startedAt: at(20) })] },
      quiet,
    );
    expect(events).toMatchObject([{ kind: "thread", at: at(20) }]);
    expect(cardsOf(events)).toHaveLength(1);
  });

  it("leaves a server that doesn't say when threads started as it was", () => {
    const events = feedEvents(
      { ...empty, conversations: [conversation({ state: "working" })] },
      quiet,
    );
    expect(events).toEqual([]);
  });

  it("moves the card to what Aldo last did about the thread", () => {
    const events = feedEvents(
      {
        ...empty,
        conversations: [conversation({ state: "working", startedAt: at(40) })],
        actions: [action({ tool: "message_thread", at: at(10) })],
      },
      quiet,
    );
    expect(cardsOf(events)).toMatchObject([{ kind: "action", at: at(10) }]);
  });

  it("gives the card to the page when it shows the thread itself", () => {
    const events = feedEvents(
      { ...empty, conversations: [conversation({ state: "working", startedAt: at(20) })] },
      quiet,
    );
    expect(cardsOf(events, [manual])).toEqual([]);
  });

  it("settles a finished thread into its line where its card was", () => {
    const events = feedEvents(
      {
        ...empty,
        conversations: [
          conversation({ state: "done", startedAt: at(40), stateAt: at(5) }),
          conversation({ ref: "m1:t2", thread: other, state: "working", startedAt: at(30) }),
        ],
        actions: [action({ at: at(39) })],
      },
      quiet,
    );
    // Where its card was (Aldo's start, after its creation), which its line says; nothing comes when it finished.
    expect(events).toMatchObject([
      { kind: "finished", at: at(39), settled: true },
      { kind: "thread", at: at(30) },
    ]);
  });

  it("settles a routine's run into the routine's line", () => {
    const events = feedEvents(
      {
        ...empty,
        conversations: [
          conversation({ state: "done", routine: "r1", startedAt: at(15), stateAt: at(2) }),
        ],
        routines: [{ id: "r1", title: "Morning brief" }] as never,
      },
      quiet,
    );
    expect(digestOf(events).label).toBe("1 routine run");
  });

  it("drops the settled line where the page shows the thread's card", () => {
    const events = feedEvents(
      { ...empty, conversations: [conversation({ state: "done", startedAt: at(40) })] },
      quiet,
    );
    expect(dedupeLiveCards(events, [manual])).toEqual([]);
    expect(dedupeLiveCards(events, [])).toHaveLength(1);
  });
});

describe("plans", () => {
  const plan = (overrides: Record<string, unknown>): AldoPlan =>
    parseAldoPlan({
      id: "plan-1",
      goal: "Launch videos",
      steps: ["Gather the brand kit", "Cut the videos"],
      cost: "It costs nothing.",
      minutes: 30,
      status: "started",
      proposedAt: at(20),
      startedAt: at(18),
      startedBy: "user",
      thread: target,
      ...overrides,
    })!;

  it("keeps a started plan where it was proposed, among the rest", () => {
    const events = withPlans(
      feedEvents({ ...empty, actions: [action({ tool: "start_plan", at: at(17) })] }, quiet),
      [plan({})],
      quiet,
    );
    expect(events.map((e) => e.kind)).toEqual(["plan", "action"]);
    expect(events[0]).toMatchObject({ key: "plan:plan-1", at: at(20) });
  });

  it("includes open plans in the timeline and leaves out plans started before it began", () => {
    const open = plan({ id: "open", status: "proposed", startedAt: null });
    const before = plan({ id: "before", startedAt: at(90) });
    expect(withPlans([], [open, before], { now: NOW, from: at(60) })).toEqual([
      { kind: "plan", key: "plan:open", at: open.proposedAt, plan: open },
    ]);
  });
});

describe("interleave", () => {
  it("orders cards with messages and splits activity runs at each card", () => {
    const messages = [{ at: at(50) }, { at: at(10) }];
    const events = feedEvents(
      {
        ...empty,
        actions: [action({ id: "first", at: at(40) }), action({ id: "second", at: at(20) })],
      },
      quiet,
    );
    const items = interleave(messages, events, (m) => m.at, [
      { key: "latest", at: at(5) },
      { key: "middle", at: at(30) },
      { key: "oldest", at: at(60) },
    ]);
    expect(items.map((item) => (item.kind === "entry" ? item.entry.at : item.key))).toEqual([
      "oldest",
      at(50),
      "action:first",
      "middle",
      "action:second",
      at(10),
      "latest",
    ]);
    expect(interleave([], [], () => null, [{ key: "only", at: at(1) }])).toEqual([
      { kind: "card", key: "only", at: at(1) },
    ]);
  });
});

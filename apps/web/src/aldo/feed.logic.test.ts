import { describe, expect, it } from "vite-plus/test";

import {
  type AldoHomeAction,
  type AldoHomeConversation,
  type AldoHomePullRequest,
} from "./homeApi";
import { liveCardIndexes } from "./assistant.logic";
import { dedupeLiveCards, feedEvents, interleave } from "./feed.logic";

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

function pullRequest(overrides: Partial<AldoHomePullRequest>): AldoHomePullRequest {
  return {
    environmentId: "aldo-m1",
    thread: target,
    threadTitle: "Speed up the sidebar",
    repo: "logancsack/t3code",
    number: 231,
    url: "https://github.com/logancsack/t3code/pull/231",
    title: "Virtualize the sidebar",
    status: "merged",
    stage: "deployed",
    checks: null,
    deploy: null,
    followups: 0,
    reviewsExhausted: false,
    greenSince: null,
    mergesAt: null,
    mergedAt: at(20),
    updatedAt: at(20),
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

const empty = { conversations: [], pullRequests: [], actions: [] };

describe("feedEvents", () => {
  it("shows what finished and shipped, and saved actions, oldest first", () => {
    const events = feedEvents(
      {
        conversations: [conversation({ stateAt: at(30) })],
        pullRequests: [pullRequest({})],
        actions: [action({})],
      },
      { now: NOW, from: null },
    );
    expect(events.map((e) => e.kind)).toEqual(["action", "finished", "shipped"]);
  });

  it("leaves out what's still going, put away, failed, or older than the window", () => {
    const events = feedEvents(
      {
        conversations: [
          conversation({ ref: "a", state: "working" }),
          conversation({ ref: "b", settled: true }),
          conversation({ ref: "c", stateAt: at(60 * 24 * 3) }),
        ],
        pullRequests: [pullRequest({ status: "watching", mergedAt: null })],
        actions: [action({ failed: true }), action({ id: "a2", tool: "rename_thread" })],
      },
      { now: NOW, from: null },
    );
    expect(events).toEqual([]);
  });

  it("starts where the conversation does, and leaves this page's own actions to it", () => {
    const events = feedEvents(
      {
        ...empty,
        conversations: [conversation({ stateAt: at(90) })],
        actions: [action({ at: at(5) })],
      },
      {
        now: NOW,
        from: at(60),
        here: [{ tool: "start_thread", thread: target }],
      },
    );
    expect(events).toEqual([]);
  });

  it("shows what Aldo did from another device", () => {
    const events = feedEvents(
      {
        ...empty,
        actions: [
          action({ id: "here", at: at(5) }),
          action({ id: "there", tool: "message_thread", at: at(4) }),
          action({
            id: "elsewhere",
            at: at(3),
            thread: { environmentId: "aldo-m2", threadId: "t2" },
          }),
        ],
      },
      {
        now: NOW,
        from: null,
        here: [{ tool: "start_thread", thread: target }],
      },
    );
    expect(events.map((e) => e.key)).toEqual(["action:there", "action:elsewhere"]);
  });

  it("leaves out only one of Aldo's actions for each of the page's own", () => {
    const events = feedEvents(
      {
        ...empty,
        actions: [
          action({ id: "here", tool: "message_thread", at: at(5) }),
          action({ id: "again", tool: "message_thread", at: at(2) }),
        ],
      },
      {
        now: NOW,
        from: null,
        here: [{ tool: "message_thread", thread: target }],
      },
    );
    expect(events.map((e) => e.key)).toEqual(["action:again"]);
  });

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

  it("shows the newest action on a thread that's still going live", () => {
    const events = feedEvents(
      {
        ...empty,
        conversations: [conversation({ state: "working" })],
        actions: [
          action({ id: "a1", at: at(50) }),
          action({ id: "a2", tool: "message_thread", at: at(20) }),
        ],
      },
      { now: NOW, from: null },
    );
    expect(events.map((e) => (e.kind === "action" ? e.live : null))).toEqual([false, true]);
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

describe("interleave", () => {
  const said = (minutesAgo: number, text: string) => ({ at: at(minutesAgo), text });

  it("puts each run of events between what was said around it", () => {
    const events = feedEvents(
      {
        ...empty,
        conversations: [
          conversation({ ref: "x", stateAt: at(40) }),
          conversation({ ref: "y", stateAt: at(35) }),
          conversation({ ref: "z", stateAt: at(5) }),
        ],
      },
      { now: NOW, from: null },
    );
    const items = interleave([said(60, "hi"), said(20, "and?")], events, (e) => e.at);
    expect(
      items.map((item) =>
        item.kind === "entry" ? item.entry.text : item.events.map((e) => e.key).join(","),
      ),
    ).toEqual(["hi", `finished:x:${at(40)},finished:y:${at(35)}`, "and?", `finished:z:${at(5)}`]);
  });

  it("keeps an untimed entry with what was said before it", () => {
    const events = feedEvents(
      { ...empty, conversations: [conversation({ stateAt: at(30) })] },
      { now: NOW, from: null },
    );
    const items = interleave<{ at?: string; text: string }>(
      [said(40, "start it"), { text: "Started a thread" }, said(10, "thanks")],
      events,
      (e) => e.at ?? null,
    );
    expect(items.map((item) => (item.kind === "entry" ? item.entry.text : "events"))).toEqual([
      "start it",
      "Started a thread",
      "events",
      "thanks",
    ]);
  });
});

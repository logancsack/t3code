import { describe, expect, it } from "vite-plus/test";

import { type AldoHomeAction, type AldoHomeConversation } from "./homeApi";
import { liveCardIndexes } from "./assistant.logic";
import { dedupeLiveCards, feedEvents } from "./feed.logic";

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

const empty = { conversations: [], pullRequests: [], actions: [] };

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

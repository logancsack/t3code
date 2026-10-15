import { describe, expect, it } from "vite-plus/test";

import type { AldoHomeAction, AldoHomeConversation, AldoHomePullRequest } from "./cloud";
import { feedEvents, interleave } from "./feed.logic";

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
  it("shows what finished and shipped, and what Aldo did before the page opened, oldest first", () => {
    const events = feedEvents(
      {
        conversations: [conversation({ stateAt: at(30) })],
        pullRequests: [pullRequest({})],
        actions: [action({})],
      },
      { now: NOW, from: null, until: NOW },
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
      { now: NOW, from: null, until: NOW },
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
      { now: NOW, from: at(60), until: NOW - 10 * 60_000 },
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
      { now: NOW, from: null, until: NOW },
    );
    expect(events.map((e) => (e.kind === "action" ? e.live : null))).toEqual([false, true]);
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
      { now: NOW, from: null, until: NOW },
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
      { now: NOW, from: null, until: NOW },
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

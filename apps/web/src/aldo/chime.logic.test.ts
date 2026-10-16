import { describe, expect, it } from "vite-plus/test";

import { CHIME_GAP_MS, chimeMemory, chimeNews, shouldChime } from "./chime.logic";
import type { AldoHomeConversation } from "./cloud";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const at = (id: string) => ({ environmentId: `aldo-${id}`, threadId: id });

function conversation(over: Partial<AldoHomeConversation> = {}): AldoHomeConversation {
  return {
    ref: "t1",
    thread: at("t1"),
    title: "Fix checkout",
    repos: ["acme/shop"],
    branch: "aldo/t1",
    state: "working",
    machine: "running",
    at: ago(5),
    ...over,
  };
}

const question = (requestId: string) =>
  ({
    kind: "question",
    requestId,
    questions: [{ id: "q", header: "", question: "Which?", options: [], multiSelect: false }],
  }) as const;

/** The news between two reads, with no one looking at anything. */
const news = (before: AldoHomeConversation[], after: AldoHomeConversation[]) =>
  chimeNews(chimeMemory(before), after, NOW, null).map((c) => c.ref);

describe("chimeNews", () => {
  it("is quiet on the first read", () => {
    expect(chimeNews(null, [conversation({ state: "done" })], NOW, null)).toEqual([]);
  });

  it("hears a conversation finish", () => {
    expect(news([conversation()], [conversation({ state: "done" })])).toEqual(["t1"]);
  });

  it("hears one finish from waiting on a reply, or from starting", () => {
    expect(news([conversation({ state: "waiting" })], [conversation({ state: "done" })])).toEqual([
      "t1",
    ]);
    expect(news([conversation({ state: "new" })], [conversation({ state: "done" })])).toEqual([
      "t1",
    ]);
  });

  it("hears a conversation come to need the user", () => {
    const asking = conversation({ state: "waiting", pending: question("r1") });
    expect(news([conversation()], [asking])).toEqual(["t1"]);
    expect(news([conversation()], [conversation({ state: "failed" })])).toEqual(["t1"]);
    expect(news([conversation()], [conversation({ state: "paused" })])).toEqual(["t1"]);
    expect(
      news(
        [conversation()],
        [conversation({ state: "waiting", plan: { id: "p1", text: "1. Do it" } })],
      ),
    ).toEqual(["t1"]);
  });

  it("hears each transition once", () => {
    const done = conversation({ state: "done" });
    const asking = conversation({ state: "waiting", pending: question("r1") });
    expect(news([done], [done])).toEqual([]);
    expect(news([asking], [asking])).toEqual([]);
  });

  it("hears a new question that came between two reads", () => {
    expect(
      news(
        [conversation({ state: "waiting", pending: question("r1") })],
        [conversation({ state: "waiting", pending: question("r2") })],
      ),
    ).toEqual(["t1"]);
  });

  it("is quiet for what doesn't finish or ask", () => {
    expect(news([conversation({ state: "new" })], [conversation()])).toEqual([]);
    expect(news([conversation({ state: "waiting" })], [conversation()])).toEqual([]);
    expect(news([conversation({ state: "done" })], [conversation()])).toEqual([]);
  });

  it("is quiet for a conversation it hadn't seen", () => {
    expect(news([], [conversation({ state: "done" })])).toEqual([]);
  });

  it("is quiet for a conversation put away", () => {
    const later = new Date(NOW + 60 * 60_000).toISOString();
    expect(news([conversation()], [conversation({ state: "done", snoozedUntil: later })])).toEqual(
      [],
    );
    expect(news([conversation()], [conversation({ state: "failed", settled: true })])).toEqual([]);
  });

  it("is quiet for the conversation the user is looking at", () => {
    const before = chimeMemory([conversation(), conversation({ ref: "t2", thread: at("t2") })]);
    const after = [
      conversation({ state: "done" }),
      conversation({ ref: "t2", thread: at("t2"), state: "done" }),
    ];
    expect(chimeNews(before, after, NOW, at("t1")).map((c) => c.ref)).toEqual(["t2"]);
  });

  it("hears several at once", () => {
    const before = [conversation(), conversation({ ref: "t2", thread: at("t2") })];
    const after = [
      conversation({ state: "done" }),
      conversation({ ref: "t2", thread: at("t2"), state: "failed" }),
    ];
    expect(news(before, after)).toEqual(["t1", "t2"]);
  });
});

describe("shouldChime", () => {
  it("plays for news", () => {
    expect(shouldChime(1, null, NOW)).toBe(true);
    expect(shouldChime(0, null, NOW)).toBe(false);
  });

  it("leaves a few seconds between sounds", () => {
    expect(shouldChime(1, NOW - 1_000, NOW)).toBe(false);
    expect(shouldChime(1, NOW - CHIME_GAP_MS, NOW)).toBe(true);
  });
});

import { describe, expect, it } from "vite-plus/test";

import {
  type AldoApproval,
  type AldoHome,
  type AldoHomeConversation,
  type AldoHomePending,
  type AldoHomePullRequest,
} from "./homeApi";
import {
  aldoDecisions,
  aldoChatDecisions,
  aldoHiddenFromChat,
  aldoWaitingCount,
  decidesInPlace,
  decisionAsk,
  decisionBrief,
  decisionOpen,
  decisionTitle,
  placeDecisions,
  placeableOf,
} from "./decisions.logic";

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
    machine: "asleep",
    at: ago(5),
    ...over,
  };
}

function pullRequest(over: Partial<AldoHomePullRequest> = {}): AldoHomePullRequest {
  return {
    environmentId: "aldo-t1",
    thread: at("t1"),
    threadTitle: "Fix checkout",
    repo: "acme/shop",
    number: 12,
    url: "https://github.com/acme/shop/pull/12",
    title: "Fix checkout totals",
    status: "watching",
    stage: "green",
    checks: { passed: 5, failed: 0, running: 1 },
    deploy: null,
    followups: 0,
    reviewsExhausted: false,
    greenSince: ago(3),
    mergesAt: null,
    mergedAt: null,
    updatedAt: ago(1),
    ...over,
  };
}

function approval(id: string, over: Partial<AldoApproval> = {}): AldoApproval {
  return {
    id,
    kind: "email",
    provider: "google",
    title: "Reply to The Hoxton",
    summary: "To maya@example.com",
    fields: [],
    body: "Nov 12 works.",
    approveLabel: "Send",
    discardLabel: "Discard",
    status: "pending",
    result: null,
    failed: false,
    thread: null,
    threadTitle: null,
    createdAt: ago(20),
    decidedAt: null,
    ...over,
  };
}

function home(over: Partial<AldoHome> = {}): AldoHome {
  return {
    at: ago(0),
    conversations: [],
    pullRequests: [],
    upcoming: [],
    approvals: [],
    actions: [],
    usage: {
      configured: true,
      metered: false,
      plan: null,
      period: null,
      credits: null,
      bill: null,
      alert: "none",
      agents: { running: 0, limit: null },
    },
    spends: { once: 0, monthly: 0, recent: [] },
    health: { providers: [], connected: [], environments: [] },
    policy: { everywhere: {}, workspaces: [] },
    ...over,
  };
}

const question = conversation({
  ref: "q",
  thread: at("q"),
  title: "Add usage alerts",
  state: "waiting",
  at: ago(30),
  pending: {
    kind: "question",
    requestId: "r1",
    questions: [
      {
        id: "threshold",
        header: "Threshold",
        question: "80% or 90%?",
        options: [
          { label: "80%", description: "" },
          { label: "90%", description: "" },
        ],
        multiSelect: false,
      },
    ],
  },
});

describe("aldoDecisions", () => {
  it("lists Aldo's approvals, then threads longest waiting first, then what can merge", () => {
    const decisions = aldoDecisions(
      home({
        approvals: [approval("ap"), approval("gone", { status: "approved" })],
        conversations: [
          conversation({ ref: "f", thread: at("f"), state: "failed", at: ago(10) }),
          question,
          conversation({ ref: "w", thread: at("w"), state: "working" }),
        ],
        pullRequests: [
          pullRequest({ thread: at("m"), number: 131 }),
          // Its thread is on the list already: its question comes first.
          pullRequest({ thread: at("q"), number: 7 }),
          pullRequest({ thread: at("x"), number: 8, stage: "checks-running" }),
        ],
      }),
      NOW,
    );
    expect(decisions.map((d) => d.key)).toEqual([
      "aldo:ap",
      "question:q:r1",
      `failed:f:${ago(10)}`,
      "merge:acme/shop#131",
    ]);
  });

  it("leaves out what isn't the user's to decide now", () => {
    const decisions = aldoDecisions(
      home({
        approvals: [approval("sending", { status: "sending" })],
        conversations: [
          { ...question, settled: true },
          conversation({ ref: "z", thread: at("z"), state: "failed", snoozedUntil: ago(-60) }),
          // Snoozed, but it asks: it raised its hand.
          { ...question, ref: "s", thread: at("s"), snoozedUntil: ago(-60) },
          // Paused mid-turn: opening it carries on, nothing to decide (its pull request still can be).
          conversation({ ref: "p", thread: at("p"), state: "paused" }),
        ],
        pullRequests: [
          pullRequest({ thread: at("m"), mergesAt: ago(-5) }),
          pullRequest({ thread: at("p"), number: 9 }),
        ],
      }),
      NOW,
    );
    expect(decisions.map((d) => d.key)).toEqual(["question:s:r1", "merge:acme/shop#9"]);
  });

  it("counts threads paused mid-turn among what waits, though they aren't decisions", () => {
    const read = home({
      conversations: [
        { ...question, ref: "s", thread: at("s") },
        conversation({ ref: "p", thread: at("p"), state: "paused", machine: "asleep" }),
        // An older Aldo's read of one.
        conversation({ ref: "o", thread: at("o"), state: "working", machine: "asleep" }),
        conversation({
          ref: "x",
          thread: at("x"),
          state: "paused",
          machine: "asleep",
          settled: true,
        }),
        conversation({ ref: "w", thread: at("w"), state: "working", machine: "running" }),
      ],
    });
    expect(aldoDecisions(read, NOW).map((d) => d.key)).toEqual(["question:s:r1"]);
    expect(aldoWaitingCount(read, NOW)).toBe(3);
  });

  it("puts away a thread's pull request with it, and wakes a snooze that has run out", () => {
    const decisions = aldoDecisions(
      home({
        conversations: [
          conversation({ ref: "p", thread: at("p"), state: "done", settled: true }),
          conversation({ ref: "w", thread: at("w"), state: "failed", snoozedUntil: ago(1) }),
        ],
        pullRequests: [pullRequest({ thread: at("p") })],
      }),
      NOW,
    );
    expect(decisions.map((d) => d.key)).toEqual([`failed:w:${ago(5)}`]);
  });

  it("keys what waits otherwise by when it got there, not by a rename since", () => {
    const [failed] = aldoDecisions(
      home({
        conversations: [
          conversation({
            ref: "f",
            thread: at("f"),
            state: "failed",
            at: ago(1),
            stateAt: ago(40),
          }),
        ],
      }),
      NOW,
    );
    expect(failed!.key).toBe(`failed:f:${ago(40)}`);
  });

  it("tells Aldo what a step that needs the user's yes is", () => {
    const [confirm] = aldoDecisions(
      home({
        approvals: [
          approval("buy", { kind: "confirm", title: "Book the loft", approveLabel: "Book" }),
        ],
      }),
      NOW,
    );
    expect(decisionBrief(confirm!)).toContain("only once the user says yes");
  });

  it("lists what an agent waits on the user for in its browser, keyed by the request", () => {
    const asking = conversation({
      ref: "t9",
      thread: at("t9"),
      title: "Dinner Friday",
      state: "waiting",
      at: ago(2),
      pending: {
        kind: "handoff",
        requestId: "ho_1",
        summary: "OpenTable wants to check you're human",
      },
    });
    const [decision] = aldoDecisions(home({ conversations: [asking] }), NOW);
    expect(decision?.kind).toBe("handoff");
    expect(decision?.key).toBe("handoff:t9:ho_1");
    expect(decision && decidesInPlace(decision)).toBe(true);
    expect(decision && decisionAsk(decision)).toBe("OpenTable wants to check you're human");
    expect(decision && decisionBrief(decision)).toContain("needs the user in its browser");
  });

  it("keys a question by what it asks: a new one is a new decision", () => {
    const before = home({ conversations: [question] });
    const after = home({
      conversations: [
        {
          ...question,
          pending: { ...(question.pending as AldoHomePending), requestId: "r2" },
        },
      ],
    });
    expect(decisionOpen(before, "question:q:r1", NOW)).toBe(true);
    expect(decisionOpen(after, "question:q:r1", NOW)).toBe(false);
  });

  it("says what each is and asks, and what Aldo is told of it", () => {
    const [ask, merge] = aldoDecisions(
      home({ conversations: [question], pullRequests: [pullRequest({ thread: at("m") })] }),
      NOW,
    );
    expect(decisionTitle(ask!)).toBe("Add usage alerts");
    expect(decisionAsk(ask!)).toBe("80% or 90%?");
    expect(decisionBrief(ask!)).toContain('choices: "80%", "90%"');
    expect(decisionTitle(merge!)).toBe("Merge #12 Fix checkout totals");
    expect(decisionAsk(merge!)).toBe("5/6 checks");
    expect(decidesInPlace(ask!)).toBe(true);
    expect(
      decidesInPlace(
        aldoDecisions(home({ conversations: [conversation({ state: "failed" })] }), NOW)[0]!,
      ),
    ).toBe(false);
  });
});

it("keeps a hidden question waiting in overview while removing only its chat card", () => {
  const hidden = { ...question, chatDecision: { id: "request-one", dismissed: true } };
  const read = home({ conversations: [hidden] });
  expect(aldoChatDecisions(read, NOW)).toHaveLength(0);
  expect(aldoDecisions(read, NOW)).toHaveLength(1);
  expect(aldoWaitingCount(read, NOW)).toBe(1);
  // Aldo's conversation lists it under its name, to show again, and doesn't count it.
  expect(aldoHiddenFromChat(read, NOW)).toEqual([
    { title: hidden.title, chatDecision: hidden.chatDecision },
  ]);
  expect(aldoHiddenFromChat(home({ conversations: [question] }), NOW)).toEqual([]);
  expect(hidden.state).toBe("waiting");
  expect(hidden.pending).toEqual(question.pending);
  // A fresh read (another device or reload) follows the server's dismissal.
  expect(aldoChatDecisions(JSON.parse(JSON.stringify(read)), NOW)).toHaveLength(0);
  const next = {
    ...question,
    pending: { ...question.pending!, requestId: "request-two" },
    chatDecision: { id: "request-two", dismissed: false },
  };
  expect(aldoChatDecisions(home({ conversations: [next] }), NOW)).toHaveLength(1);
});

it("all card kinds support chat dismissal without changing the full decision list", () => {
  const hidden = { id: "hidden", dismissed: true };
  const read = home({
    approvals: [approval("a", { chatDecision: hidden })],
    conversations: [
      { ...question, chatDecision: hidden },
      conversation({
        ref: "plan",
        thread: at("plan"),
        state: "waiting",
        plan: { id: "p", text: "Plan" },
        chatDecision: hidden,
      }),
      conversation({
        ref: "permission",
        thread: at("permission"),
        state: "waiting",
        pending: { kind: "approval", requestId: "a", summary: "Allow?", options: [] },
        chatDecision: hidden,
      }),
      conversation({
        ref: "handoff",
        thread: at("handoff"),
        state: "waiting",
        pending: { kind: "handoff", requestId: "h", summary: "Sign in" },
        chatDecision: hidden,
      }),
      conversation({
        ref: "computer",
        thread: at("computer"),
        state: "waiting",
        summary: "Needs your computer",
        chatDecision: hidden,
      }),
      conversation({ ref: "failed", thread: at("failed"), state: "failed", chatDecision: hidden }),
    ],
    pullRequests: [pullRequest({ thread: at("merge"), chatDecision: hidden })],
  });
  expect(aldoDecisions(read, NOW)).toHaveLength(8);
  expect(aldoChatDecisions(read, NOW)).toHaveLength(0);
});

it("older servers still show their prompts", () => {
  expect(aldoChatDecisions(home({ conversations: [question] }), NOW)).toHaveLength(1);
});

describe("placeDecisions", () => {
  const t = (minute: number, seconds = 0) =>
    new Date(Date.UTC(2026, 9, 21, 15, minute, seconds)).toISOString();
  // You (1), Aldo (2), what Aldo did (no time), what happened (5), you (10), Aldo (20).
  const items = [
    { at: t(1), reply: false },
    { at: t(2), reply: true },
    { at: null, reply: false },
    { at: t(5), reply: false },
    { at: t(10), reply: false },
    { at: t(20), reply: true },
  ];

  it("puts each under what came last before it, never between a reply and what it did", () => {
    const placed = placeDecisions(items, [
      { key: "a", at: t(3) },
      { key: "b", at: t(4) },
      { key: "c", at: t(7) },
    ]);
    expect([...placed.before]).toEqual([
      [3, ["a", "b"]],
      [4, ["c"]],
    ]);
    // Decided, its line stays where the card was.
    expect(placed.at.get("a")).toBe(t(3));
  });

  it("puts what came up in Aldo's turn under its reply, not over it", () => {
    // Drafted at 1:30, while Aldo answered the user; its reply came at 2.
    const placed = placeDecisions(items, [{ key: "draft", at: t(1, 30) }]);
    expect([...placed.before]).toEqual([[3, ["draft"]]]);
    expect(placed.at.get("draft")).toBe(new Date(Date.parse(t(2)) + 1).toISOString());
  });

  it("leaves what came up after everything, or before it all, for the end", () => {
    const placed = placeDecisions(items, [
      { key: "late", at: t(21) },
      { key: "old", at: t(0) },
      { key: "same", at: t(20) },
      // Just before Aldo's last reply: under it, so at the end.
      { key: "turn", at: t(19) },
    ]);
    expect(placed.before.size).toBe(0);
    expect(placeDecisions([], [{ key: "a", at: t(3) }]).before.size).toBe(0);
  });

  it("puts a draft Aldo rewrote under the reply that said so", () => {
    // Rewritten at 10:30, Aldo's reply at 20: the end, under it.
    expect(placeDecisions(items, [{ key: "d", at: t(10, 30), afterReply: true }]).before.size).toBe(
      0,
    );
    // Rewritten at 1:30, under the reply at 2, after what it did.
    const placed = placeDecisions(items, [{ key: "d", at: t(1, 30), afterReply: true }]);
    expect([...placed.before]).toEqual([[3, ["d"]]]);
    expect(placed.at.get("d")).toBe(new Date(Date.parse(t(2)) + 1).toISOString());
  });
});

describe("decisionAt", () => {
  it("is when it came up: an approval's ask, or its rewrite", () => {
    const read = home({
      approvals: [
        approval("ap1", { createdAt: "2026-10-21T15:00:00.000Z" }),
        approval("ap2", {
          createdAt: "2026-10-21T15:00:00.000Z",
          revisedAt: "2026-10-21T15:20:00.000Z",
          previous: { title: "x", body: "y" },
        }),
      ],
    });
    const [first, second] = aldoDecisions(read, NOW);
    expect(placeableOf(first!)).toEqual({ key: "aldo:ap1", at: "2026-10-21T15:00:00.000Z" });
    expect(placeableOf(second!)).toEqual({
      key: "aldo:ap2",
      at: "2026-10-21T15:20:00.000Z",
      afterReply: true,
    });
    // What the brief brought up goes under it; a rewrite still goes under its reply.
    const brief = { at: "2026-10-21T16:00:00.000Z", keys: new Set(["aldo:ap1", "aldo:ap2"]) };
    expect(placeableOf(first!, brief)).toEqual({ key: "aldo:ap1", at: brief.at, afterReply: true });
    expect(placeableOf(second!, brief)).toEqual({
      key: "aldo:ap2",
      at: "2026-10-21T15:20:00.000Z",
      afterReply: true,
    });
    expect(placeableOf(first!, null)).toEqual({ key: "aldo:ap1", at: "2026-10-21T15:00:00.000Z" });
  });
});

import { describe, expect, it } from "vite-plus/test";

import type {
  AldoApproval,
  AldoHome,
  AldoHomeConversation,
  AldoHomePending,
  AldoHomePullRequest,
} from "./cloud";
import {
  aldoDecisions,
  decidesInPlace,
  decisionAsk,
  decisionBrief,
  decisionOpen,
  decisionTitle,
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
        ],
        pullRequests: [pullRequest({ thread: at("m"), mergesAt: ago(-5) })],
      }),
      NOW,
    );
    expect(decisions.map((d) => d.key)).toEqual(["question:s:r1"]);
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

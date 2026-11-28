import { describe, expect, it } from "vite-plus/test";
import { aldoWaitingCount } from "./needsYou.logic";

import {
  type AldoApproval,
  type AldoHome,
  type AldoHomeConversation,
  type AldoHomePending,
  type AldoHomePullRequest,
} from "./homeApi";
import { boardFor } from "./home.logic";
import { simpleNeedsYou } from "./simpleMode.logic";
import { summonSections } from "./summon.logic";
import {
  aldoDecisions,
  aldoChatDecisions,
  boardAskingOnce,
  aldoHiddenFromChat,
  decidesInPlace,
  decisionAsk,
  decisionBrief,
  decisionOpen,
  decisionTitle,
  decisionAt,
} from "./decisions.logic";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const at = (id: string) => ({ environmentId: `aldo-${id}`, threadId: id });

const ASKED = {
  kind: "question" as const,
  requestId: "ask:turn",
  questions: [
    {
      id: "q",
      header: "",
      question: "Which account should I use?",
      options: [
        { label: "Personal", description: "" },
        { label: "Work", description: "" },
      ],
      multiSelect: false,
    },
  ],
};
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
    ...(over.state === "waiting" && !("pending" in over) && !("plan" in over)
      ? { pending: ASKED }
      : {}),
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
          // Snoozed, and only waits: Aldo's plain words for how its turn ended don't raise a hand.
          {
            ...question,
            ref: "t",
            thread: at("t"),
            snoozedUntil: ago(-60),
            pending: { ...question.pending!, requestId: "ask:turn-1" },
          },
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

  it("asks a step on an approval card once: its thread's turn-end ask isn't another decision", () => {
    const turnAsk = (ref: string) => ({
      ...question,
      ref,
      thread: at(ref),
      pending: { ...question.pending!, requestId: `ask:turn-${ref}` },
    });
    const card = (ref: string, over: Partial<AldoApproval> = {}) =>
      approval(`ap-${ref}`, { kind: "confirm", thread: at(ref), ...over });
    const read = home({
      approvals: [
        card("asks"),
        card("waits"),
        card("stopped"),
        card("planned"),
        card("failed"),
        // Decided, or a card for another thread: the thread's own ask stays.
        card("decided", { status: "approved" }),
        card("elsewhere", { thread: at("other") }),
        // Being carried out: decided, and its thread hasn't caught up yet.
        card("carried", { status: "sending" }),
        card("planasks"),
      ],
      conversations: [
        // The paid step's card is the ask; the words its turn ended on repeat it.
        turnAsk("asks"),
        conversation({ ref: "waits", thread: at("waits"), state: "waiting" }),
        // A request it's stopped on, a plan to start and a failure are their own decisions.
        { ...question, ref: "stopped", thread: at("stopped") },
        conversation({
          ref: "planned",
          thread: at("planned"),
          state: "waiting",
          plan: { id: "p1", text: "1. Buy it" },
        }),
        conversation({ ref: "failed", thread: at("failed"), state: "failed", at: ago(3) }),
        turnAsk("decided"),
        turnAsk("elsewhere"),
        turnAsk("carried"),
        // A plan to start is its own decision, as Aldo's brief has it.
        { ...turnAsk("planasks"), plan: { id: "p2", text: "1. Buy it" } },
      ],
      // A payment for the same thread is listed with the payments, not as the thread's form.
      payments: [
        {
          id: "pay-asks",
          merchant: "Excalidraw",
          site: "https://excalidraw.com",
          total: "$7.00",
          items: [],
          context: "One month of Plus",
          status: "pending_approval",
          approvalUrl: "https://link.example/approve",
          expiresAt: null,
          cardLast4: null,
          test: true,
          thread: at("asks"),
          threadTitle: "asks",
          createdAt: ago(4),
          updatedAt: ago(4),
        },
      ],
    });
    const keys = aldoDecisions(read, NOW).map((d) => d.key);
    expect(keys.filter((k) => !k.startsWith("aldo:")).toSorted()).toEqual([
      `failed:failed:${ago(3)}`,
      "payment:pay-asks",
      "plan:planned:p1",
      "question:decided:ask:turn-decided",
      "question:elsewhere:ask:turn-elsewhere",
      "question:planasks:ask:turn-planasks",
      "question:stopped:r1",
    ]);
    expect(keys.filter((k) => k.startsWith("aldo:"))).toEqual([
      "aldo:ap-asks",
      "aldo:ap-waits",
      "aldo:ap-stopped",
      "aldo:ap-planned",
      "aldo:ap-failed",
      "aldo:ap-elsewhere",
      "aldo:ap-planasks",
    ]);
    // The count says the same: one thing per step (and the payment).
    expect(aldoWaitingCount(read, NOW)).toBe(keys.length);
    // And so does every list of what waits: simple mode's Needs you lists the
    // card, not its thread's form too, and the board has the thread waiting
    // to continue, not in Needs you.
    const onCard = ["asks", "waits", "carried"];
    const simple = simpleNeedsYou(read, NOW);
    expect(simple.conversations.map((c) => c.ref).toSorted()).toEqual([
      "decided",
      "elsewhere",
      "failed",
      "planasks",
      "planned",
      "stopped",
    ]);
    expect(simple.approvals.filter((a) => a.status === "pending")).toHaveLength(7);
    const board = boardAskingOnce(boardFor(read.conversations, NOW), read);
    expect(board.needsYou.filter((c) => onCard.includes(c.ref))).toEqual([]);
    expect(board.waiting.map((c) => c.ref).toSorted()).toEqual(onCard.toSorted());
    expect(board.needsYou.length + 3).toBe(boardFor(read.conversations, NOW).needsYou.length);
  });

  it("lists a thread in simple mode by what it asks itself: a pause or a computer request", () => {
    const read = home({
      approvals: [approval("ap-p", { kind: "confirm", thread: at("p") })],
      conversations: [
        conversation({ ref: "p", thread: at("p"), state: "paused", machine: "asleep" }),
        conversation({
          ref: "c",
          thread: at("c"),
          state: "waiting",
          computers: [
            { computer: "windows", status: "asked", askedAt: ago(5), creditsPerHour: 38.4 },
          ],
        }),
      ],
    });
    expect(
      simpleNeedsYou(read, NOW)
        .conversations.map((c) => c.ref)
        .toSorted(),
    ).toEqual(["c", "p"]);
  });

  it("lists a step on an approval card once in the summon menu", () => {
    const read = home({
      approvals: [approval("ap-asks", { kind: "confirm", thread: at("asks") })],
      conversations: [
        {
          ...question,
          ref: "asks",
          thread: at("asks"),
          pending: { ...question.pending!, requestId: "ask:turn-asks" },
        },
        { ...question, ref: "stopped", thread: at("stopped") },
      ],
    });
    const needs = summonSections({ query: "", onScreen: null, home: read, threads: [], now: NOW })
      .find((s) => s.title === "Needs you")
      ?.rows.map((r) => r.key);
    expect(needs).toEqual(["approval:ap-asks", "needs:stopped"]);
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
  // Aldo's conversation lists it under its name, to show again, and no count has it.
  expect(aldoWaitingCount(read, NOW)).toBe(0);
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

describe("decisionAt", () => {
  it("keeps a revised draft at its original creation time", () => {
    const [draft] = aldoDecisions(
      home({
        approvals: [
          approval("ap1", {
            createdAt: "2026-10-21T15:00:00.000Z",
            revisedAt: "2026-10-21T15:20:00.000Z",
            previous: { title: "x", body: "y" },
          }),
        ],
      }),
      NOW,
    );
    expect(decisionAt(draft!)).toBe("2026-10-21T15:00:00.000Z");
  });
});

it("places a browser handoff when it was created, rather than its thread's earlier state", () => {
  const read = home({
    conversations: [
      conversation({
        ref: "handoff",
        thread: at("handoff"),
        state: "waiting",
        stateAt: ago(30),
        at: ago(30),
        pending: { kind: "handoff", requestId: "handoff-1", summary: "Sign in" },
      }),
    ],
    handoffs: [
      {
        id: "handoff-1",
        kind: "sign_in",
        reason: "Sign in",
        how: null,
        site: "example.com",
        url: null,
        seconds: null,
        thread: at("handoff"),
        threadTitle: "Sign in",
        createdAt: ago(10),
        expiresAt: ago(-10),
      },
    ],
  });
  const decision = aldoDecisions(read, NOW).find((d) => d.kind === "handoff")!;
  expect(decisionAt(decision, read)).toBe(ago(10));
  expect(decisionAt(decision)).toBe(ago(30));
});

it("takes what the user dismissed out of every list and count, and a different ask back in", () => {
  const cleared = { id: "request-one", dismissed: true, cleared: true };
  const dismissed = { ...question, chatDecision: cleared };
  const read = home({ conversations: [dismissed] });
  expect(aldoDecisions(read, NOW)).toHaveLength(0);
  expect(aldoChatDecisions(read, NOW)).toHaveLength(0);
  expect(aldoWaitingCount(read, NOW)).toBe(0);
  // Not "hidden from chat" either: it is dismissed, listed under Dismissed (needsYou.logic.ts).
  expect(aldoHiddenFromChat(read, NOW)).toEqual([]);
  expect(aldoDecisions(read, NOW, true)).toHaveLength(1);
  // The same thread asks something else: another id, so it counts again.
  const next = { ...question, chatDecision: { id: "request-two", dismissed: false } };
  expect(aldoWaitingCount(home({ conversations: [next] }), NOW)).toBe(1);
});

it("keeps the real merge action for a user-owned release, without masking a live question", () => {
  const c = conversation({
    state: "waiting",
    pending: undefined as never,
    machine: "running",
    progress: {
      execution: "replied",
      verdict: "finished",
      next: { owner: "you", kind: "release" },
      label: "Release held for you",
      detail: "Waiting for your merge decision.",
    },
  });
  expect(
    aldoDecisions(home({ conversations: [c], pullRequests: [pullRequest()] }), NOW).map(
      (d) => d.kind,
    ),
  ).toEqual(["merge"]);
  const asking = { ...c, pending: question.pending! };
  expect(
    aldoDecisions(home({ conversations: [asking], pullRequests: [pullRequest()] }), NOW).map(
      (d) => d.kind,
    ),
  ).toEqual(["question"]);
});

import { describe, expect, it } from "vite-plus/test";

import { type AldoHomeConversation } from "./homeApi";
import {
  boardFor,
  capacityLines,
  planRunning,
  isStuck,
  needsYouKind,
  sameTarget,
} from "./home.logic";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const ahead = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

function conversation(over: Partial<AldoHomeConversation> = {}): AldoHomeConversation {
  return {
    ref: "t1",
    thread: { environmentId: "aldo-t1", threadId: "th1" },
    title: "Fix checkout",
    repos: ["acme/shop"],
    branch: "aldo/t1",
    state: "working",
    machine: "running",
    at: ago(5),
    ...over,
  };
}

describe("needsYouKind", () => {
  it("names what a waiting conversation is waiting on", () => {
    expect(needsYouKind(conversation({ state: "working" }))).toBeNull();
    expect(needsYouKind(conversation({ state: "failed" }))).toBe("failed");
    expect(needsYouKind(conversation({ state: "waiting" }))).toBe("waiting");
    expect(needsYouKind(conversation({ state: "paused" }))).toBe("paused");
    // An older Aldo's read: working, on a machine asleep.
    expect(needsYouKind(conversation({ state: "working", machine: "asleep" }))).toBe("paused");
    expect(
      needsYouKind(
        conversation({
          state: "waiting",
          pending: { kind: "question", requestId: "r", questions: [] },
        }),
      ),
    ).toBe("question");
    expect(
      needsYouKind(
        conversation({
          state: "waiting",
          pending: { kind: "approval", requestId: "r", summary: "Run tests", options: [] },
        }),
      ),
    ).toBe("approval");
    expect(
      needsYouKind(
        conversation({
          state: "waiting",
          pending: { kind: "handoff", requestId: "ho_1", summary: "A quick check on OpenTable" },
        }),
      ),
    ).toBe("handoff");
    expect(needsYouKind(conversation({ state: "waiting", plan: { id: "p", text: "1. do" } }))).toBe(
      "plan",
    );
  });
});

describe("boardFor", () => {
  it("puts a conversation paused mid-turn with what needs the user, not working", () => {
    const board = boardFor(
      [
        conversation({ ref: "p", state: "paused", machine: "asleep", at: ago(300) }),
        conversation({ ref: "o", state: "working", machine: "asleep", at: ago(200) }),
        conversation({ ref: "w", state: "working", machine: "running", at: ago(2) }),
      ],
      NOW,
    );
    expect(board.needsYou.map((c) => c.ref)).toEqual(["p", "o"]);
    expect(board.working.map((c) => c.ref)).toEqual(["w"]);
    expect(isStuck(board.needsYou[1]!, NOW)).toBe(false);
  });
});

describe("isStuck", () => {
  it("counts from the thread's latest activity, not from when its turn began", () => {
    // A long turn (began 90 min ago) that is still producing events is working.
    expect(isStuck(conversation({ at: ago(5), stateAt: ago(90) }), NOW)).toBe(false);
    // One with nothing at all for over an hour is not.
    expect(isStuck(conversation({ at: ago(90), stateAt: ago(120) }), NOW)).toBe(true);
    expect(isStuck(conversation({ at: ago(61), stateAt: ago(61) }), NOW)).toBe(true);
    expect(isStuck(conversation({ at: ago(59), stateAt: ago(61) }), NOW)).toBe(false);
    expect(isStuck(conversation({ at: ago(90) }), NOW)).toBe(true);
    expect(isStuck(conversation({ state: "waiting", at: ago(90) }), NOW)).toBe(false);
  });
});

describe("capacityLines", () => {
  it("warns at the plan's limit and when credits run low", () => {
    const lines = capacityLines(
      {
        configured: true,
        metered: true,
        plan: { id: "starter", name: "Starter", includedCredits: 40 },
        period: { status: "active", start: ago(60), end: ahead(60) },
        credits: { used: 39, included: 40, authorized: 73, remaining: 34, projected: null },
        bill: { estimatedCents: 2000, projectedCents: null, spendLimitCents: 2000 },
        alert: "included_warning",
        agents: { running: 2, limit: 2 },
      },
      { once: 0, monthly: 0, recent: [] },
    );
    expect(lines.map((l) => l.tone)).toEqual(["warn", "warn"]);
    expect(
      capacityLines(
        {
          configured: false,
          metered: false,
          plan: null,
          period: null,
          credits: null,
          bill: null,
          alert: "none",
          agents: { running: 0, limit: null },
        },
        { once: 0, monthly: 0, recent: [] },
      )[1],
    ).toEqual({ text: "No plan yet", tone: "bad" });
  });
});

describe("planRunning", () => {
  const usage = {
    configured: true,
    metered: true,
    plan: null,
    period: { status: "active", start: ago(60), end: ago(-60) },
    credits: null,
    bill: null,
    alert: "none",
    agents: { running: 0, limit: null },
  };

  it("runs on an active or complimentary plan, not without one or past due", () => {
    expect(planRunning(usage)).toBe(true);
    expect(planRunning({ ...usage, metered: false, period: null })).toBe(true);
    expect(planRunning({ ...usage, configured: false, period: null })).toBe(false);
    expect(planRunning({ ...usage, period: { ...usage.period, status: "past_due" } })).toBe(false);
  });
});

describe("sameTarget", () => {
  const at = (id: string) => ({ environmentId: `aldo-${id}`, threadId: id });

  it("matches a thread by its machine and its T3 thread", () => {
    expect(sameTarget(at("a"), at("a"))).toBe(true);
    expect(sameTarget({ environmentId: "aldo-a", threadId: "b" }, at("a"))).toBe(false);
    expect(sameTarget(null, at("a"))).toBe(false);
  });
});

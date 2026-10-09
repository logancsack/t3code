import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AldoHome, AldoHomeConversation, AldoHomePullRequest } from "./cloud";
import {
  actionLabel,
  boardFor,
  capacityLines,
  chipPrompt,
  composerChips,
  dueIn,
  elapsed,
  filterHome,
  healthIssues,
  isNewSince,
  isStuck,
  mergeCountdown,
  modelName,
  moveSelection,
  needsYouKind,
  policyLines,
  relativeTime,
  repoChips,
  repoName,
  sameTarget,
  shipLanes,
  stageLabel,
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

function pullRequest(over: Partial<AldoHomePullRequest> = {}): AldoHomePullRequest {
  return {
    environmentId: "aldo-t1",
    thread: { environmentId: "aldo-t1", threadId: "th1" },
    threadTitle: "Fix checkout",
    repo: "acme/shop",
    number: 12,
    url: "https://github.com/acme/shop/pull/12",
    title: "Fix checkout totals",
    status: "watching",
    stage: "green",
    checks: { passed: 3, failed: 0, running: 0 },
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

describe("needsYouKind", () => {
  it("names what a waiting conversation is waiting on", () => {
    expect(needsYouKind(conversation({ state: "working" }))).toBeNull();
    expect(needsYouKind(conversation({ state: "failed" }))).toBe("failed");
    expect(needsYouKind(conversation({ state: "waiting" }))).toBe("waiting");
    expect(needsYouKind(conversation({ state: "paused" }))).toBe("paused");
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
    expect(needsYouKind(conversation({ state: "waiting", plan: { id: "p", text: "1. do" } }))).toBe(
      "plan",
    );
  });
});

describe("boardFor", () => {
  it("sorts conversations into what needs the user (waited longest first), working, and done", () => {
    const board = boardFor(
      [
        conversation({ ref: "a", state: "waiting", at: ago(10) }),
        conversation({ ref: "b", state: "working", at: ago(2) }),
        conversation({ ref: "c", state: "waiting", at: ago(30) }),
        conversation({ ref: "d", state: "done", at: ago(60) }),
        conversation({ ref: "e", state: "done", at: ago(3 * 24 * 60) }),
        conversation({ ref: "f", state: "new" }),
        conversation({ ref: "g", state: "queued", at: ago(1) }),
      ],
      NOW,
    );
    expect(board.needsYou.map((c) => c.ref)).toEqual(["c", "a"]);
    expect(board.working.map((c) => c.ref)).toEqual(["g", "b"]);
    expect(board.done.map((c) => c.ref)).toEqual(["d"]);
  });
});

describe("isStuck", () => {
  it("calls a turn stuck after an hour without moving", () => {
    expect(isStuck(conversation({ at: ago(59) }), NOW)).toBe(false);
    expect(isStuck(conversation({ at: ago(61) }), NOW)).toBe(true);
    expect(isStuck(conversation({ state: "waiting", at: ago(61) }), NOW)).toBe(false);
  });
});

describe("times", () => {
  it("says how long since", () => {
    expect(elapsed(ago(0.5), NOW)).toBe("just now");
    expect(elapsed(ago(4), NOW)).toBe("4 min");
    expect(elapsed(ago(130), NOW)).toBe("2 h 10 min");
    expect(elapsed(ago(8 * 60), NOW)).toBe("8 h");
    expect(elapsed(ago(3 * 24 * 60), NOW)).toBe("3 d");
  });

  it("says when", () => {
    expect(relativeTime(ago(0.2), NOW)).toBe("just now");
    expect(relativeTime(ago(5), NOW)).toBe("5 min ago");
    expect(relativeTime(ago(3 * 60), NOW)).toBe("3 h ago");
    expect(relativeTime(ago(30 * 60), NOW)).toBe("yesterday");
  });

  it("says when something is due", () => {
    expect(dueIn(ago(1), NOW)).toBe("now");
    expect(dueIn(ahead(0.5), NOW)).toBe("in a moment");
    expect(dueIn(ahead(20), NOW)).toBe("in 20 min");
    expect(dueIn(ahead(125), NOW)).toBe("in 2 h");
  });
});

describe("mergeCountdown", () => {
  it("counts down to the merge Aldo makes on its own", () => {
    expect(mergeCountdown(pullRequest(), NOW)).toBeNull();
    expect(mergeCountdown(pullRequest({ mergesAt: ahead(7) }), NOW)).toBe("Aldo merges in 7 min");
    expect(mergeCountdown(pullRequest({ mergesAt: ago(1) }), NOW)).toBe("Aldo is merging it");
    expect(
      mergeCountdown(pullRequest({ mergesAt: ahead(7), stage: "checks-running" }), NOW),
    ).toBeNull();
  });
});

describe("shipLanes", () => {
  it("puts each pull request in its lane, and drops closed and old ones", () => {
    const lanes = shipLanes(
      [
        pullRequest({ number: 1, stage: "checks-running" }),
        pullRequest({ number: 2, stage: "deploying", status: "merged" }),
        pullRequest({ number: 3, stage: "deployed", status: "merged", updatedAt: ago(60) }),
        pullRequest({
          number: 4,
          stage: "deployed",
          status: "merged",
          updatedAt: ago(5 * 24 * 60),
        }),
        pullRequest({ number: 5, stage: "closed", status: "closed" }),
        pullRequest({ number: 6, stage: "deploy-failed", status: "merged" }),
        pullRequest({ number: 7, stage: "green", status: "stopped" }),
      ],
      NOW,
    );
    expect(lanes.open.map((pr) => pr.number)).toEqual([1]);
    expect(lanes.shipping.map((pr) => pr.number)).toEqual([2, 6]);
    expect(lanes.shipped.map((pr) => pr.number)).toEqual([3]);
  });

  it("labels stages", () => {
    expect(
      stageLabel(
        pullRequest({ stage: "checks-running", checks: { passed: 2, failed: 0, running: 1 } }),
      ),
    ).toBe("Checks 2/3");
    expect(stageLabel(pullRequest({ stage: "checks-running", checks: null }))).toBe(
      "Checks running",
    );
    expect(
      stageLabel(
        pullRequest({ stage: "checks-failing", checks: { passed: 2, failed: 2, running: 0 } }),
      ),
    ).toBe("2 failing");
    expect(stageLabel(pullRequest({ stage: "deploy-failed" }))).toBe("Deploy failed");
  });
});

describe("filters", () => {
  const home = {
    at: ago(0),
    conversations: [
      conversation({
        ref: "a",
        repos: ["acme/shop"],
        thread: { environmentId: "aldo-a", threadId: "1" },
      }),
      conversation({
        ref: "b",
        repos: ["acme/api", "acme/shop"],
        thread: { environmentId: "aldo-b", threadId: "1" },
      }),
      conversation({
        ref: "c",
        repos: ["acme/api"],
        thread: { environmentId: "aldo-c", threadId: "1" },
      }),
    ],
    pullRequests: [
      pullRequest({ environmentId: "aldo-a", repo: "acme/shop" }),
      pullRequest({ environmentId: "aldo-c", repo: "acme/api" }),
    ],
    upcoming: [
      {
        id: "r1",
        kind: "reminder" as const,
        thread: { environmentId: "aldo-c", threadId: "1" },
        threadTitle: "t",
        message: "check CI",
        dueAt: ahead(60),
        createdAt: ago(1),
        held: false,
      },
    ],
    actions: [
      {
        id: "1",
        tool: "start_thread",
        title: "x",
        asked: "go",
        failed: false,
        error: null,
        thread: { environmentId: "aldo-a", threadId: "1" },
        at: ago(1),
      },
      {
        id: "2",
        tool: "merge_pull_request",
        title: null,
        asked: "go",
        failed: false,
        error: null,
        thread: null,
        at: ago(1),
      },
    ],
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
  } satisfies AldoHome;

  it("lists repositories most worked in first", () => {
    expect(repoChips(home)).toEqual(["acme/api", "acme/shop"]);
    expect(repoName("acme/shop", ["acme/shop", "acme/api"])).toBe("shop");
    expect(repoName("acme/shop", ["acme/shop", "other/shop"])).toBe("acme/shop");
  });

  it("narrows every part of the board to one repository", () => {
    const api = filterHome(home, "acme/api");
    expect(api.conversations.map((c) => c.ref)).toEqual(["b", "c"]);
    expect(api.pullRequests.map((pr) => pr.environmentId)).toEqual(["aldo-c"]);
    expect(api.upcoming.map((d) => d.id)).toEqual(["r1"]);
    // An action without a thread stays whatever the filter.
    expect(api.actions.map((a) => a.id)).toEqual(["2"]);
    expect(filterHome(home, null)).toBe(home);
  });
});

describe("words", () => {
  it("shortens a model", () => {
    expect(modelName("claude/claude-opus-4-1")).toBe("claude-opus-4-1");
    expect(modelName("gpt-5")).toBe("gpt-5");
    expect(modelName(undefined)).toBeNull();
  });

  it("labels Aldo's actions", () => {
    expect(
      actionLabel({
        id: "1",
        tool: "start_thread",
        title: "Fix checkout",
        asked: "go",
        failed: false,
        error: null,
        thread: null,
        at: ago(1),
      }),
    ).toBe("Started a thread: Fix checkout");
    expect(
      actionLabel({
        id: "1",
        tool: "merge_pull_request",
        title: null,
        asked: "go",
        failed: false,
        error: null,
        thread: null,
        at: ago(1),
      }),
    ).toBe("Merged a pull request");
    expect(
      actionLabel({
        id: "1",
        tool: "set_policy",
        title: null,
        asked: "go",
        failed: false,
        error: null,
        thread: null,
        at: ago(1),
      }),
    ).toBe("set policy");
    expect(
      actionLabel({
        id: "1",
        tool: "answer_thread",
        title: null,
        asked: "go",
        failed: true,
        error: "busy",
        thread: null,
        at: ago(1),
      }),
    ).toBe("Couldn't answer a thread");
  });

  it("says when an action undid what its tool's name says", () => {
    const action = { id: "1", title: null, asked: "go", error: null, thread: null, at: ago(1) };
    expect(actionLabel({ ...action, tool: "pin_thread", failed: false, reverse: true })).toBe(
      "Unpinned a thread",
    );
    expect(actionLabel({ ...action, tool: "pin_thread", failed: false })).toBe("Pinned a thread");
    expect(
      actionLabel({ ...action, tool: "settle_thread", failed: true, error: "no", reverse: true }),
    ).toBe("Couldn't make a thread active again");
  });

  it("marks news since the last visit", () => {
    expect(isNewSince(ago(1), null)).toBe(false);
    expect(isNewSince(ago(1), ago(5))).toBe(true);
    expect(isNewSince(ago(10), ago(5))).toBe(false);
  });
});

describe("moveSelection", () => {
  it("moves with j and k, and wraps at neither end", () => {
    expect(moveSelection(null, 3, "j")).toBe(0);
    expect(moveSelection(0, 3, "j")).toBe(1);
    expect(moveSelection(2, 3, "j")).toBe(2);
    expect(moveSelection(null, 3, "k")).toBe(2);
    expect(moveSelection(0, 3, "k")).toBe(0);
    expect(moveSelection(1, 3, "x")).toBe(1);
    expect(moveSelection(1, 0, "j")).toBeNull();
  });
});

describe("capacityLines", () => {
  it("says agents, credits and spending in a line each", () => {
    const lines = capacityLines(
      {
        configured: true,
        metered: true,
        plan: { id: "pro", name: "Pro", includedCredits: 150 },
        period: { status: "active", start: ago(60), end: ahead(60) },
        credits: { used: 37.4, included: 150, authorized: 183, remaining: 145.6, projected: 160 },
        bill: { estimatedCents: 6000, projectedCents: 6600, spendLimitCents: 2000 },
        alert: "none",
        agents: { running: 2, limit: 5 },
      },
      { once: 12, monthly: 5.5, recent: [] },
    );
    expect(lines.map((l) => l.text)).toEqual([
      "2 of 5 agents running",
      "37 of 150 credits used, heading for 160",
      "Agents spent $12 this month and $5.50/month",
    ]);
    expect(lines[0]!.tone).toBe("neutral");
  });

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

describe("healthIssues", () => {
  const usage = {
    configured: true,
    metered: false,
    plan: null,
    period: null,
    credits: null,
    bill: null,
    alert: "none",
    agents: { running: 0, limit: null },
  };

  it("is empty when all is well", () => {
    expect(
      healthIssues(
        {
          usage,
          health: {
            providers: [{ id: "claude", name: "Claude", signedIn: true }],
            connected: ["claude"],
            environments: [],
          },
        },
        "on",
      ),
    ).toEqual([]);
  });

  it("names what's wrong", () => {
    const issues = healthIssues(
      {
        usage: { ...usage, alert: "spend_reached" },
        health: {
          providers: [{ id: "codex", name: "Codex", signedIn: false }],
          connected: [],
          environments: [{ repos: ["acme/shop"], status: "failed", at: ago(1) }],
        },
      },
      "off",
    );
    expect(issues.map((i) => i.id)).toEqual([
      "provider-codex",
      "credits",
      "env-acme/shop",
      "notifications",
    ]);
    expect(issues[0]!.href).toBe("/settings/providers");
    expect(issues[3]!.action).toBe("enable-notifications");
  });

  it("says when the browser blocks notifications, with nothing to click", () => {
    const [issue] = healthIssues(
      { usage, health: { providers: [], connected: [], environments: [] } },
      "blocked",
    );
    expect(issue!.id).toBe("notifications");
    expect(issue!.action).toBeUndefined();
    expect(
      healthIssues(
        { usage, health: { providers: [], connected: [], environments: [] } },
        "unavailable",
      ),
    ).toEqual([]);
  });
});

describe("policyLines", () => {
  it("says how Aldo works for the user", () => {
    expect(policyLines({ everywhere: {}, workspaces: [] })).toEqual([
      "Whether Aldo merges green pull requests itself hasn't come up yet: an agent asks the first time.",
    ]);
    expect(
      policyLines({
        everywhere: { merge: "auto", spendThreshold: 20, reviews: "important" },
        workspaces: [],
      }),
    ).toEqual([
      "Aldo merges pull requests once they're green.",
      "Agents may spend up to $20 without asking.",
      "Agents fix what matters from automated reviews and answer the rest.",
    ]);
    expect(
      policyLines({
        everywhere: {},
        workspaces: [{ repos: ["acme/shop"], policy: { merge: "approve", spendThreshold: 0 } }],
      }),
    ).toEqual(["Aldo waits for you to merge in shop.", "Agents ask before spending anything."]);
  });
});

describe("composer chips", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers what fits the board", () => {
    const home = {
      conversations: [
        conversation({ state: "waiting" }),
        conversation({ ref: "b", state: "done", at: ago(10) }),
      ],
    };
    expect(composerChips(home, { conversationEmpty: false, lastSeen: ago(60) })).toEqual([
      "What needs me?",
      "Catch me up",
      "What shipped today?",
      "Start something in shop",
    ]);
    expect(composerChips(null, { conversationEmpty: true, lastSeen: null })).toEqual([
      "What can you do?",
    ]);
  });

  it("turns a chip into words", () => {
    expect(chipPrompt("What needs me?", null, NOW)).toBe("What needs me?");
    expect(chipPrompt("Catch me up", ago(3 * 60), NOW)).toBe(
      "Catch me up on what happened since 3 h ago: what finished, what shipped, and what needs me.",
    );
    expect(chipPrompt("Start something in shop", null, NOW)).toBe("Start something in shop: ");
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

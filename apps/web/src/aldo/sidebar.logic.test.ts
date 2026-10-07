import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import type { AldoHome, AldoHomeConversation, AldoHomePullRequest } from "./cloud";
import { aldoSidebarList, aldoSidebarOrder, repoLabel, searchAldoSidebar } from "./sidebar.logic";

const NOW = "2026-10-07T12:00:00.000Z";
const ago = (minutes: number) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

function shell(id: string, over: Record<string, unknown> = {}): EnvironmentThreadShell {
  return {
    id,
    environmentId: `aldo-${id}`,
    projectId: "p1",
    title: `Thread ${id}`,
    modelSelection: { instanceId: "codex", model: "gpt" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: ago(600),
    updatedAt: ago(30),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...over,
  } as unknown as EnvironmentThreadShell;
}

function conversation(id: string, over: Partial<AldoHomeConversation> = {}): AldoHomeConversation {
  return {
    ref: id,
    thread: { environmentId: `aldo-${id}`, threadId: id },
    title: `Thread ${id}`,
    repos: ["acme/shop"],
    branch: `aldo/${id}`,
    state: "done",
    machine: "asleep",
    at: ago(30),
    ...over,
  };
}

function pullRequest(id: string, over: Partial<AldoHomePullRequest> = {}): AldoHomePullRequest {
  return {
    environmentId: `aldo-${id}`,
    thread: { environmentId: `aldo-${id}`, threadId: id },
    threadTitle: `Thread ${id}`,
    repo: "acme/shop",
    number: 7,
    url: "https://github.com/acme/shop/pull/7",
    title: "Upgrade",
    status: "watching",
    stage: "green",
    checks: null,
    deploy: null,
    followups: 0,
    reviewsExhausted: false,
    greenSince: null,
    mergesAt: null,
    mergedAt: null,
    updatedAt: ago(10),
    ...over,
  };
}

function home(over: Partial<AldoHome> = {}): AldoHome {
  return {
    at: NOW,
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

const list = (shells: EnvironmentThreadShell[], read: AldoHome | null = home(), visited = {}) =>
  aldoSidebarList({
    shells,
    home: read,
    lastVisitedAt: (key) => (visited as Record<string, string>)[key],
    repoOf: () => "shop",
    now: NOW,
  });

const keys = (rows: ReadonlyArray<{ key: string }>) => rows.map((row) => row.key);

describe("aldoSidebarList", () => {
  it("groups threads by what they need from the user", () => {
    const result = list(
      [
        shell("q", { hasPendingUserInput: true }),
        shell("a", { hasPendingApprovals: true }),
        shell("w", { session: { status: "running", activeTurnId: "t1" } }),
        shell("m"),
        shell("l"),
        shell("u", { latestTurn: { completedAt: ago(5) } }),
        shell("d", { latestTurn: { completedAt: ago(50) } }),
      ],
      home({
        pullRequests: [
          pullRequest("m"),
          pullRequest("l", { status: "merged", stage: "deploying", number: 8 }),
        ],
      }),
      { "aldo-d:d": ago(10) },
    );
    expect(result.waiting.map((row) => [row.key, row.kind])).toEqual([
      ["aldo-q:q", "question"],
      ["aldo-a:a", "approval"],
      ["aldo-m:m", "merge"],
    ]);
    expect(keys(result.working)).toEqual(["aldo-w:w"]);
    expect(result.landing.map((row) => row.detail)).toEqual(["#8 merged · deploying"]);
    expect(keys(result.unread)).toEqual(["aldo-u:u"]);
    expect(keys(result.earlier)).toEqual(["aldo-d:d"]);
  });

  it("says what each asks or does, from Aldo's read when the shell can't", () => {
    const result = list(
      [
        shell("q"),
        shell("w", {
          session: { status: "running", activeTurnId: "t" },
          planProgress: { step: "Running the e2e suite", completedSteps: 3, totalSteps: 4 },
        }),
      ],
      home({
        conversations: [
          conversation("q", {
            state: "waiting",
            pending: {
              kind: "question",
              requestId: "r",
              questions: [
                { id: "t", header: "T", question: "80% or 90%?", options: [], multiSelect: false },
              ],
            },
          }),
        ],
      }),
    );
    expect(result.waiting[0]).toMatchObject({ kind: "question", detail: "80% or 90%?" });
    expect(result.working[0]).toMatchObject({ detail: "Running the e2e suite", progress: 0.75 });
  });

  it("keeps pinned threads in their own group, and snoozed ones out of sight", () => {
    const result = list([
      shell("p", { pinnedAt: ago(100), hasPendingUserInput: true }),
      shell("s", { snoozedUntil: ago(-60) }),
      shell("x", { archivedAt: ago(1) }),
    ]);
    expect(keys(result.pinned)).toEqual(["aldo-p:p"]);
    expect(result.waiting).toEqual([]);
    expect(keys(result.snoozed)).toEqual(["aldo-s:s"]);
  });

  it("counts a thread never opened here as unread for a day after it finished", () => {
    const result = list([
      shell("fresh", { latestTurn: { completedAt: ago(60) } }),
      shell("stale", { latestTurn: { completedAt: ago(26 * 60) } }),
    ]);
    expect(keys(result.unread)).toEqual(["aldo-fresh:fresh"]);
    expect(keys(result.earlier)).toEqual(["aldo-stale:stale"]);
  });

  it("puts settled threads with the earlier ones, even when unread", () => {
    const result = list([
      shell("s", { settledOverride: "settled", latestTurn: { completedAt: ago(2) } }),
    ]);
    expect(result.unread).toEqual([]);
    expect(keys(result.earlier)).toEqual(["aldo-s:s"]);
  });

  it("never has a settled thread waiting on the user, pinned or not", () => {
    const result = list(
      [
        shell("q", { settledOverride: "settled" }),
        shell("m", { settledOverride: "settled" }),
        shell("p", { settledOverride: "settled", pinnedAt: ago(100), hasPendingUserInput: true }),
      ],
      home({
        conversations: [conversation("q", { state: "waiting" })],
        pullRequests: [pullRequest("m")],
      }),
      { "aldo-q:q": ago(1), "aldo-m:m": ago(1), "aldo-p:p": ago(1) },
    );
    expect(result.waiting).toEqual([]);
    expect(result.pinned).toEqual([]);
    expect(result.earlier.map((row) => [row.key, row.kind]).toSorted()).toEqual([
      ["aldo-m:m", "done"],
      ["aldo-p:p", "done"],
      ["aldo-q:q", "done"],
    ]);
  });

  it("lists waiting threads longest-waiting first, and the rest newest first", () => {
    const result = list([
      shell("new", { hasPendingUserInput: true, updatedAt: ago(1) }),
      shell("old", { hasPendingUserInput: true, updatedAt: ago(90) }),
      shell("w1", { session: { status: "running", activeTurnId: "t" }, updatedAt: ago(50) }),
      shell("w2", { session: { status: "running", activeTurnId: "t" }, updatedAt: ago(5) }),
    ]);
    expect(keys(result.waiting)).toEqual(["aldo-old:old", "aldo-new:new"]);
    expect(keys(result.working)).toEqual(["aldo-w2:w2", "aldo-w1:w1"]);
  });

  it("has the approvals and what's scheduled, which aren't threads", () => {
    const result = list(
      [],
      home({
        approvals: [
          {
            id: "ap",
            kind: "email",
            provider: "google",
            title: "Reply",
            summary: "To maya",
            fields: [],
            body: "",
            approveLabel: "Send",
            discardLabel: "Discard",
            status: "pending",
            result: null,
            failed: false,
            thread: null,
            threadTitle: null,
            createdAt: ago(20),
            decidedAt: null,
          },
        ],
        upcoming: [
          {
            id: "r1",
            kind: "reminder",
            thread: { environmentId: "aldo-x", threadId: "x" },
            threadTitle: "X",
            message: "check CI",
            dueAt: ago(-30),
            createdAt: ago(5),
            held: false,
          },
        ],
      }),
    );
    expect(result.approvals.map((a) => a.id)).toEqual(["ap"]);
    expect(result.scheduled.map((item) => item.key)).toEqual(["delivery:r1"]);
  });

  it("works without Aldo's read, from the shells alone", () => {
    const result = list([shell("q", { hasPendingUserInput: true })], null);
    expect(result.waiting[0]).toMatchObject({ kind: "question", detail: "Asks you" });
    expect(result.approvals).toEqual([]);
  });
});

describe("the sidebar's order and search", () => {
  const result = list(
    [
      shell("q", { hasPendingUserInput: true, title: "Usage alerts" }),
      shell("w", { session: { status: "running", activeTurnId: "t" }, title: "Checkout fix" }),
      shell("d1", { latestTurn: { completedAt: ago(50) }, updatedAt: ago(60) }),
      shell("d2", { latestTurn: { completedAt: ago(50) }, updatedAt: ago(70) }),
    ],
    home(),
    { "aldo-d1:d1": ago(1), "aldo-d2:d2": ago(1) },
  );

  it("moves through the rows as they show, folded groups only when open", () => {
    expect(aldoSidebarOrder(result, { earlier: 0, snoozed: false })).toEqual([
      "aldo-q:q",
      "aldo-w:w",
    ]);
    expect(aldoSidebarOrder(result, { earlier: 1, snoozed: false })).toEqual([
      "aldo-q:q",
      "aldo-w:w",
      "aldo-d1:d1",
    ]);
  });

  it("finds threads by title", () => {
    expect(keys(searchAldoSidebar(result, "checkout"))).toEqual(["aldo-w:w"]);
    expect(searchAldoSidebar(result, "  ")).toEqual([]);
  });

  it("names projects in a word", () => {
    expect(repoLabel("logancsack/aldo")).toBe("aldo");
    expect(repoLabel("aldo:general")).toBe("General");
    expect(repoLabel(null)).toBe("General");
  });
});

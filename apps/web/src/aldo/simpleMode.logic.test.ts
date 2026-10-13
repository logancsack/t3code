import { describe, expect, it } from "vite-plus/test";

import type { AldoApproval, AldoHome, AldoHomeConversation, AldoHomePullRequest } from "./cloud";
import { aldoWaitingCount } from "./decisions.logic";
import {
  currentSimplePlace,
  homeShowsConversation,
  simpleModeFrom,
  simpleNeedsYou,
  simpleRailShows,
} from "./simpleMode.logic";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const at = (id: string) => ({ environmentId: `aldo-${id}`, threadId: id });

function conversation(id: string, over: Partial<AldoHomeConversation> = {}): AldoHomeConversation {
  return {
    ref: id,
    thread: at(id),
    title: `Thread ${id}`,
    repos: [],
    branch: "",
    state: "waiting",
    machine: "running",
    at: ago(5),
    ...over,
  };
}

function pullRequest(over: Partial<AldoHomePullRequest> = {}): AldoHomePullRequest {
  return {
    environmentId: "aldo-pr",
    thread: at("pr"),
    threadTitle: "Fix checkout",
    repo: "acme/shop",
    number: 12,
    url: "https://github.com/acme/shop/pull/12",
    title: "Fix checkout totals",
    status: "watching",
    stage: "green",
    checks: { passed: 5, failed: 0, running: 0 },
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

function approval(id: string): AldoApproval {
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

describe("simple mode's setting", () => {
  it("is on only when this device kept it on", () => {
    expect(simpleModeFrom("on")).toBe(true);
    expect(simpleModeFrom(null)).toBe(false);
    expect(simpleModeFrom("off")).toBe(false);
    expect(simpleModeFrom("true")).toBe(false);
  });

  it("puts the rail in place of the sidebar in Aldo, except in settings", () => {
    expect(simpleRailShows({ cloud: true, on: true, settings: false })).toBe(true);
    expect(simpleRailShows({ cloud: true, on: true, settings: true })).toBe(false);
    expect(simpleRailShows({ cloud: true, on: false, settings: false })).toBe(false);
    // Stock T3 never shows it, whatever a browser kept.
    expect(simpleRailShows({ cloud: false, on: true, settings: false })).toBe(false);
  });
});

describe("where the page is", () => {
  it("is a place on the home screen, and none on a thread or another page", () => {
    expect(currentSimplePlace("/", "needs")).toBe("needs");
    expect(currentSimplePlace("/aldo-abc/t1", "needs")).toBeNull();
    expect(currentSimplePlace("/usage", "aldo")).toBeNull();
  });

  it("shows Aldo's conversation by simple mode's place when it's on, else by the view", () => {
    expect(homeShowsConversation({ simple: true, place: "aldo", view: "board" })).toBe(true);
    expect(homeShowsConversation({ simple: true, place: "library", view: "aldo" })).toBe(false);
    expect(homeShowsConversation({ simple: false, place: "library", view: "aldo" })).toBe(true);
    expect(homeShowsConversation({ simple: false, place: "aldo", view: "board" })).toBe(false);
  });
});

describe("simpleNeedsYou", () => {
  it("lists what waits on the user longest first, and leaves out what they put away", () => {
    const read = home({
      conversations: [
        conversation("q", {
          at: ago(10),
          pending: {
            kind: "question",
            requestId: "r1",
            questions: [
              {
                id: "when",
                header: "When",
                question: "Friday or Saturday?",
                options: [
                  { label: "Friday", description: "" },
                  { label: "Saturday", description: "" },
                ],
                multiSelect: false,
              },
            ],
          },
        }),
        conversation("f", { state: "failed", at: ago(30) }),
        conversation("p", { state: "paused", at: ago(2) }),
        conversation("w", { state: "working" }),
        conversation("s", { state: "failed", snoozedUntil: ago(-60) }),
        conversation("d", { state: "failed", settled: true }),
      ],
    });
    expect(simpleNeedsYou(read, NOW).conversations.map((c) => c.ref)).toEqual(["f", "q", "p"]);
  });

  it("adds pull requests ready to merge that no listed thread asks about", () => {
    const read = home({
      conversations: [conversation("t")],
      pullRequests: [
        pullRequest(),
        pullRequest({ thread: at("t"), number: 13 }),
        pullRequest({ number: 14, mergesAt: ago(-5) }),
      ],
    });
    expect(simpleNeedsYou(read, NOW).merges.map((d) => d.pullRequest.number)).toEqual([12]);
  });

  it("lists as many as the rail counts, with Aldo's approvals", () => {
    const read = home({
      approvals: [approval("a1"), approval("a2")],
      conversations: [
        conversation("w"),
        conversation("p", { state: "paused" }),
        conversation("s", { state: "failed", snoozedUntil: ago(-60) }),
      ],
      pullRequests: [pullRequest()],
    });
    const { conversations, merges } = simpleNeedsYou(read, NOW);
    expect(2 + conversations.length + merges.length).toBe(aldoWaitingCount(read, NOW));
  });
});

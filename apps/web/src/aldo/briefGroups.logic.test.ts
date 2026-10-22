import { describe, expect, it } from "vite-plus/test";

import type { AldoBriefGroupItem } from "./assistantApi";
import { briefItemNote, briefItemState, briefRaised, liveDecisionKeys } from "./briefGroups.logic";
import type { AldoHome, AldoHomeConversation } from "./homeApi";

const NOW = Date.parse("2026-10-21T14:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const ahead = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
const at = (id: string) => ({ environmentId: `aldo-${id}`, threadId: id });

function conversation(over: Partial<AldoHomeConversation> = {}): AldoHomeConversation {
  return {
    ref: "q",
    thread: at("q"),
    title: "Offer for Jordan",
    repos: [],
    branch: "aldo/q",
    state: "working",
    machine: "running",
    at: ago(5),
    ...over,
  };
}

const asking = conversation({
  state: "waiting",
  at: ago(30),
  pending: {
    kind: "question",
    requestId: "r1",
    questions: [
      {
        id: "band",
        header: "Band",
        question: "Which salary band?",
        options: [{ label: "L5", description: "" }],
        multiSelect: false,
      },
    ],
  },
});

function home(conversations: ReadonlyArray<AldoHomeConversation>): AldoHome {
  return {
    at: ago(0),
    conversations,
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
  };
}

const needs: AldoBriefGroupItem = {
  key: "question:q:r1",
  thread: at("q"),
  workstream: "Offer for Jordan",
  text: "Which salary band?",
};

describe("briefItemState", () => {
  it("is as it was written until the home screen's read is in", () => {
    expect(briefItemState(needs, "needs", null, null, NOW)).toBe("needs");
  });

  it("needs the user while its decision still waits", () => {
    const h = home([asking]);
    expect(briefItemState(needs, "needs", h, liveDecisionKeys(h, NOW), NOW)).toBe("needs");
  });

  it("follows its thread once decided, or shows done", () => {
    const answered = home([conversation({ state: "working", at: ago(1) })]);
    expect(briefItemState(needs, "needs", answered, liveDecisionKeys(answered, NOW), NOW)).toBe(
      "working",
    );
    const gone = home([]);
    expect(briefItemState(needs, "needs", gone, liveDecisionKeys(gone, NOW), NOW)).toBe("done");
  });

  it("reads what Aldo's watching from its thread now", () => {
    const watching: AldoBriefGroupItem = { thread: at("q"), workstream: "Offer", text: "Drafting" };
    const finished = home([conversation({ state: "done", at: ago(2) })]);
    expect(
      briefItemState(watching, "working", finished, liveDecisionKeys(finished, NOW), NOW),
    ).toBe("done");
    const elsewhere = home([]);
    expect(
      briefItemState(watching, "working", elsewhere, liveDecisionKeys(elsewhere, NOW), NOW),
    ).toBe("working");
  });
});

describe("briefItemNote", () => {
  it("says when what can wait is back, and what's moved on", () => {
    const later: AldoBriefGroupItem = {
      thread: at("q"),
      workstream: "Taxes",
      text: "Q3 sales tax",
      until: ahead(120),
    };
    expect(briefItemNote(later, "later", "later", NOW)).toBe("back in 2 h");
    expect(briefItemNote(needs, "needs", "needs", NOW)).toBeNull();
    expect(briefItemNote(needs, "needs", "done", NOW)).toBe("done");
    expect(briefItemNote(needs, "needs", "working", NOW)).toBe("working on it");
  });
});

describe("briefRaised", () => {
  it("is what the brief put to the user: its top and what it said needs them", () => {
    const raised = briefRaised({
      day: "2026-10-21",
      at: "2026-10-21T14:00:00.000Z",
      title: "Brief",
      text: "",
      top: [{ key: "a", why: null, suggestion: null, reason: null }],
      ahead: [],
      groups: {
        needs: [
          { key: "b", thread: null, workstream: "Site", text: "Merge it" },
          { thread: null, workstream: "Site", text: "No key" },
        ],
        watching: [{ key: "c", thread: null, workstream: "Site", text: "Tests" }],
        later: [],
        fyi: [],
      },
    });
    expect(raised.at).toBe("2026-10-21T14:00:00.000Z");
    expect([...raised.keys].sort()).toEqual(["a", "b"]);
  });
});

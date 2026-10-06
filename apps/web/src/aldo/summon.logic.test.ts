import { describe, expect, it } from "vite-plus/test";

import type { AldoApproval, AldoHome, AldoHomeConversation, AldoHomePullRequest } from "./cloud";
import {
  isSummonShortcut,
  moveSummonSelection,
  promptWith,
  summonRows,
  summonSections,
  type SummonThread,
} from "./summon.logic";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const at = (id: string) => ({ environmentId: `aldo-${id}`, threadId: id });

function conversation(id: string, over: Partial<AldoHomeConversation> = {}): AldoHomeConversation {
  return {
    ref: id,
    thread: at(id),
    title: `Thread ${id}`,
    repos: ["acme/shop"],
    branch: `aldo/${id}`,
    state: "working",
    machine: "running",
    at: ago(5),
    ...over,
  };
}

function pullRequest(id: string, over: Partial<AldoHomePullRequest> = {}): AldoHomePullRequest {
  return {
    environmentId: `aldo-${id}`,
    thread: at(id),
    threadTitle: `Thread ${id}`,
    repo: "acme/shop",
    number: 134,
    url: "https://github.com/acme/shop/pull/134",
    title: "Fix checkout totals",
    status: "watching",
    stage: "green",
    checks: { passed: 6, failed: 0, running: 0 },
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

const approval: AldoApproval = {
  id: "ap",
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

const thread = (id: string, title: string, over: Partial<SummonThread> = {}): SummonThread => ({
  ...at(id),
  title,
  updatedAt: ago(10),
  archived: false,
  ...over,
});

const onScreen = { ...at("c"), title: "Fix flaky checkout test" };

describe("summonSections", () => {
  it("with words typed: asks Aldo, writes them to the agent on screen, or jumps to a thread", () => {
    const sections = summonSections({
      query: "  checkout ",
      onScreen,
      home: null,
      threads: [
        thread("c", "Fix flaky checkout test"),
        thread("x", "Checkout copy tweaks", { updatedAt: ago(1) }),
        thread("y", "Old checkout idea", { archived: true }),
        thread("z", "Usage alerts"),
      ],
      now: NOW,
    });
    expect(summonRows(sections).map((row) => row.key)).toEqual(["ask", "agent", "thread:aldo-x:x"]);
    expect(sections[0]!.rows[0]).toMatchObject({ kind: "ask", text: "checkout" });
    expect(sections[0]!.rows[1]).toMatchObject({ kind: "agent", title: "Fix flaky checkout test" });
  });

  it("off a thread, words typed only ask Aldo or jump", () => {
    const rows = summonRows(
      summonSections({ query: "hi", onScreen: null, home: null, threads: [], now: NOW }),
    );
    expect(rows.map((row) => row.kind)).toEqual(["ask"]);
  });

  it("with nothing typed: things to say about the thread on screen, with Merge once it's green", () => {
    const sections = summonSections({
      query: "",
      onScreen,
      home: home({
        conversations: [conversation("c")],
        pullRequests: [pullRequest("c"), pullRequest("other", { number: 9 })],
      }),
      threads: [],
      now: NOW,
    });
    expect(sections[0]!.title).toBe("For this thread");
    expect(sections[0]!.rows.map((row) => row.key)).toEqual([
      "say:progress",
      "merge:acme/shop#134",
      "say:review",
      "say:opinion",
    ]);
    expect(sections[0]!.rows[0]).toMatchObject({
      text: 'Where is "Fix flaky checkout test" up to?',
    });
  });

  it("lists what needs the user elsewhere (approvals first) and what's working, not the thread on screen", () => {
    const sections = summonSections({
      query: "",
      onScreen,
      home: home({
        conversations: [
          conversation("c", { state: "waiting" }),
          conversation("q", { state: "waiting" }),
          conversation("w", { state: "working" }),
        ],
        approvals: [approval],
      }),
      threads: [],
      now: NOW,
    });
    expect(sections.map((section) => section.title)).toEqual([
      "For this thread",
      "Needs you elsewhere",
      "Working",
    ]);
    expect(sections[1]!.rows.map((row) => row.key)).toEqual(["approval:ap", "needs:q"]);
    expect(sections[2]!.rows.map((row) => row.key)).toEqual(["working:w"]);
  });

  it("off a thread, with nothing on, offers nothing", () => {
    expect(
      summonSections({ query: "", onScreen: null, home: home(), threads: [], now: NOW }),
    ).toEqual([]);
  });
});

describe("summon keys", () => {
  it("opens on Mod+I", () => {
    const key = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: "i" };
    expect(isSummonShortcut({ ...key, metaKey: true })).toBe(true);
    expect(isSummonShortcut({ ...key, ctrlKey: true, key: "I" })).toBe(true);
    expect(isSummonShortcut(key)).toBe(false);
    expect(isSummonShortcut({ ...key, metaKey: true, shiftKey: true })).toBe(false);
  });

  it("moves the selection with the arrows, around the ends", () => {
    expect(moveSummonSelection(0, 3, "ArrowDown")).toBe(1);
    expect(moveSummonSelection(2, 3, "ArrowDown")).toBe(0);
    expect(moveSummonSelection(0, 3, "ArrowUp")).toBe(2);
    expect(moveSummonSelection(0, 3, "Enter")).toBeNull();
    expect(moveSummonSelection(0, 0, "ArrowDown")).toBeNull();
  });

  it("writes to the agent after its draft, keeping it", () => {
    expect(promptWith("", "add a test")).toBe("add a test");
    expect(promptWith("first this  \n", "add a test")).toBe("first this\n\nadd a test");
  });
});

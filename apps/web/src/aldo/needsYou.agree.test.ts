// Every number on Home comes from needsYouNow (needsYou.logic.ts). This reads one
// home with every kind of thing that can wait (a question, a plan, an approval,
// a stopped thread, ...) in every state the user can leave it in (shown, hidden
// from the conversation, put off, dismissed, answered), and asks each place
// that says a number: they must all say the same one, with the same items.
import { describe, expect, it } from "vite-plus/test";

import { aldoChatDecisions } from "./decisions.logic";
import type {
  AldoApproval,
  AldoChatDecision,
  AldoHome,
  AldoHomeConversation,
  AldoHomePending,
} from "./homeApi";
import { aldoWaitingCount, hiddenNeedsYou, needsYouNow } from "./needsYou.logic";
import { presenceBoard, presenceLine } from "./presence.logic";
import { simpleNeedsYou } from "./simpleMode.logic";

const NOW = Date.parse("2026-11-26T05:25:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const ahead = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const hidden = (id: string): AldoChatDecision => ({ id, dismissed: true, until: null });
const putOff = (id: string): AldoChatDecision => ({ id, dismissed: true, until: ahead(120) });
const dismissed = (id: string): AldoChatDecision => ({ id, dismissed: true, cleared: true });

const question: AldoHomePending = {
  kind: "question",
  requestId: "q",
  questions: [{ id: "a", header: "H", question: "Which?", options: [], multiSelect: false }],
};
const permission: AldoHomePending = {
  kind: "approval",
  requestId: "ap",
  summary: "Allow?",
  options: [],
};

let n = 0;
const thread = (over: Partial<AldoHomeConversation> = {}): AldoHomeConversation => {
  n += 1;
  return {
    ref: `t${n}`,
    thread: { environmentId: `aldo-t${n}`, threadId: `t${n}` },
    title: `Thread ${n}`,
    repos: [],
    branch: "",
    state: "waiting",
    machine: "asleep",
    at: ago(30),
    ...over,
  };
};
const approval = (id: string, over: Partial<AldoApproval> = {}): AldoApproval =>
  ({
    id,
    kind: "email",
    title: `Approval ${id}`,
    status: "pending",
    createdAt: ago(40),
    thread: null,
    ...over,
  }) as AldoApproval;
const plan = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  goal: `Plan ${id}`,
  cost: "Free",
  steps: [],
  minutes: 30,
  status: "proposed",
  proposedAt: ago(50),
  deferredUntil: null,
  ...over,
});
const home = (over: Record<string, unknown> = {}) =>
  ({
    conversations: [],
    pullRequests: [],
    upcoming: [],
    approvals: [],
    actions: [],
    ...over,
  }) as unknown as AldoHome;

/** Every place on Home that says how many need the user, read from the same home. */
function everyCount(read: AldoHome, answered: ReadonlyArray<string> = []) {
  const board = presenceBoard(read, { now: NOW, seenAt: null, answered });
  const items = needsYouNow(read, NOW, answered);
  return {
    items,
    // The status line's number, its Needs you list, the pill above the composer and its list,
    // the way through them all, and the Threads tab, tab title, favicon dot and app badge.
    statusLine: presenceLine({
      phase: "idle",
      replying: false,
      working: [],
      stuck: 0,
      waiting: board.needsYou.rows.length,
      moved: 0,
      fresh: true,
    }).text,
    list: board.needsYou.rows.map((r) => r.key),
    pill: items.length,
    walkthrough: items.length,
    badge: aldoWaitingCount(read, NOW, answered),
  };
}

describe("every count on Home agrees", () => {
  it("counts a question, a plan, an approval and a stopped thread that are shown", () => {
    const read = home({
      conversations: [
        thread({ pending: question }),
        thread({ plan: { id: "p", text: "Plan" } as never }),
        thread({ state: "failed" }),
        thread({ pending: permission }),
      ],
      approvals: [approval("email")],
      plans: [plan("goal")],
    });
    const c = everyCount(read);
    expect(c.items).toHaveLength(6);
    expect(c.badge).toBe(6);
    expect(c.pill).toBe(6);
    expect(c.list).toEqual(c.items.map((i) => i.key));
    expect(c.statusLine).toBe("6 things need you");
  });

  it("leaves what the user hid from the conversation out of every count, and lists it", () => {
    const read = home({
      conversations: [
        thread({ pending: question }),
        thread({ state: "failed", chatDecision: hidden("failed") }),
        thread({ pending: question, chatDecision: hidden("q") }),
        thread({ plan: { id: "p", text: "Plan" } as never, chatDecision: hidden("plan") }),
        thread({ state: "working", machine: "asleep", chatDecision: hidden("paused") }),
        thread({
          computers: [{ computer: "windows", status: "asked", askedAt: ago(5) }] as never,
          chatDecision: hidden("computer"),
        }),
      ],
      approvals: [approval("hid", { chatDecision: hidden("approval") } as never)],
    });
    const c = everyCount(read);
    expect(c.items).toHaveLength(1);
    expect(c.badge).toBe(1);
    expect(c.list).toHaveLength(1);
    expect(c.statusLine).toBe("1 thing needs you");
    // What was set aside still waits: it's listed to show again, and it's never a count.
    expect(
      hiddenNeedsYou(read, NOW)
        .map((i) => i.hidden.id)
        .sort(),
    ).toEqual(["approval", "computer", "failed", "paused", "plan", "q"].sort());
    expect(presenceBoard(read, { now: NOW, seenAt: null }).hidden).toBe(6);
    // The chat's own cards are the same list as the count.
    expect(aldoChatDecisions(read, NOW).length).toBe(1);
  });

  it("keeps a plan in the count while the conversation still shows it", () => {
    const read = home({ plans: [plan("goal", { chatDecision: { id: "g", dismissed: true } })] });
    expect(everyCount(read).items).toHaveLength(1);
    expect(everyCount(read).badge).toBe(1);
  });

  it("leaves put-off, dismissed, settled and snoozed out of every count", () => {
    const read = home({
      conversations: [
        thread({ pending: question }),
        thread({ pending: question, chatDecision: putOff("a") }),
        thread({ state: "failed", chatDecision: putOff("b") }),
        thread({ state: "failed", chatDecision: dismissed("c") }),
        thread({ pending: question, settled: true }),
        // Snoozing puts away a thread that only waits for a turn; a real question stays.
        thread({ snoozedUntil: ahead(600) }),
      ],
      approvals: [approval("later", { chatDecision: putOff("d") } as never)],
      plans: [plan("later", { deferredUntil: ahead(300) })],
    });
    const c = everyCount(read);
    expect(c.items).toHaveLength(1);
    expect(c.badge).toBe(1);
    expect(c.list).toHaveLength(1);
    expect(c.statusLine).toBe("1 thing needs you");
  });

  it("brings a put-off item back into every count when its time comes", () => {
    const back = { id: "a", dismissed: false, until: ago(1), back: true as const };
    const c = everyCount(
      home({ conversations: [thread({ pending: question, chatDecision: back })] }),
    );
    expect(c.items).toHaveLength(1);
    expect(c.badge).toBe(1);
  });

  it("leaves what was just answered here out of every count before the read catches up", () => {
    const read = home({
      conversations: [thread({ pending: question })],
      approvals: [approval("email"), approval("done", { status: "approved" })],
    });
    const before = everyCount(read);
    expect(before.items.map((i) => i.key)).toContain("aldo:email");
    const after = everyCount(read, ["aldo:email"]);
    expect(after.items).toHaveLength(1);
    expect(after.badge).toBe(1);
    expect(after.list).toHaveLength(1);
    // Decided approvals kept for the conversation's history never wait.
    expect(before.items.map((i) => i.key)).not.toContain("aldo:done");
  });

  it("counts a paused thread and a computer request once", () => {
    const read = home({
      conversations: [
        thread({ state: "working", machine: "asleep" }),
        thread({
          computers: [{ computer: "windows", status: "asked", askedAt: ago(5) }] as never,
        }),
      ],
    });
    const c = everyCount(read);
    expect(c.items.map((i) => i.kind).sort()).toEqual(["Computer request", "Paused thread"]);
    expect(c.badge).toBe(2);
  });

  it("is what 'two waiting, a few set aside' looked like at 10:25 PM: one number, one list", () => {
    // Two threads waiting on the user, plus prompts the user hid, put off or dismissed.
    const read = home({
      conversations: [
        thread({ title: "OpenCode provider support", plan: { id: "p", text: "Plan" } as never }),
        thread({ title: "Learn from Grok", pending: question }),
        thread({ title: "1,000-secret limit", state: "failed", chatDecision: hidden("limit") }),
        thread({ title: "Clipvinci", state: "failed", chatDecision: dismissed("clip") }),
        thread({
          title: "Check MiniMax exposure",
          pending: permission,
          chatDecision: putOff("mm"),
        }),
      ],
      plans: [
        plan("reimagine", {
          goal: "Reimagine Aldo's included compute",
          chatDecision: dismissed("re"),
        }),
      ],
    });
    const c = everyCount(read);
    expect(c.items.map((i) => i.title)).toEqual(["OpenCode provider support", "Learn from Grok"]);
    expect([c.pill, c.badge, c.list.length, c.walkthrough]).toEqual([2, 2, 2, 2]);
    expect(c.statusLine).toBe("2 things need you");
    expect(aldoChatDecisions(read, NOW)).toHaveLength(2);
    expect(
      hiddenNeedsYou(read, NOW)
        .map((i) => i.title)
        .sort(),
    ).toEqual(["1,000-secret limit", "Check MiniMax exposure"]);
  });

  it("lists on the simple Needs you page exactly what its count says", () => {
    const read = home({
      conversations: [
        thread({ pending: question }),
        thread({ state: "failed", chatDecision: hidden("failed") }),
        thread({ pending: question, chatDecision: putOff("later") }),
      ],
      approvals: [approval("email"), approval("hid", { chatDecision: hidden("a") } as never)],
      plans: [plan("goal")],
    });
    const list = simpleNeedsYou(read, NOW);
    const shown =
      list.payments.length +
      list.conversations.length +
      list.merges.length +
      list.plans.length +
      list.approvals.filter((a) => a.status === "pending").length;
    expect(shown).toBe(aldoWaitingCount(read, NOW));
    expect(list.plans.map((p) => p.id)).toEqual(["goal"]);
    expect(list.approvals.map((a) => a.id)).toEqual(["email"]);
  });
});

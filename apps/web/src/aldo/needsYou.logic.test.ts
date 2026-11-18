import { describe, expect, it } from "vite-plus/test";
import { dismissedNeedsYou, inWords, needsYouWords, pendingNeedsYou } from "./needsYou.logic";
import type { AldoHome, AldoHomeConversation, AldoApproval } from "./homeApi";
const at = "2026-10-23T12:00:00.000Z";
const now = Date.parse(at);
const approval = (id: string, status = "pending") =>
  ({ id, status, kind: "email", title: id, createdAt: at }) as AldoApproval;
const conversation = (overrides: Partial<AldoHomeConversation> = {}): AldoHomeConversation => ({
  ref: "thread",
  thread: { environmentId: "aldo-thread", threadId: "thread" },
  title: "Launch review",
  repos: [],
  branch: "",
  at,
  state: "waiting",
  machine: "running",
  ...overrides,
});
const home = (overrides: Record<string, unknown> = {}) =>
  ({ conversations: [], pullRequests: [], actions: [], ...overrides }) as unknown as AldoHome;
it("says the total pending count, using words to nine", () => {
  expect(needsYouWords(0)).toBeNull();
  expect(needsYouWords(1)).toBe("One needs you");
  expect(needsYouWords(2)).toBe("Two need you");
  expect(needsYouWords(12)).toBe("12 need you");
  expect(inWords(3)).toBe("three");
});
it("excludes saved outcomes and local receipts before Home catches up", () => {
  const read = home({
    approvals: [approval("pending"), approval("done", "approved"), approval("gone", "withdrawn")],
  });
  expect(pendingNeedsYou(read, now).map((i) => i.key)).toEqual(["aldo:pending"]);
  expect(pendingNeedsYou(read, now, ["aldo:pending"])).toEqual([]);
});
it("counts a paused thread once and leaves hidden decisions out", () => {
  const read = home({
    conversations: [
      conversation({ state: "working", machine: "asleep" }),
      conversation({ ref: "hidden", chatDecision: { id: "hidden", dismissed: true } }),
    ],
  });
  expect(pendingNeedsYou(read, now).map((i) => i.key)).toEqual(["paused:thread"]);
});
it("never counts the approvals already decided in the last day", () => {
  const read = home({
    approvals: ["a", "b", "c", "d", "e"].map((id) => approval(id, "approved")),
  });
  expect(pendingNeedsYou(read, now)).toEqual([]);
});
it("leaves out what the user hid, in the conversation and from it", () => {
  const hidden = { id: "hidden", dismissed: true };
  const pullRequest = {
    repo: "aldo/aldo",
    number: 7,
    title: "Fix it",
    status: "watching",
    stage: "green",
    mergesAt: null,
    thread: null,
    greenSince: at,
    updatedAt: at,
  };
  const read = home({
    approvals: [approval("shown"), { ...approval("hidden"), chatDecision: hidden }],
    conversations: [
      conversation({ ref: "q", state: "failed", chatDecision: hidden }),
      conversation({ ref: "w", chatDecision: hidden }),
    ],
    pullRequests: [
      { ...pullRequest, chatDecision: hidden },
      { ...pullRequest, number: 8 },
    ],
  });
  expect(pendingNeedsYou(read, now).map((i) => i.key)).toEqual(["aldo:shown", "merge:aldo/aldo#8"]);
});
it("leaves out settled threads and threads snoozed until later, until their time comes", () => {
  const later = "2026-10-23T18:00:00.000Z";
  const read = home({
    conversations: [
      conversation({ ref: "settled", settled: true }),
      conversation({ ref: "snoozed", snoozedUntil: later }),
      conversation({ ref: "failed", state: "failed", snoozedUntil: later }),
      conversation({ ref: "done", state: "done" }),
    ],
  });
  expect(pendingNeedsYou(read, now)).toEqual([]);
  expect(pendingNeedsYou(read, Date.parse(later) + 1).map((i) => i.key)).toEqual([
    `waiting:snoozed:${at}`,
    `failed:failed:${at}`,
  ]);
});
it("counts a snoozed thread that asks something", () => {
  const read = home({
    conversations: [
      conversation({
        snoozedUntil: "2026-10-23T18:00:00.000Z",
        pending: { kind: "question", requestId: "scope", questions: [] },
      }),
    ],
  });
  expect(pendingNeedsYou(read, now).map((i) => i.kind)).toEqual(["Question"]);
});
describe("plans", () => {
  const plan = {
    id: "old",
    status: "proposed",
    goal: "Review the launch",
    cost: "Nothing",
    minutes: 30,
    steps: [],
    proposedAt: "2026-10-01T12:00:00Z",
  };
  const keys = (...plans: object[]) => pendingNeedsYou(home({ plans }), now).map((i) => i.key);
  it("counts one waiting for the user's Start, even from days ago", () => {
    expect(pendingNeedsYou(home({ plans: [plan] }), now).map((i) => [i.key, i.kind, i.at])).toEqual(
      [["home-plan:old", "Plan", plan.proposedAt]],
    );
    expect(keys({ ...plan, costsMoney: true, autoStartAt: "2026-10-23T12:05:00Z" })).toEqual([
      "home-plan:old",
    ]);
  });
  it("leaves out started plans, plans put off until later and plans whose Start failed", () => {
    expect(
      keys(
        { ...plan, id: "started", status: "started", startedAt: at },
        { ...plan, id: "later", deferredUntil: "2026-10-24T12:00:00Z" },
        { ...plan, id: "failed", error: "There's no Claude provider." },
      ),
    ).toEqual([]);
  });
  it("counts a plan again when its time away comes", () => {
    const put = { ...plan, deferredUntil: "2026-10-23T12:30:00Z" };
    expect(keys(put)).toEqual([]);
    expect(
      pendingNeedsYou(home({ plans: [put] }), Date.parse(put.deferredUntil)).map((i) => i.key),
    ).toEqual(["home-plan:old"]);
    expect(keys({ ...plan, deferredUntil: "2026-10-23T11:00:00Z", back: true })).toEqual([
      "home-plan:old",
    ]);
  });
  it("leaves out a plan that starts on its own", () => {
    expect(keys({ ...plan, autoStartAt: "2026-10-23T12:02:00Z" })).toEqual([]);
    expect(keys({ ...plan, autoStartAt: "2026-10-23T11:59:00Z" })).toEqual([]);
  });
});
it("lists each computer request with its arrival time without duplicating its waiting thread", () => {
  const computer = {
    computer: "gpu",
    status: "asked",
    creditsPerHour: 310,
    askedAt: "2026-10-23T11:00:00Z",
  };
  const read = home({
    conversations: [
      conversation({
        computers: [computer, { ...computer, computer: "windows", status: "running" }],
      }),
    ],
  });
  const items = pendingNeedsYou(read, now);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    title: "Start your GPU computer",
    kind: "Computer request",
    at: computer.askedAt,
  });
  expect(pendingNeedsYou(read, now, [items[0]!.key])).toEqual([]);
  const again = home({
    conversations: [conversation({ computers: [{ ...computer, askedAt: at }] })],
  });
  expect(pendingNeedsYou(again, now, [items[0]!.key])).toHaveLength(1);
});
it("keeps simultaneous questions and computer requests separate", () => {
  const c = conversation({
    computers: [{ computer: "gpu", status: "asked", creditsPerHour: 310 }],
    pending: { kind: "question", requestId: "scope", questions: [] },
  });
  expect(pendingNeedsYou(home({ conversations: [c] }), now).map((i) => i.kind)).toEqual([
    "Question",
    "Computer request",
  ]);
});
it("leaves out a computer request on a thread that is put away or hidden", () => {
  const computers = [{ computer: "gpu", status: "asked", creditsPerHour: 310 }];
  const read = home({
    conversations: [
      conversation({ ref: "settled", computers, settled: true }),
      conversation({ ref: "snoozed", computers, snoozedUntil: "2026-10-23T18:00:00.000Z" }),
      conversation({ ref: "hidden", computers, chatDecision: { id: "hidden", dismissed: true } }),
    ],
  });
  expect(pendingNeedsYou(read, now)).toEqual([]);
});
it("with hidden, counts what the user hid from the conversation, as the app badge does", () => {
  const hidden = { id: "hidden", dismissed: true };
  const putOff = { id: "later", dismissed: true, until: "2026-10-24T12:00:00.000Z" };
  const read = home({
    approvals: [approval("shown"), { ...approval("hidden"), chatDecision: hidden }],
    conversations: [
      conversation({ ref: "q", state: "failed", chatDecision: hidden }),
      conversation({ ref: "p", state: "paused", machine: "asleep", chatDecision: putOff }),
    ],
  });
  expect(pendingNeedsYou(read, now).map((i) => i.key)).toEqual(["aldo:shown"]);
  const all = pendingNeedsYou(read, now, [], true);
  expect(all.map((i) => i.key)).toEqual(
    expect.arrayContaining(["aldo:shown", "aldo:hidden", "paused:p"]),
  );
  expect(all.find((i) => i.key === "aldo:hidden")?.hidden).toEqual(hidden);
  expect(all.find((i) => i.key === "aldo:shown")?.hidden).toBeUndefined();
});
it("leaves out what the user dismissed, lists it as dismissed, and a different ask shows again", () => {
  const cleared = (id: string) => ({ id, dismissed: true, cleared: true });
  const plan = {
    id: "p1",
    goal: "Plan the trip",
    cost: "Free",
    steps: [],
    minutes: 5,
    status: "proposed",
    costsMoney: true,
    proposedAt: at,
    chatDecision: cleared("plan"),
  };
  const read = home({
    approvals: [approval("shown"), { ...approval("gone"), chatDecision: cleared("approval") }],
    plans: [plan],
    conversations: [
      conversation({ ref: "failed", state: "failed", chatDecision: cleared("failed") }),
      conversation({
        ref: "p",
        state: "paused",
        machine: "asleep",
        chatDecision: cleared("paused"),
      }),
      conversation({ ref: "new", state: "failed", chatDecision: { id: "next", dismissed: false } }),
    ],
  });
  for (const withHidden of [false, true]) {
    expect(
      pendingNeedsYou(read, now, [], withHidden)
        .map((i) => i.key)
        .sort(),
    ).toEqual(["aldo:shown", `failed:new:${at}`]);
  }
  expect(
    dismissedNeedsYou(read, now)
      .map((i) => i.key)
      .sort(),
  ).toEqual(["aldo:gone", "home-plan:p1", `failed:failed:${at}`, "paused:p"].sort());
  expect(dismissedNeedsYou(read, now).every((i) => i.decision?.cleared)).toBe(true);
  expect(dismissedNeedsYou(read, now, ["aldo:gone"]).map((i) => i.key)).not.toContain("aldo:gone");
});

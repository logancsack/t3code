import { expect, it } from "vite-plus/test";
import { inWords, needsYouWords, pendingNeedsYou } from "./needsYou.logic";
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
const home = (overrides: Partial<AldoHome> = {}) =>
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
it("includes older proposed plans, excluding started and deferred plans", () => {
  const plan = {
    id: "old",
    status: "proposed",
    goal: "Review the launch",
    cost: "Nothing",
    minutes: 30,
    steps: [],
    proposedAt: "2026-10-01T12:00:00Z",
  };
  const read = home({
    plans: [
      plan,
      { ...plan, id: "started", status: "started" },
      { ...plan, id: "later", deferredUntil: "2026-10-24T12:00:00Z" },
    ],
  });
  expect(pendingNeedsYou(read, now).map((i) => [i.key, i.kind, i.at])).toEqual([
    ["home-plan:old", "Plan", plan.proposedAt],
  ]);
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

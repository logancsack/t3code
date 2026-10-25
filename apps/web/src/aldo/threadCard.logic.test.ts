import { expect, it } from "vite-plus/test";

import type { AldoHome, AldoHomeConversation, AldoHomeDelivery } from "./homeApi";
import { clockAt, stalledOf, threadCardOf } from "./threadCard.logic";

const now = Date.parse("2026-10-24T20:30:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const HOUR = 3_600_000;
const conversation = (patch: Partial<AldoHomeConversation> = {}): AldoHomeConversation => ({
  ref: "t",
  thread: { environmentId: "aldo-t", threadId: "c" },
  title: "Inline artifacts in the prime agent chat",
  repos: ["logancsack/aldo"],
  branch: "aldo/t",
  state: "working",
  machine: "running",
  at: ago(5 * 60_000),
  ...patch,
});
const usage = (alert = "none") =>
  ({
    configured: true,
    metered: true,
    plan: { id: "p", name: "Pro", includedCredits: 100 },
    period: { status: "active", start: "", end: "" },
    credits: { used: 1, included: 100, authorized: 100, remaining: 99, projected: null },
    bill: null,
    alert,
    agents: { running: 3, limit: 3 },
  }) as AldoHome["usage"];
const homeWith = (
  upcoming: AldoHomeDelivery[] = [],
  alert = "none",
): Pick<AldoHome, "upcoming" | "usage" | "health"> => ({
  upcoming,
  usage: usage(alert),
  health: { providers: [], connected: [], environments: [] },
});
const held = (patch: Partial<AldoHomeDelivery> = {}): AldoHomeDelivery => ({
  id: "r",
  kind: "message",
  thread: { environmentId: "aldo-t", threadId: "c" },
  threadTitle: "t",
  message: "Include html pages. Build and ship this",
  dueAt: ago(2 * HOUR),
  createdAt: ago(2 * HOUR),
  held: true,
  ...patch,
});

it("names a paused thread, when it stopped, and that only a tap is asked", () => {
  const c = conversation({
    state: "paused",
    machine: "asleep",
    at: ago(2 * HOUR),
    stateAt: ago(2 * HOUR),
  });
  const view = threadCardOf(homeWith(), c, now);
  expect(view).toMatchObject({
    tone: "attention",
    status: "Paused mid-turn · 2 h",
    action: "continue",
  });
  expect(view.body).toContain(`went to sleep at ${clockAt(ago(2 * HOUR), now)}`);
  expect(view.body).toContain("Nothing is needed from you except whether to carry on");
  // An older Aldo's read has it working on a computer asleep: the same thing.
  expect(threadCardOf(homeWith(), conversation({ machine: "asleep" }), now).status).toMatch(
    /^Paused/,
  );
});

it("calls work with no word for an hour stuck, and a held message of the user's a reply that didn't start", () => {
  const stuck = conversation({ at: ago(80 * 60_000) });
  expect(threadCardOf(homeWith(), stuck, now)).toMatchObject({
    status: "No progress for 1 h 20 min",
    action: "continue",
  });
  const unsent = threadCardOf(homeWith([held()]), conversation(), now);
  expect(unsent).toMatchObject({
    status: "Your reply didn't start · 2 h",
    quote: "Include html pages. Build and ship this",
    action: "continue",
  });
  // Aldo's own retries are still going: not stuck yet. Another thread's message isn't this one's.
  expect(stalledOf(homeWith([held({ dueAt: ago(60_000) })]), conversation(), now)).toBeNull();
  expect(
    stalledOf(
      homeWith([held({ thread: { environmentId: "aldo-x", threadId: "c" } })]),
      conversation(),
      now,
    ),
  ).toBeNull();
  expect(stalledOf(homeWith([held({ kind: "reminder" })]), conversation(), now)).toBeNull();
});

it("sends a plan that can't run agents to its fix instead of Continue", () => {
  const c = conversation({ state: "paused", machine: "asleep" });
  const view = threadCardOf(homeWith([], "included_exhausted"), c, now);
  expect(view.action).toBe("fix");
  expect(view.body).toContain("credits are used up");
  expect(stalledOf(homeWith([], "included_exhausted"), c, now)?.blocked).toMatchObject({
    label: "Raise the limit",
    href: "/settings/account",
  });
  expect(stalledOf(homeWith(), c, now)?.blocked).toBeUndefined();
});

it("says what each other state is, and asks the user only for what waits on them", () => {
  const card = (patch: Partial<AldoHomeConversation>) =>
    threadCardOf(homeWith(), conversation(patch), now);
  expect(card({ at: ago(30_000) })).toMatchObject({
    status: "Working",
    tone: "quiet",
    action: null,
  });
  expect(card({})).toMatchObject({ status: "Working · 5 min", action: null });
  expect(card({ browsing: { site: "square.com", at: ago(1000) } }).status).toBe(
    "Working in the browser · 5 min",
  );
  expect(card({ state: "starting" }).status).toBe("Starting its computer");
  expect(card({ state: "queued" }).body).toContain("runs 3 agents at once and 3 are busy");
  expect(card({ state: "retrying" }).status).toBe("Taking longer than usual. Retrying.");
  expect(card({ state: "done", at: ago(3 * HOUR) })).toMatchObject({
    status: "Finished 3 h ago",
    dot: "done",
    action: null,
  });
  expect(card({ state: "new" }).status).toBe("Not started");
  expect(card({ state: "unavailable" }).action).toBeNull();
  expect(card({ state: "working", routine: "r1" }).status).toMatch(/^Routine run · Working/);
  expect(card({ state: "failed", at: ago(25 * 60_000) })).toMatchObject({
    status: "Stopped with an error · 25 min",
    tone: "problem",
    action: "ask",
  });
  expect(
    card({ state: "waiting", plan: { id: "p", text: "Do it" }, at: ago(3 * HOUR) }),
  ).toMatchObject({ status: "Plan to approve · 3 h", tone: "attention", action: "show" });
  expect(
    card({
      state: "waiting",
      pending: { kind: "question", requestId: "q", questions: [] },
      at: ago(12 * 60_000),
    }).status,
  ).toBe("Question · 12 min");
});

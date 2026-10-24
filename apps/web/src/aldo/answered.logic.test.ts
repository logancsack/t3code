import { expect, it } from "vite-plus/test";

import { askOf, carryingOn, HOLD_MS, withHolds } from "./answered.logic";
import type { AldoHome, AldoHomeConversation } from "./homeApi";

const at = "2026-10-16T00:00:00Z";
const conversation = (patch: Partial<AldoHomeConversation> = {}): AldoHomeConversation => ({
  ref: "t",
  thread: { environmentId: "aldo-t", threadId: "c" },
  title: "Work",
  repos: [],
  branch: "aldo/t",
  state: "waiting",
  machine: "asleep",
  at,
  pending: {
    kind: "approval",
    requestId: "r1",
    summary: "Run the migration?",
    options: [{ decision: "accept", label: "Yes" }],
  },
  ...patch,
});
const homeOf = (...conversations: AldoHomeConversation[]) =>
  ({ conversations }) as unknown as AldoHome;
const hold = { ask: "r1", at: "2026-10-16T00:00:10Z" };

it("names what a conversation waits on to be answered", () => {
  expect(askOf(conversation())).toBe("r1");
  const { pending: _asking, ...planning } = conversation();
  expect(askOf({ ...planning, plan: { id: "p1", text: "Do it" } })).toBe("p1");
  expect(askOf(conversation({ pending: { kind: "handoff", requestId: "h", summary: "" } }))).toBe(
    null,
  );
  expect(askOf(conversation({ state: "working", machine: "running" }))).toBe(null);
});

/** A conversation that asks nothing. */
const nothingAsked = (patch: Partial<AldoHomeConversation>): AldoHomeConversation => {
  const { pending: _asking, ...rest } = conversation();
  return { ...rest, ...patch };
};

it("names the Continue that carries a paused conversation on, held out until the read has caught up", () => {
  const paused = nothingAsked({
    state: "paused",
    stateAt: "2026-10-15T18:27:53Z",
  });
  expect(askOf(paused)).toBe("paused:2026-10-15T18:27:53Z");
  // Its computer asleep with a turn open reads as paused to an older Aldo too.
  expect(askOf(nothingAsked({ state: "working", machine: "asleep" }))).toMatch(/^paused:/);
  const ask = askOf(paused)!;
  const now = Date.parse(hold.at);
  const held = withHolds(homeOf(paused), { t: { ask, at: hold.at } }, now);
  expect(held.home.conversations[0]).toMatchObject({ state: "starting", at: hold.at });
  // Aldo's read says it's working again: the hold is spent.
  const moved = nothingAsked({ state: "working", machine: "running" });
  expect(withHolds(homeOf(moved), { t: { ask, at: hold.at } }, now).holds).toEqual({});
});

it("shows an answered conversation as carrying on, whether or not its computer is up", () => {
  const asleep = carryingOn(conversation({ summary: "Run the migration?" }), hold);
  expect(asleep).toMatchObject({ state: "starting", at: hold.at, stateAt: hold.at });
  expect(asleep.pending).toBeUndefined();
  expect(asleep.summary).toBeUndefined();
  expect(carryingOn(conversation({ machine: "running" }), hold).state).toBe("working");
});

it("holds out an answer while the read still asks it, and lets go once it has caught up or time passes", () => {
  const now = Date.parse(hold.at);
  const held = withHolds(homeOf(conversation()), { t: hold }, now);
  expect(held.home.conversations[0]!.pending).toBeUndefined();
  expect(held.holds).toEqual({ t: hold });
  // The thread asks something else, or has moved on, or is gone: the hold is spent.
  const other = conversation({
    pending: { kind: "approval", requestId: "r2", summary: "", options: [] },
  });
  expect(withHolds(homeOf(other), { t: hold }, now)).toMatchObject({ holds: {} });
  expect(withHolds(homeOf(conversation({ state: "working" })), { t: hold }, now).holds).toEqual({});
  expect(withHolds(homeOf(), { t: hold }, now).holds).toEqual({});
  // An answer Aldo took is held for HOLD_MS, then the card is the thread's own again.
  const taken = { ...hold, until: now + HOLD_MS };
  expect(
    withHolds(homeOf(conversation()), { t: taken }, now + HOLD_MS - 1).home.conversations[0]!
      .pending,
  ).toBeUndefined();
  const expired = withHolds(homeOf(conversation()), { t: taken }, now + HOLD_MS);
  expect(expired.home.conversations[0]!.pending).toMatchObject({ requestId: "r1" });
  expect(expired.holds).toEqual({});
});

it("gives back the same read when nothing is held", () => {
  const home = homeOf(conversation());
  expect(withHolds(home, {}, 0).home).toBe(home);
  expect(withHolds(home, { elsewhere: hold }, 0).home).toBe(home);
});

import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  aldoSidebarTier,
  aldoThreadFinishedAtMs,
  holdAldoSidebarOrder,
  sortAldoSidebarThreads,
  type AldoSidebarOrderInput,
} from "./sidebarOrder.logic";

const ENV = EnvironmentId.make("aldo-a");

function at(minute: number): string {
  return new Date(Date.UTC(2026, 9, 16, 12, minute)).toISOString();
}

type Turn = NonNullable<AldoSidebarOrderInput["latestTurn"]>;
type Session = NonNullable<AldoSidebarOrderInput["session"]>;

function turn(overrides: Partial<Turn> = {}): Turn {
  return {
    turnId: TurnId.make("turn"),
    state: "completed",
    requestedAt: at(1),
    startedAt: at(1),
    completedAt: at(2),
    assistantMessageId: null,
    ...overrides,
  };
}

function session(status: Session["status"], overrides: Partial<Session> = {}): Session {
  return {
    threadId: ThreadId.make("t"),
    status,
    providerName: null,
    runtimeMode: "full-access",
    activeTurnId: status === "running" ? TurnId.make("turn") : null,
    lastError: null,
    updatedAt: at(1),
    ...overrides,
  } as Session;
}

function thread(id: string, overrides: Partial<AldoSidebarOrderInput> = {}): AldoSidebarOrderInput {
  return {
    id: ThreadId.make(id),
    environmentId: ENV,
    createdAt: at(0),
    updatedAt: at(0),
    latestTurn: null,
    session: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    ...overrides,
  };
}

const ids = (threads: readonly AldoSidebarOrderInput[]) => threads.map((t) => t.id as string);

/** A thread whose latest turn ended at `minute`. */
const finished = (id: string, minute: number, overrides: Partial<AldoSidebarOrderInput> = {}) =>
  thread(id, {
    latestTurn: turn({
      requestedAt: at(minute - 1),
      startedAt: at(minute - 1),
      completedAt: at(minute),
    }),
    session: session("ready", { updatedAt: at(minute) }),
    ...overrides,
  });

/** A plan from a turn that ended at `minute`, in plan mode, to accept. */
const planned = { hasActionableProposedPlan: true, interactionMode: "plan" } as const;

/** A thread with a turn running since `minute`. */
const running = (id: string, minute: number, overrides: Partial<AldoSidebarOrderInput> = {}) =>
  thread(id, {
    latestTurn: turn({
      state: "running",
      requestedAt: at(minute),
      startedAt: at(minute),
      completedAt: null,
    }),
    session: session("running", { updatedAt: at(minute) }),
    ...overrides,
  });

describe("aldoSidebarTier", () => {
  it("counts a running turn, a starting machine and background work as work", () => {
    expect(aldoSidebarTier(running("a", 5))).toBe("working");
    // As Aldo's start shells and the fork's starting threads have it: no turn yet.
    expect(aldoSidebarTier(thread("b", { session: session("starting") }))).toBe("working");
    expect(aldoSidebarTier(finished("c", 5, { backgroundLiveness: "working" }))).toBe("working");
    expect(aldoSidebarTier(finished("d", 5, { backgroundLiveness: "monitoring" }))).toBe("working");
  });

  it("counts a message Aldo holds (starting, queued or retrying) as work, whatever the shell says", () => {
    expect(aldoSidebarTier(finished("a", 5), true)).toBe("working");
    expect(aldoSidebarTier(finished("b", 5, { hasPendingUserInput: true }), true)).toBe("working");
  });

  it("puts questions, approvals and plans to accept in the waiting tier", () => {
    expect(aldoSidebarTier(finished("a", 5, { hasPendingUserInput: true }))).toBe("waiting");
    // An approval pauses its turn: the thread waits on the user, not the agent.
    expect(aldoSidebarTier(running("b", 5, { hasPendingApprovals: true }))).toBe("waiting");
    expect(aldoSidebarTier(finished("c", 5, planned))).toBe("waiting");
    // A plan prompt outranks background work, as its status pill does.
    expect(aldoSidebarTier(finished("d", 5, { ...planned, backgroundLiveness: "working" }))).toBe(
      "waiting",
    );
  });

  it("doesn't count a plan while its turn still runs", () => {
    expect(aldoSidebarTier(running("a", 5, planned))).toBe("working");
  });

  it("doesn't count a plan left over once the thread is out of plan mode (no prompt to accept it)", () => {
    expect(
      aldoSidebarTier(
        finished("a", 5, { hasActionableProposedPlan: true, interactionMode: "default" }),
      ),
    ).toBe("done");
  });

  it("leaves finished, failed and never-run threads in the done tier", () => {
    expect(aldoSidebarTier(finished("a", 5))).toBe("done");
    expect(
      aldoSidebarTier(
        finished("b", 5, {
          latestTurn: turn({ state: "error" }),
          session: session("error", { lastError: "boom" }),
        }),
      ),
    ).toBe("done");
    expect(aldoSidebarTier(thread("c"))).toBe("done");
  });
});

describe("aldoThreadFinishedAtMs", () => {
  it("reads the latest turn's end, not when the thread was made or last changed", () => {
    expect(aldoThreadFinishedAtMs(finished("a", 30, { createdAt: at(0), updatedAt: at(50) }))).toBe(
      Date.parse(at(30)),
    );
  });

  it("falls back to the turn's start for a turn T3 never saw end", () => {
    const stale = thread("a", {
      latestTurn: turn({ state: "running", startedAt: at(7), completedAt: null }),
      session: session("stopped"),
    });
    expect(aldoThreadFinishedAtMs(stale)).toBe(Date.parse(at(7)));
  });

  it("goes by the last change, then creation, only for a thread that never ran", () => {
    expect(aldoThreadFinishedAtMs(thread("a", { createdAt: at(3), updatedAt: at(9) }))).toBe(
      Date.parse(at(9)),
    );
    expect(aldoThreadFinishedAtMs(thread("b", { createdAt: at(3), updatedAt: "not a date" }))).toBe(
      Date.parse(at(3)),
    );
  });

  it("skips a malformed end for the next timestamp", () => {
    const odd = finished("a", 20, {
      latestTurn: turn({ startedAt: at(19), completedAt: "garbage" }),
    });
    expect(aldoThreadFinishedAtMs(odd)).toBe(Date.parse(at(19)));
  });
});

describe("sortAldoSidebarThreads", () => {
  it("lists work, then what waits on the user, then the newest finished first", () => {
    const threads = [
      finished("old", 10, { createdAt: at(59) }),
      finished("recent", 40, { createdAt: at(1) }),
      running("busy", 20),
      finished("asks", 15, { hasPendingUserInput: true }),
      thread("never", { createdAt: at(30), updatedAt: at(30) }),
      finished("plan", 25, planned),
    ];
    expect(ids(sortAldoSidebarThreads(threads))).toEqual([
      "busy",
      "plan",
      "asks",
      "recent",
      "never",
      "old",
    ]);
  });

  it("orders threads at work by when their work began, newest first", () => {
    const threads = [
      running("early", 5),
      thread("starting", { session: session("starting", { updatedAt: at(50) }) }),
      running("late", 30),
      finished("background", 40, { backgroundLiveness: "working" }),
    ];
    expect(ids(sortAldoSidebarThreads(threads))).toEqual([
      "starting",
      "background",
      "late",
      "early",
    ]);
  });

  it("moves a thread up as its work starts, and down to the newest finished as it ends", () => {
    const others = [finished("a", 10), finished("b", 20)];
    expect(ids(sortAldoSidebarThreads([...others, finished("c", 5)]))).toEqual(["b", "a", "c"]);
    expect(ids(sortAldoSidebarThreads([...others, running("c", 30)]))).toEqual(["c", "b", "a"]);
    expect(ids(sortAldoSidebarThreads([...others, finished("c", 31)]))).toEqual(["c", "b", "a"]);
  });

  it("puts a thread Aldo holds a message for with the work", () => {
    const threads = [finished("a", 30), finished("held", 5), running("b", 20)];
    const heldFor = (candidate: AldoSidebarOrderInput) =>
      candidate.id === "held" ? { failed: false, atMs: 0 } : undefined;
    expect(ids(sortAldoSidebarThreads(threads, heldFor))).toEqual(["b", "held", "a"]);
  });

  it("orders a held message by when it was sent, which its shell doesn't know yet", () => {
    // A follow-up to a sleeping machine: its shell still has the turn before.
    const threads = [running("b", 20), finished("held", 5), running("c", 30)];
    const heldFor = (candidate: AldoSidebarOrderInput) =>
      candidate.id === "held" ? { failed: false, atMs: Date.parse(at(40)) } : undefined;
    expect(ids(sortAldoSidebarThreads(threads, heldFor))).toEqual(["held", "c", "b"]);
  });

  it("orders a message that couldn't be sent with the finished ones, by when it failed", () => {
    const threads = [finished("a", 30), finished("failed", 5), finished("b", 20)];
    const heldFor = (candidate: AldoSidebarOrderInput) =>
      candidate.id === "failed" ? { failed: true, atMs: Date.parse(at(25)) } : undefined;
    expect(ids(sortAldoSidebarThreads(threads, heldFor))).toEqual(["a", "failed", "b"]);
    expect(ids(sortAldoSidebarThreads([...threads, running("c", 1)], heldFor))).toEqual([
      "c",
      "a",
      "failed",
      "b",
    ]);
  });

  it("breaks ties by id, then machine, whatever order the threads come in", () => {
    const tie = [
      finished("b", 10),
      finished("a", 10, { environmentId: EnvironmentId.make("aldo-z") }),
      finished("a", 10),
    ];
    const expected = [
      ["a", "aldo-a"],
      ["a", "aldo-z"],
      ["b", "aldo-a"],
    ];
    const pairs = (threads: readonly AldoSidebarOrderInput[]) =>
      threads.map((t) => [t.id as string, t.environmentId as string]);
    expect(pairs(sortAldoSidebarThreads(tie))).toEqual(expected);
    expect(pairs(sortAldoSidebarThreads(tie.toReversed()))).toEqual(expected);
  });

  it("returns a copy, leaving its input as it was", () => {
    const threads = [finished("a", 1), finished("b", 2)];
    sortAldoSidebarThreads(threads);
    expect(ids(threads)).toEqual(["a", "b"]);
  });
});

describe("holdAldoSidebarOrder", () => {
  const key = (item: string) => item;

  it("keeps the rows on screen where they are", () => {
    expect(holdAldoSidebarOrder(["a", "b", "c"], ["c", "a", "b"], key)).toEqual(["a", "b", "c"]);
  });

  it("gives a row new to the list its own place, and drops the ones that left", () => {
    expect(holdAldoSidebarOrder(["a", "b", "c"], ["n", "c", "a"], key)).toEqual(["n", "a", "c"]);
    expect(holdAldoSidebarOrder(["a", "b"], ["b", "n", "a"], key)).toEqual(["a", "n", "b"]);
  });

  it("is the new order when nothing was on screen", () => {
    expect(holdAldoSidebarOrder([], ["b", "a"], key)).toEqual(["b", "a"]);
  });
});

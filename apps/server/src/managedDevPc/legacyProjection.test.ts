import { RunId, ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  legacyThreadShell,
  legacyTurnPage,
  managedActivity,
  managedThreadNeedsTerminalization,
  QUEUED_TURN_START_FUTURE_SKEW_MS,
} from "./legacyProjection.ts";

const NOW_MS = Date.parse("2026-08-09T12:00:00.000Z");
const at = (offsetMs: number) => DateTime.makeUnsafe(NOW_MS + offsetMs);

const shell = (overrides: Partial<OrchestrationV2ThreadShell> = {}) =>
  legacyThreadShell({
    id: ThreadId.make("thread-1"),
    status: "idle",
    activeRunId: null,
    latestRunId: null,
    pendingRuntimeRequest: null,
    hasActionableProposedPlan: false,
    latestUserMessageAt: null,
    createdAt: at(-60_000),
    updatedAt: at(-1_000),
    ...overrides,
  } as OrchestrationV2ThreadShell);

const run = RunId.make("run-1");
const running = (overrides: Partial<OrchestrationV2ThreadShell> = {}) =>
  shell({
    status: "running",
    activeRunId: run,
    latestRunId: run,
    latestRunRequestedAt: at(-5_000),
    latestUserMessageAt: at(-5_000),
    ...overrides,
  });

describe("legacyThreadShell", () => {
  it("reports a run as the turn Aldo reads, with the run id as the turn id", () => {
    expect(running()).toMatchObject({
      latestTurn: { turnId: run, state: "running", completedAt: null },
      session: { status: "running", activeTurnId: run, lastError: null },
    });
    expect(
      shell({ status: "failed", latestRunId: run, lastError: "Provider exited" }),
    ).toMatchObject({
      latestTurn: { turnId: run, state: "error" },
      session: { status: "error", activeTurnId: null, lastError: "Provider exited" },
    });
    expect(shell({ status: "interrupted", latestRunId: run }).session?.status).toBe("interrupted");
    expect(shell()).toMatchObject({ latestTurn: null, session: null });
  });

  it("keeps the active run as the turn while a follow-up waits behind it", () => {
    const queued = RunId.make("run-2");
    expect(
      shell({
        status: "queued",
        activeRunId: run,
        latestRunId: queued,
        activityRunStatus: "running",
      }),
    ).toMatchObject({
      latestTurn: { turnId: run, state: "running" },
      session: { status: "running", activeTurnId: run },
    });
  });

  it("splits a pending request into approval or question", () => {
    expect(running({ pendingRuntimeRequest: { kind: "user_input" } as never })).toMatchObject({
      hasPendingApprovals: false,
      hasPendingUserInput: true,
    });
    expect(running({ pendingRuntimeRequest: { kind: "command_approval" } as never })).toMatchObject(
      { hasPendingApprovals: true, hasPendingUserInput: false },
    );
  });
});

describe("managedActivity", () => {
  it("is active only while a turn runs unblocked", () => {
    expect(managedActivity([running()], NOW_MS)).toEqual({
      active: true,
      working: true,
      pendingWork: false,
      backgroundWork: null,
    });
    expect(
      managedActivity(
        [running({ pendingRuntimeRequest: { kind: "user_input" } as never })],
        NOW_MS,
      ),
    ).toMatchObject({ active: false, pendingWork: true });
    expect(managedActivity([running({ hasActionableProposedPlan: true })], NOW_MS)).toMatchObject({
      active: false,
      pendingWork: true,
    });
    expect(
      managedActivity(
        [shell({ status: "completed", latestRunId: run, latestRunCompletedAt: at(-1_000) })],
        NOW_MS,
      ),
    ).toEqual({ active: false, working: false, pendingWork: false, backgroundWork: null });
    expect(managedActivity([], NOW_MS).working).toBe(false);
  });

  it("counts a starting run and an unadopted message as working, not active", () => {
    expect(managedActivity([running({ status: "starting" })], NOW_MS)).toMatchObject({
      active: false,
      working: true,
    });
    expect(
      managedActivity([shell({ latestUserMessageAt: at(-24 * 60 * 60_000) })], NOW_MS).working,
    ).toBe(true);
    // Only an implausibly future client timestamp is rejected.
    expect(
      managedActivity(
        [shell({ latestUserMessageAt: at(QUEUED_TURN_START_FUTURE_SKEW_MS + 1_000) })],
        NOW_MS,
      ).working,
    ).toBe(false);
    // A turn that failed after the message cannot adopt it.
    expect(
      managedActivity(
        [shell({ status: "failed", latestRunId: run, latestUserMessageAt: at(-5_000) })],
        NOW_MS,
      ).working,
    ).toBe(false);
  });

  it("reports background work that outlives a settled turn, working above monitoring", () => {
    const settled = (tasks: ReadonlyArray<unknown>) =>
      shell({
        status: "completed",
        latestRunId: run,
        latestRunCompletedAt: at(-1_000),
        pendingBackgroundTasks: tasks as never,
      });
    const watch = { kind: "monitor", awaited: false };
    expect(managedActivity([settled([watch])], NOW_MS)).toMatchObject({
      active: false,
      working: false,
      backgroundWork: "monitoring",
    });
    expect(
      managedActivity([settled([watch]), settled([{ kind: "subagent" }])], NOW_MS),
    ).toMatchObject({ active: true, working: true, backgroundWork: "working" });
  });

  it("stops what is running or about to run before a pause, and nothing settled", () => {
    expect(managedThreadNeedsTerminalization(running(), NOW_MS)).toBe(true);
    expect(managedThreadNeedsTerminalization(running({ status: "queued" }), NOW_MS)).toBe(true);
    expect(
      managedThreadNeedsTerminalization(
        shell({ status: "completed", latestRunId: run, latestRunCompletedAt: at(-1_000) }),
        NOW_MS,
      ),
    ).toBe(false);
  });
});

describe("legacyTurnPage", () => {
  const runs = [1, 2, 3, 4, 5].map((ordinal) => ({ id: RunId.make(`run-${ordinal}`), ordinal }));

  it("pages backwards through disjoint slices until none are left", () => {
    const newest = legacyTurnPage({ runs, turnLimit: 2 });
    expect([...newest.runIds]).toEqual(["run-4", "run-5"]);
    expect(newest.page).toEqual({ beforeCursor: "4", hasMore: true });

    const older = legacyTurnPage({ runs, turnLimit: 2, beforeCursor: 4 });
    expect([...older.runIds]).toEqual(["run-2", "run-3"]);

    const oldest = legacyTurnPage({ runs, turnLimit: 2, beforeCursor: 2 });
    expect([...oldest.runIds]).toEqual(["run-1"]);
    expect(oldest.page).toEqual({ beforeCursor: null, hasMore: false });
  });

  it("says more exists when the read itself loaded only the newest turns", () => {
    expect(legacyTurnPage({ runs: runs.slice(3), turnLimit: 3, olderUnloaded: true }).page).toEqual(
      { beforeCursor: "4", hasMore: true },
    );
  });
});

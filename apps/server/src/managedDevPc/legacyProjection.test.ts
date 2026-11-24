import {
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  legacyThreadDetail,
  legacyThreadShell,
  legacyTurnPage,
  managedActivity,
  managedThreadNeedsTerminalization,
  QUEUED_TURN_START_FUTURE_SKEW_MS,
} from "./legacyProjection.ts";
import { stallMessage } from "./turnStall.ts";

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

describe("legacyThreadDetail", () => {
  const item = (id: string, fields: object) => ({
    id,
    runId: run,
    status: "completed",
    startedAt: at(-4_000),
    updatedAt: at(-3_000),
    ...fields,
  });
  const detail = legacyThreadDetail({
    shell: {
      id: ThreadId.make("thread-1"),
      status: "interrupted",
      activeRunId: null,
      latestRunId: run,
      pendingRuntimeRequest: null,
      createdAt: at(-60_000),
      updatedAt: at(-1_000),
    } as OrchestrationV2ThreadShell,
    instructions: new Map([[run, { contract: "aldo-result", version: 7 }]]),
    projection: {
      runs: [
        {
          id: run,
          status: "interrupted",
          userMessageId: "msg-1",
          modelSelection: { instanceId: "codex", model: "gpt" },
          requestedAt: at(-5_000),
          startedAt: at(-4_500),
        },
      ],
      attempts: [{ id: "attempt-1", runId: run }],
      runtimeRequests: [],
      messages: [],
      plans: [],
      checkpoints: [],
      providerTurns: [
        {
          id: "provider-turn-1",
          runAttemptId: "attempt-1",
          tokenUsage: {
            usedTokens: 1_200,
            maxTokens: 200_000,
            inputTokens: 900,
            outputTokens: 300,
            updatedAt: "2026-08-09T11:59:58.000Z",
          },
        },
      ],
      turnItems: [
        item("tool", { type: "command_execution", input: "ls", status: "failed" }),
        item("error", {
          type: "error",
          failure: { message: "Overloaded", class: "provider", code: "529", retryable: true },
        }),
        item("notice", { type: "system_notice", message: "Context was compacted" }),
        item("stall", {
          type: "run_interrupt_request",
          message: stallMessage("suspend-silence", 90_000),
        }),
        item("stop", { type: "run_interrupt_request", message: "Stopped by user" }),
      ],
    } as unknown as OrchestrationV2ThreadProjection,
  });
  const activity = (kind: string) =>
    detail.activities.filter((candidate) => candidate.kind === kind);

  // One row per fact Aldo's coordinator reads from a turn (sandbox-agent/turns.ts, attention.ts).
  it.each([
    [
      "provider.turn.dispatched",
      {
        turnId: null,
        payload: {
          requestId: "msg-1",
          modelSelection: { instanceId: "codex", model: "gpt" },
          instructions: { contract: "aldo-result", version: 7 },
        },
      },
    ],
    ["tool.completed", { turnId: run, payload: { toolCallId: "tool", status: "failed" } }],
    [
      "runtime.error",
      { turnId: run, payload: { message: "Overloaded", class: "provider", code: "529" } },
    ],
    ["runtime.warning", { turnId: run, payload: { message: "Context was compacted" } }],
    // Only the watchdog's stop is a stall; the user's Stop beside it is not.
    ["turn.stalled", { turnId: run, payload: { turnId: run, reason: "suspend-silence" } }],
    ["context-window.updated", { turnId: run, payload: { usedTokens: 1_200, maxTokens: 200_000 } }],
  ])("reports %s", (kind, expected) => {
    const found = activity(kind);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject(expected);
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

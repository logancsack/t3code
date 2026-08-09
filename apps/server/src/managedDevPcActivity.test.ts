import type { OrchestrationThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  hasPendingManagedWork,
  hasQueuedManagedTurnStart,
  hasRunningManagedTurn,
  hasStartingManagedSession,
  QUEUED_TURN_START_GRACE_MS,
} from "./managedDevPcActivity.ts";
import {
  clearPrimeAgentSessionActivity,
  hasRunningPrimeAgentSubagents,
  updatePrimeAgentSubagentActivity,
} from "./provider/PrimeAgentActivity.ts";

const thread = (
  state: "running" | "interrupted" | "completed" | "error" | null,
  waiting: "approval" | "input" | "plan" | null = null,
) =>
  ({
    latestTurn: state === null ? null : { state },
    latestUserMessageAt: null,
    session: null,
    hasPendingApprovals: waiting === "approval",
    hasPendingUserInput: waiting === "input",
    hasActionableProposedPlan: waiting === "plan",
  }) as OrchestrationThreadShell;

const NOW_MS = Date.parse("2026-08-09T12:00:00.000Z");
const iso = (offsetMs: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW_MS + offsetMs));

const queuedThread = (
  overrides: Partial<{
    latestUserMessageAt: string | null;
    latestTurn: OrchestrationThreadShell["latestTurn"];
    sessionStatus: "idle" | "starting" | "running" | "ready" | "interrupted" | "stopped" | "error";
  }> = {},
) =>
  ({
    latestTurn: overrides.latestTurn ?? null,
    latestUserMessageAt:
      overrides.latestUserMessageAt === undefined ? iso(-5_000) : overrides.latestUserMessageAt,
    session:
      overrides.sessionStatus === undefined ? null : ({ status: overrides.sessionStatus } as never),
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  }) as OrchestrationThreadShell;

describe("managed DevPC activity", () => {
  it("reports activity only while an AI turn is running", () => {
    expect(hasRunningManagedTurn([thread("completed"), thread("running")])).toBe(true);
    expect(hasRunningManagedTurn([thread("completed"), thread("interrupted")])).toBe(false);
    expect(hasRunningManagedTurn([thread("running", "approval")])).toBe(false);
    expect(hasRunningManagedTurn([thread("running", "input")])).toBe(false);
    expect(hasRunningManagedTurn([thread("running", "plan")])).toBe(false);
    expect(hasRunningManagedTurn([thread(null)])).toBe(false);
    expect(hasRunningManagedTurn([])).toBe(false);
  });

  it("counts a fresh user message no turn adopted yet as queued work", () => {
    expect(hasQueuedManagedTurnStart([queuedThread()], NOW_MS)).toBe(true);
    // Adopted: the turn's requestedAt is newer than the message.
    expect(
      hasQueuedManagedTurnStart(
        [
          queuedThread({
            latestTurn: {
              state: "running",
              requestedAt: iso(-1_000),
              startedAt: null,
              completedAt: null,
            } as never,
          }),
        ],
        NOW_MS,
      ),
    ).toBe(false);
    // Stale: outside the grace window in either direction.
    expect(
      hasQueuedManagedTurnStart(
        [queuedThread({ latestUserMessageAt: iso(-QUEUED_TURN_START_GRACE_MS - 1_000) })],
        NOW_MS,
      ),
    ).toBe(false);
    expect(
      hasQueuedManagedTurnStart(
        [queuedThread({ latestUserMessageAt: iso(QUEUED_TURN_START_GRACE_MS + 1_000) })],
        NOW_MS,
      ),
    ).toBe(false);
    // An errored session cannot adopt the message.
    expect(hasQueuedManagedTurnStart([queuedThread({ sessionStatus: "error" })], NOW_MS)).toBe(
      false,
    );
    expect(hasQueuedManagedTurnStart([queuedThread({ latestUserMessageAt: null })], NOW_MS)).toBe(
      false,
    );
  });

  it("counts a booting provider session as work in progress", () => {
    expect(
      hasStartingManagedSession([
        queuedThread({ latestUserMessageAt: null, sessionStatus: "starting" }),
      ]),
    ).toBe(true);
    expect(
      hasStartingManagedSession([
        queuedThread({ latestUserMessageAt: null, sessionStatus: "ready" }),
      ]),
    ).toBe(false);
    expect(hasStartingManagedSession([queuedThread({ latestUserMessageAt: null })])).toBe(false);
  });

  it("reports human-blocked work as pending, separately from running work", () => {
    expect(hasPendingManagedWork([thread("running", "approval")])).toBe(true);
    expect(hasPendingManagedWork([thread("completed", "input")])).toBe(true);
    expect(hasPendingManagedWork([thread("interrupted", "plan")])).toBe(true);
    expect(hasPendingManagedWork([thread("running")])).toBe(false);
    expect(hasPendingManagedWork([])).toBe(false);
  });

  it("keeps a workspace active for detached Prime subagents, not a resident process", () => {
    const sessionKey = "primeAgent:thread-managed";
    expect(hasRunningPrimeAgentSubagents()).toBe(false);
    updatePrimeAgentSubagentActivity(sessionKey, {
      "ai.primeintellect.prime-agent": {
        subagents: [{ id: "child-1", status: "running" }],
      },
    });
    expect(hasRunningPrimeAgentSubagents()).toBe(true);
    clearPrimeAgentSessionActivity(sessionKey);
    expect(hasRunningPrimeAgentSubagents()).toBe(false);
  });
});

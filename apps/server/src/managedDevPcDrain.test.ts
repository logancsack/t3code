import type { OrchestrationThreadShell } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { managedThreadNeedsTerminalization } from "./managedDevPcDrain.ts";

const NOW_MS = Date.parse("2026-08-16T12:00:00.000Z");

function thread(
  overrides: Partial<{
    latestTurnState: "running" | "completed" | "error" | null;
    latestUserMessageAt: string | null;
    sessionStatus: "starting" | "running" | "ready" | "error" | null;
    activeTurnId: string | null;
  }> = {},
): OrchestrationThreadShell {
  return {
    latestTurn:
      overrides.latestTurnState === undefined || overrides.latestTurnState === null
        ? null
        : ({
            state: overrides.latestTurnState,
            requestedAt: "2026-08-16T11:00:00.000Z",
            startedAt: "2026-08-16T11:00:01.000Z",
            completedAt:
              overrides.latestTurnState === "running" ? null : "2026-08-16T11:01:00.000Z",
          } as never),
    latestUserMessageAt: overrides.latestUserMessageAt ?? null,
    session:
      overrides.sessionStatus === undefined || overrides.sessionStatus === null
        ? null
        : ({
            status: overrides.sessionStatus,
            activeTurnId: overrides.activeTurnId ?? null,
          } as never),
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  } as OrchestrationThreadShell;
}

describe("managed workspace drain", () => {
  it("terminalizes running, starting, and accepted pre-adoption work", () => {
    expect(
      managedThreadNeedsTerminalization(
        thread({ latestTurnState: "running", sessionStatus: "running", activeTurnId: "turn-1" }),
        NOW_MS,
      ),
    ).toBe(true);
    expect(managedThreadNeedsTerminalization(thread({ sessionStatus: "starting" }), NOW_MS)).toBe(
      true,
    );
    expect(
      managedThreadNeedsTerminalization(
        thread({ latestUserMessageAt: "2026-08-16T11:30:00.000Z" }),
        NOW_MS,
      ),
    ).toBe(true);
  });

  it("leaves already terminal and human-idle threads alone", () => {
    expect(
      managedThreadNeedsTerminalization(
        thread({ latestTurnState: "completed", sessionStatus: "ready" }),
        NOW_MS,
      ),
    ).toBe(false);
    expect(
      managedThreadNeedsTerminalization(
        thread({ latestTurnState: "error", sessionStatus: "error" }),
        NOW_MS,
      ),
    ).toBe(false);
  });
});

import type { OrchestrationThreadShell } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { hasRunningManagedTurn } from "./managedDevPcActivity.ts";
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
    hasPendingApprovals: waiting === "approval",
    hasPendingUserInput: waiting === "input",
    hasActionableProposedPlan: waiting === "plan",
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

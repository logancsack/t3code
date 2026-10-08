import { describe, expect, it } from "vite-plus/test";

import { agentHandleProblem, normalizeAgentHandle } from "./agentInbox.logic";

describe("normalizeAgentHandle", () => {
  it("takes the handle out of what's typed", () => {
    expect(normalizeAgentHandle("  Logan ")).toBe("logan");
    expect(normalizeAgentHandle("logan.s@aldomail.com")).toBe("logan.s");
    expect(normalizeAgentHandle("")).toBe("");
  });
});

describe("agentHandleProblem", () => {
  it("accepts a handle of the right shape", () => {
    expect(agentHandleProblem("logan")).toBeNull();
    expect(agentHandleProblem("l.sack-2_x")).toBeNull();
    expect(agentHandleProblem("abc")).toBeNull();
  });

  it("says what's wrong with one that isn't", () => {
    expect(agentHandleProblem("ab")).toMatch(/at least 3/i);
    expect(agentHandleProblem("a".repeat(31))).toMatch(/at most 30/i);
    expect(agentHandleProblem("logan sack")).toMatch(/letters, digits/i);
    expect(agentHandleProblem(".logan")).toMatch(/start and end/i);
    expect(agentHandleProblem("logan-")).toMatch(/start and end/i);
    expect(agentHandleProblem("lo..gan")).toMatch(/in a row/i);
  });
});

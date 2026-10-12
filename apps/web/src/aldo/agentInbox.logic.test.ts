import { describe, expect, it } from "vite-plus/test";

import {
  agentHandleProblem,
  handleFieldValue,
  normalizeAgentHandle,
  normalizeSenderName,
  senderNameProblem,
} from "./agentInbox.logic";

describe("handleFieldValue", () => {
  it("keeps the handle of a pasted address, as typed", () => {
    expect(handleFieldValue("Logan@aldomail.com")).toBe("Logan");
    expect(handleFieldValue("logan.s")).toBe("logan.s");
    expect(handleFieldValue("@aldomail.com")).toBe("");
  });
});

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

describe("normalizeSenderName", () => {
  it("runs spaces and line breaks together", () => {
    expect(normalizeSenderName("  Clipvinci   Studio ")).toBe("Clipvinci Studio");
    expect(normalizeSenderName("Clipvinci\nStudio\t")).toBe("Clipvinci Studio");
    expect(normalizeSenderName("   ")).toBe("");
  });
});

describe("senderNameProblem", () => {
  it("accepts names people use, emoji and accents too", () => {
    expect(senderNameProblem("Logan's agent")).toBeNull();
    expect(senderNameProblem("Clipvinci 🎬")).toBeNull();
    expect(senderNameProblem("Zoë & Co. / Studio")).toBeNull();
    expect(senderNameProblem("x".repeat(64))).toBeNull();
  });

  it("says what's wrong with one that isn't", () => {
    expect(senderNameProblem("")).toMatch(/type a name/i);
    expect(senderNameProblem("x".repeat(65))).toMatch(/at most 64/i);
    for (const name of [
      "Smith, John",
      'The "Best"',
      "support@example.com",
      "Name <x>",
      "a: b",
      "(team)",
    ]) {
      expect(senderNameProblem(name)).toMatch(/leave out/i);
    }
    expect(senderNameProblem("evil\u202eman")).toMatch(/turn text around/i);
    expect(senderNameProblem("a\u0000b")).toMatch(/control/i);
  });
});

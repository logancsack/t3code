import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { ReviewDiffPreviewSource } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { GrokReviewAgent } from "./GrokReviewAgent.ts";
import { type GrokReviewCandidate, type GrokReviewVerification } from "./GrokReviewModel.ts";
import { redactSensitiveDiff } from "./GrokReviewPrivacy.ts";
import { changedLinesFromDiff, runGrokReviewSwarm } from "./GrokReviewSwarm.ts";

const source: ReviewDiffPreviewSource = {
  id: "working-tree",
  kind: "working-tree",
  title: "Dirty worktree",
  baseRef: "HEAD",
  headRef: null,
  diffHash: "diff-hash",
  truncated: false,
  diff: [
    "diff --git a/src/example.ts b/src/example.ts",
    "index 1111111..2222222 100644",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -8,3 +8,4 @@",
    " const before = true;",
    "-const value = safe();",
    "+const value = unsafe();",
    "+const extra = value;",
    " export { value };",
  ].join("\n"),
};

const emptyCandidate = (overrides: Partial<GrokReviewCandidate> = {}): GrokReviewCandidate => ({
  summary: "No issue found in this review area.",
  findings: [],
  coverage: ["Reviewed the supplied diff."],
  limitations: [],
  delegation: null,
  ...overrides,
});

const verifiedFinding = {
  severity: "high" as const,
  confidence: 0.7,
  category: "correctness",
  title: "Unsafe value escapes validation",
  path: "src/example.ts",
  startLine: 9,
  endLine: 9,
  evidence: "The changed line replaces safe() with unsafe().",
  impact: "Invalid state can reach callers.",
  suggestion: "Restore validation before exporting the value.",
  verification: "Exercise the invalid-input path.",
};

describe("changedLinesFromDiff", () => {
  it("indexes only added lines on the new side of each hunk", () => {
    const changed = changedLinesFromDiff(source.diff);
    expect([...changed.get("src/example.ts")!]).toEqual([9, 10]);
  });

  it("preserves legitimate leading a and b directories", () => {
    const changed = changedLinesFromDiff(
      [
        "diff --git a/a/parser.ts b/a/parser.ts",
        "--- a/a/parser.ts",
        "+++ b/a/parser.ts",
        "@@ -1 +1 @@",
        "-const parser = oldParser;",
        "+const parser = newParser;",
      ].join("\n"),
    );
    expect([...changed.get("a/parser.ts")!]).toEqual([1]);
  });

  it("does not count no-newline metadata as a source line", () => {
    const changed = changedLinesFromDiff(
      [
        "diff --git a/src/no-newline.ts b/src/no-newline.ts",
        "--- a/src/no-newline.ts",
        "+++ b/src/no-newline.ts",
        "@@ -1 +1 @@",
        "-export const value = 1;",
        "\\ No newline at end of file",
        "+export const value = 2;",
        "\\ No newline at end of file",
      ].join("\n"),
    );
    expect([...changed.get("src/no-newline.ts")!]).toEqual([1]);
  });

  it("does not mistake added content beginning with pluses for a file header", () => {
    const changed = changedLinesFromDiff(
      [
        "diff --git a/src/notes.txt b/src/notes.txt",
        "--- a/src/notes.txt",
        "+++ b/src/notes.txt",
        "@@ -1 +1,3 @@",
        "-old note",
        "+new note",
        "+++ emphasized note",
        "+last note",
      ].join("\n"),
    );
    expect([...changed.get("src/notes.txt")!]).toEqual([1, 2, 3]);
  });

  it("decodes Git-quoted UTF-8 paths", () => {
    const changed = changedLinesFromDiff(
      [
        'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"',
        '--- "a/caf\\303\\251.ts"',
        '+++ "b/caf\\303\\251.ts"',
        "@@ -1 +1 @@",
        "-export const drink = null;",
        "+export const drink = coffee;",
      ].join("\n"),
    );
    expect([...changed.get("café.ts")!]).toEqual([1]);
  });
});

describe("redactSensitiveDiff", () => {
  it("removes sensitive patch contents while retaining ordinary patches", () => {
    const diff = [
      "diff --git a/.env.production b/.env.production",
      "index 1111111..2222222 100644",
      "--- a/.env.production",
      "+++ b/.env.production",
      "@@ -1 +1 @@",
      "-API_TOKEN=old-secret",
      "+API_TOKEN=new-secret",
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1 +1 @@",
      "-export const value = 1;",
      "+export const value = 2;",
    ].join("\n");

    const redacted = redactSensitiveDiff(diff);
    expect(redacted).not.toContain("old-secret");
    expect(redacted).not.toContain("new-secret");
    expect(redacted).toContain("[Patch content redacted: sensitive path]");
    expect(redacted).toContain("+export const value = 2;");
  });

  it("redacts extensionless SSH key patches", () => {
    const diff = [
      "diff --git a/.ssh/id_ed25519 b/.ssh/id_ed25519",
      "--- a/.ssh/id_ed25519",
      "+++ b/.ssh/id_ed25519",
      "@@ -1 +1 @@",
      "-old-private-key",
      "+new-private-key",
    ].join("\n");

    const redacted = redactSensitiveDiff(diff);
    expect(redacted).not.toContain("old-private-key");
    expect(redacted).not.toContain("new-private-key");
    expect(redacted).toContain("[Patch content redacted: sensitive path]");
  });

  it("redacts direnv and keystore patches", () => {
    for (const path of [".envrc", ".direnv/allow", "certificates/service.p12"]) {
      const diff = [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        "@@ -1 +1 @@",
        "-old-secret",
        "+new-secret",
      ].join("\n");

      const redacted = redactSensitiveDiff(diff);
      expect(redacted).not.toContain("old-secret");
      expect(redacted).not.toContain("new-secret");
      expect(redacted).toContain("[Patch content redacted: sensitive path]");
    }
  });

  it("never retains sensitive hunk lines that resemble diff headers", () => {
    const diff = [
      "diff --git a/.env b/.env",
      "--- a/.env",
      "+++ b/.env",
      "@@ -1 +1 @@",
      "--- API_TOKEN=old-secret",
      "+++ API_TOKEN=new-secret",
    ].join("\n");

    const redacted = redactSensitiveDiff(diff);
    expect(redacted).not.toContain("old-secret");
    expect(redacted).not.toContain("new-secret");
    expect(redacted).toContain("--- a/.env");
    expect(redacted).toContain("+++ b/.env");
  });

  it("does not redact ordinary patches whose added content resembles a header", () => {
    const diff = [
      "diff --git a/src/docs.txt b/src/docs.txt",
      "--- a/src/docs.txt",
      "+++ b/src/docs.txt",
      "@@ -1 +1 @@",
      "-old",
      "+++ .env files must stay private",
    ].join("\n");
    expect(redactSensitiveDiff(diff)).toBe(diff);
  });
});

describe("runGrokReviewSwarm", () => {
  it.effect("uses medium by default and escalates an ambiguous high finding", () => {
    const calls: Array<{ readonly effort: string; readonly prompt: string }> = [];
    const mediumVerification: GrokReviewVerification = {
      summary: "One high-impact finding needs a deeper verification pass.",
      findings: [verifiedFinding],
      coverage: ["Correctness", "Security", "Reliability", "Architecture"],
      limitations: [],
      needsHighEffortReview: true,
      escalationReason: "The changed call's safety contract is ambiguous.",
    };
    const highVerification: GrokReviewVerification = {
      ...mediumVerification,
      summary: "One actionable correctness defect was verified.",
      findings: [{ ...verifiedFinding, confidence: 0.96 }],
      needsHighEffortReview: false,
      escalationReason: null,
    };
    const agent: GrokReviewAgent = {
      resolvedModel: "grok-4.5",
      grokBuildVersion: "0.2.112",
      run: (request) =>
        Effect.sync(() => {
          calls.push({ effort: request.effort, prompt: request.prompt });
          if (request.prompt.includes("high-effort final")) return highVerification as never;
          if (request.prompt.includes("medium-effort verifier")) {
            return mediumVerification as never;
          }
          if (request.prompt.includes("Security and privacy reviewer")) {
            return emptyCandidate({
              delegation: {
                objective: "Verify the safety contract of unsafe().",
                paths: ["src/example.ts"],
              },
            }) as never;
          }
          return emptyCandidate() as never;
        }),
    };

    return Effect.gen(function* () {
      const report = yield* runGrokReviewSwarm({
        request: { cwd: process.cwd(), target: "working-tree" },
        source,
        agent,
      });

      expect(report.reasoningEffort).toBe("medium");
      expect(report.escalatedToHigh).toBe(true);
      expect(report.usage).toEqual({
        agentRuns: 7,
        mediumEffortRuns: 6,
        highEffortRuns: 1,
      });
      expect(calls.filter(({ effort }) => effort === "medium")).toHaveLength(6);
      expect(calls.filter(({ effort }) => effort === "high")).toHaveLength(1);
      expect(report.findings).toHaveLength(1);
      expect(report.findings[0]).toMatchObject({
        severity: "high",
        confidence: 0.96,
        inlineEligible: true,
      });
      expect(report.findings[0]!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(report.markdown).toContain("HIGH: Unsafe value escapes validation");
      expect(report.markdown).toContain("Reasoning:** medium → high");
    }).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("bounds the canonical report for pull-request comment delivery", () => {
    const oversizedFinding = {
      ...verifiedFinding,
      severity: "low" as const,
      confidence: 0.95,
      category: "c".repeat(300),
      title: "t".repeat(500),
      path: `src/${"p".repeat(700)}.ts`,
      evidence: "e".repeat(1_000),
      impact: "i".repeat(1_000),
      suggestion: "s".repeat(1_000),
      verification: "v".repeat(1_000),
    };
    const verification: GrokReviewVerification = {
      summary: "summary ".repeat(1_000),
      findings: Array.from({ length: 30 }, (_, index) => ({
        ...oversizedFinding,
        startLine: 9 + index,
        endLine: 9 + index,
        title: `${index}-${oversizedFinding.title}`,
      })),
      coverage: Array.from({ length: 20 }, (_, index) => `${index}-${"c".repeat(500)}`),
      limitations: Array.from({ length: 20 }, (_, index) => `${index}-${"l".repeat(500)}`),
      needsHighEffortReview: false,
      escalationReason: null,
    };
    const agent: GrokReviewAgent = {
      resolvedModel: "grok-4.5",
      grokBuildVersion: "0.2.112",
      run: (request) =>
        Effect.succeed(
          (request.prompt.includes("medium-effort verifier")
            ? verification
            : emptyCandidate()) as never,
        ),
    };

    return Effect.gen(function* () {
      const report = yield* runGrokReviewSwarm({
        request: { cwd: process.cwd(), target: "working-tree" },
        source,
        agent,
      });

      expect(report.findings).toHaveLength(20);
      expect(report.coverage).toHaveLength(8);
      expect(report.limitations.length).toBeLessThanOrEqual(8);
      expect(report.summary.length).toBeLessThanOrEqual(2_000);
      expect(report.markdown.length).toBeLessThan(60_000);
    }).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("preserves leading directory names on verified findings", () => {
    const nestedSource: ReviewDiffPreviewSource = {
      ...source,
      diff: [
        "diff --git a/a/parser.ts b/a/parser.ts",
        "--- a/a/parser.ts",
        "+++ b/a/parser.ts",
        "@@ -1 +1 @@",
        "-const parser = oldParser;",
        "+const parser = newParser;",
      ].join("\n"),
    };
    const finding = {
      ...verifiedFinding,
      confidence: 0.95,
      path: "a/parser.ts",
      startLine: 1,
      endLine: 1,
    };
    const verification: GrokReviewVerification = {
      summary: "One finding.",
      findings: [finding],
      coverage: ["Correctness"],
      limitations: [],
      needsHighEffortReview: false,
      escalationReason: null,
    };
    const agent: GrokReviewAgent = {
      resolvedModel: "grok-4.5",
      grokBuildVersion: "0.2.112",
      run: (request) =>
        Effect.succeed(
          (request.prompt.includes("medium-effort verifier")
            ? verification
            : emptyCandidate()) as never,
        ),
    };

    return Effect.gen(function* () {
      const report = yield* runGrokReviewSwarm({
        request: { cwd: process.cwd(), target: "working-tree" },
        source: nestedSource,
        agent,
      });
      expect(report.findings[0]).toMatchObject({
        path: "a/parser.ts",
        inlineEligible: true,
      });
    }).pipe(Effect.provide(NodeServices.layer));
  });
});

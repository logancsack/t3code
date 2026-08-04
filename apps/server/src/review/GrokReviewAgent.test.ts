// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { GrokSettings } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { makeGrokReviewAgent } from "./GrokReviewAgent.ts";

const Output = Schema.Struct({ ok: Schema.Boolean });
const decodeGrokSettings = Schema.decodeSync(GrokSettings);

/**
 * Writes a fake `grok` that records every invocation and fails the first
 * `failures` attempts the way Grok Build actually fails: a `structuredOutputError`
 * envelope plus a nonzero exit.
 */
function writeCountingGrok(
  directory: string,
  options: { readonly failures: number; readonly attemptsLog: string },
): string {
  const executable = NodePath.join(directory, "fake-grok");
  NodeFS.writeFileSync(
    executable,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then exit 0; fi',
      `printf "x\\n" >> ${JSON.stringify(options.attemptsLog)}`,
      `count=$(wc -l < ${JSON.stringify(options.attemptsLog)})`,
      `if [ "$count" -le ${options.failures} ]; then`,
      `  printf "%s\\n" '{"structuredOutputError":"severity must be one of the allowed values"}'`,
      "  exit 1",
      "fi",
      `printf "%s\\n" '{"structuredOutput":{"ok":true}}'`,
    ].join("\n"),
    "utf8",
  );
  NodeFS.chmodSync(executable, 0o755);
  return executable;
}

const countAttempts = (attemptsLog: string): number =>
  NodeFS.existsSync(attemptsLog)
    ? NodeFS.readFileSync(attemptsLog, "utf8").trim().split("\n").filter(Boolean).length
    : 0;

it.effect("runs Grok headlessly with medium effort and strict untrusted-code boundaries", () =>
  Effect.gen(function* () {
    const tempDirectory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "grok-review-agent-"));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => NodeFS.rmSync(tempDirectory, { recursive: true, force: true })),
    );
    const executable = NodePath.join(tempDirectory, "fake-grok");
    const argsLog = NodePath.join(tempDirectory, "args.log");
    const promptLog = NodePath.join(tempDirectory, "prompt.log");
    NodeFS.writeFileSync(
      executable,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then',
        '  printf "%s\\n" "grok 0.2.112"',
        "  exit 0",
        "fi",
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        `: > ${JSON.stringify(argsLog)}`,
        'previous=""',
        'for argument in "$@"; do',
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        `  printf "%s\\n" "$argument" >> ${JSON.stringify(argsLog)}`,
        '  if [ "$previous" = "--prompt-file" ]; then',
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        `    cp "$argument" ${JSON.stringify(promptLog)}`,
        "  fi",
        '  previous="$argument"',
        "done",
        `printf "%s\\n" '{"text":"","stopReason":"end_turn","sessionId":"test","requestId":"test","structuredOutput":{"ok":true}}'`,
      ].join("\n"),
      "utf8",
    );
    NodeFS.chmodSync(executable, 0o755);

    const agent = yield* makeGrokReviewAgent(decodeGrokSettings({ binaryPath: executable }));
    const result = yield* agent.run({
      cwd: process.cwd(),
      prompt: "Review this exact diff.",
      outputSchema: Output,
      effort: "medium",
      allowTools: true,
    });

    expect(result).toEqual({ ok: true });
    expect(agent.resolvedModel).toBe("grok-4.5");
    expect(agent.grokBuildVersion).toBe("0.2.112");
    expect(NodeFS.readFileSync(promptLog, "utf8")).toBe("Review this exact diff.");
    const args = NodeFS.readFileSync(argsLog, "utf8").trim().split("\n");
    expect(args).toContain("--reasoning-effort");
    expect(args[args.indexOf("--reasoning-effort") + 1]).toBe("medium");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("12");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("strict");
    expect(args[args.indexOf("--tools") + 1]).toBe("read_file,list_dir,grep");
    expect(args).toContain("Read(**/.grok/**)");
    expect(args).toContain("Read(**/.env)");
    expect(args).toContain("--no-subagents");
    expect(args).toContain("--disable-web-search");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("recovers a reviewer when Grok Build fails structured output before succeeding", () =>
  Effect.gen(function* () {
    const tempDirectory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "grok-review-agent-"));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => NodeFS.rmSync(tempDirectory, { recursive: true, force: true })),
    );
    const attemptsLog = NodePath.join(tempDirectory, "attempts.log");
    const executable = writeCountingGrok(tempDirectory, { failures: 2, attemptsLog });

    const agent = yield* makeGrokReviewAgent(decodeGrokSettings({ binaryPath: executable }));
    const result = yield* agent.run({
      cwd: process.cwd(),
      prompt: "Review this exact diff.",
      outputSchema: Output,
      effort: "medium",
    });

    expect(result).toEqual({ ok: true });
    expect(countAttempts(attemptsLog)).toBe(3);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), TestClock.withLive),
);

it.effect("preserves Grok structured-output diagnostics after exhausting every attempt", () =>
  Effect.gen(function* () {
    const tempDirectory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "grok-review-agent-"));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => NodeFS.rmSync(tempDirectory, { recursive: true, force: true })),
    );
    const attemptsLog = NodePath.join(tempDirectory, "attempts.log");
    const executable = writeCountingGrok(tempDirectory, { failures: 99, attemptsLog });

    const agent = yield* makeGrokReviewAgent(decodeGrokSettings({ binaryPath: executable }));
    const result = yield* agent
      .run({
        cwd: process.cwd(),
        prompt: "Review this exact diff.",
        outputSchema: Output,
        effort: "medium",
      })
      .pipe(Effect.result);

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure.operation).toBe("GrokReviewAgent.decode");
      expect(result.failure.message).toContain("required structured review output");
      expect(result.failure.message).toContain("after 3 attempts");
    }
    expect(countAttempts(attemptsLog)).toBe(3);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), TestClock.withLive),
);

it.effect("stops retrying rather than overrunning the caller's deadline", () =>
  Effect.gen(function* () {
    const tempDirectory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "grok-review-agent-"));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => NodeFS.rmSync(tempDirectory, { recursive: true, force: true })),
    );
    const attemptsLog = NodePath.join(tempDirectory, "attempts.log");
    const executable = writeCountingGrok(tempDirectory, { failures: 99, attemptsLog });

    const agent = yield* makeGrokReviewAgent(decodeGrokSettings({ binaryPath: executable }));
    const now = yield* Clock.currentTimeMillis;
    const result = yield* agent
      .run({
        cwd: process.cwd(),
        prompt: "Review this exact diff.",
        outputSchema: Output,
        effort: "medium",
        // Below the minimum useful attempt window, so no attempt may start.
        deadline: now + 1_000,
      })
      .pipe(Effect.result);

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure.message).toContain("budget was exhausted");
    }
    expect(countAttempts(attemptsLog)).toBe(0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), TestClock.withLive),
);

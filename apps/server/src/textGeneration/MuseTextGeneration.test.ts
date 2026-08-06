import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { MuseSettings, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as TextGeneration from "./TextGeneration.ts";
import { makeMuseTextGeneration, parseMuseHeadlessOutput } from "./MuseTextGeneration.ts";

const decodeMuseSettings = Schema.decodeSync(MuseSettings);

function museEvent(payloadType: string, payload: Record<string, unknown>, sequence = 1): string {
  return JSON.stringify({
    schema_version: 1,
    id: `event-${sequence}`,
    stream: { kind: "session", id: "text-generation-session" },
    sequence,
    recorded_at: 1_780_531_400_000_000 + sequence,
    record_type: "event",
    durability: "durable",
    payload_type: payloadType,
    payload_schema_version: 1,
    payload,
  });
}

function museTerminalEvent(text: string, terminal = "completed"): string {
  return museEvent(`run.terminal.${terminal}`, {
    kind: "run_terminal",
    terminal,
    text,
  });
}

function makeFakeMuseBinary(directory: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binaryPath = path.join(directory, "muse");
    yield* fs.writeFileString(
      binaryPath,
      [
        "#!/bin/sh",
        '[ "$MUSE_NO_AUTO_UPDATE" = "1" ] || { printf "%s\\n" "auto update enabled" >&2; exit 8; }',
        ': > "$T3_FAKE_MUSE_ARGS_FILE"',
        'for arg in "$@"; do',
        '  printf "%s\\0" "$arg" >> "$T3_FAKE_MUSE_ARGS_FILE"',
        "done",
        'while [ "$#" -gt 0 ]; do',
        '  if [ "$1" = "--prompt-file" ]; then',
        "    shift",
        '    cp "$1" "$T3_FAKE_MUSE_PROMPT_FILE"',
        "    break",
        "  fi",
        "  shift",
        "done",
        'if [ -n "$T3_FAKE_MUSE_STDERR" ]; then printf "%s\\n" "$T3_FAKE_MUSE_STDERR" >&2; fi',
        'printf "%s" "$T3_FAKE_MUSE_OUTPUT"',
        'exit "${T3_FAKE_MUSE_EXIT_CODE:-0}"',
        "",
      ].join("\n"),
    );
    yield* fs.chmod(binaryPath, 0o755);
    return binaryPath;
  });
}

function withFakeMuse<A, E, R>(
  input: {
    readonly output: string;
    readonly launchArgs?: string;
    readonly exitCode?: number;
    readonly stderr?: string;
  },
  use: (
    textGeneration: TextGeneration.TextGeneration["Service"],
    capture: { readonly argsFile: string; readonly promptFile: string },
  ) => Effect.Effect<A, E, R>,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-muse-text-" });
      const binaryPath = yield* makeFakeMuseBinary(directory);
      const argsFile = path.join(directory, "args");
      const promptFile = path.join(directory, "prompt");
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        T3_FAKE_MUSE_ARGS_FILE: argsFile,
        T3_FAKE_MUSE_PROMPT_FILE: promptFile,
        T3_FAKE_MUSE_OUTPUT: input.output,
        ...(input.exitCode === undefined ? {} : { T3_FAKE_MUSE_EXIT_CODE: String(input.exitCode) }),
        ...(input.stderr === undefined ? {} : { T3_FAKE_MUSE_STDERR: input.stderr }),
      };
      const textGeneration = yield* makeMuseTextGeneration(
        decodeMuseSettings({ binaryPath, launchArgs: input.launchArgs ?? "" }),
        environment,
      );
      return yield* use(textGeneration, { argsFile, promptFile });
    }),
  );
}

it("parses terminal output and falls back to output deltas", () => {
  expect(
    parseMuseHeadlessOutput(
      [
        "not-json",
        museEvent("run.output.delta", { text: "first " }, 1),
        museEvent("run.output.delta", { text: "second" }, 2),
      ].join("\n"),
    ),
  ).toEqual({ terminal: null, text: "first second" });
});

it.layer(NodeServices.layer)("MuseTextGeneration", (it) => {
  it.effect("uses headless safe mode with the requested model and reasoning effort", () =>
    withFakeMuse(
      {
        output: museTerminalEvent(
          `Here is the result:\n${JSON.stringify({ title: "Add Muse provider support" })}`,
        ),
        launchArgs: [
          "--max-model-steps 4",
          "--yolo",
          "--disable-sandbox",
          "--worktree create",
          "--base-url https://example.invalid",
          "--provider echo",
          "--prompt-file /tmp/unmanaged-prompt",
        ].join(" "),
      },
      (textGeneration, capture) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateThreadTitle({
            cwd: process.cwd(),
            message: "Please add Meta Muse Code as a first-class provider.",
            modelSelection: createModelSelection(
              ProviderInstanceId.make("muse"),
              "muse-spark-1.2",
              [{ id: "reasoningEffort", value: "xhigh" }],
            ),
          });
          expect(generated.title).toBe("Add Muse provider support");

          const fs = yield* FileSystem.FileSystem;
          const args = (yield* fs.readFileString(capture.argsFile)).split("\0").filter(Boolean);
          expect(args[0]).toBe("exec");
          expect(args).toContain("--max-model-steps");
          expect(args).toContain("4");
          expect(args).not.toContain("--yolo");
          expect(args).not.toContain("--disable-sandbox");
          expect(args).not.toContain("--worktree");
          expect(args).not.toContain("--base-url");
          expect(args).toContain("--json");
          expect(args.slice(args.indexOf("--provider"), args.indexOf("--provider") + 2)).toEqual([
            "--provider",
            "meta",
          ]);
          expect(args).toContain("--disable-approval");
          expect(args).toContain("--disable-write");
          expect(args).toContain("--disable-shell");
          expect(args).toContain("--disable-web-tools");
          expect(args).toContain("--no-session-log");
          expect(args).toContain("--prompt-file");
          expect(args.filter((arg) => arg === "--provider")).toHaveLength(1);
          expect(args.filter((arg) => arg === "--prompt-file")).toHaveLength(1);
          expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual([
            "--model",
            "muse-spark-1.2",
          ]);
          expect(
            args.slice(args.indexOf("--reasoning-effort"), args.indexOf("--reasoning-effort") + 2),
          ).toEqual(["--reasoning-effort", "xhigh"]);
          const prompt = yield* fs.readFileString(capture.promptFile);
          expect(prompt).toContain("<output_schema>");
          expect(prompt).toContain("You write concise thread titles");
        }),
    ),
  );

  it.effect("uses high reasoning by default and decodes arbitrary structured output", () =>
    withFakeMuse(
      {
        output: museTerminalEvent(JSON.stringify({ approved: true })),
      },
      (textGeneration, capture) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateStructured({
            cwd: process.cwd(),
            prompt: "Decide whether this change is ready.",
            outputSchema: Schema.Struct({ approved: Schema.Boolean }),
            modelSelection: createModelSelection(ProviderInstanceId.make("muse"), "muse-spark-1.2"),
          });
          expect(generated).toEqual({ approved: true });

          const fs = yield* FileSystem.FileSystem;
          const args = (yield* fs.readFileString(capture.argsFile)).split("\0").filter(Boolean);
          expect(
            args.slice(args.indexOf("--reasoning-effort"), args.indexOf("--reasoning-effort") + 2),
          ).toEqual(["--reasoning-effort", "high"]);
        }),
    ),
  );

  it.effect("does not expose provider stderr when the command fails", () =>
    withFakeMuse(
      {
        output: "",
        exitCode: 7,
        stderr: "META_API_KEY=secret-value-that-must-not-leak",
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            textGeneration.generateBranchName({
              cwd: process.cwd(),
              message: "Add Muse",
              modelSelection: createModelSelection(
                ProviderInstanceId.make("muse"),
                "muse-spark-1.2",
              ),
            }),
          );
          expect(error._tag).toBe("TextGenerationError");
          expect(error.detail).toContain("code 7");
          expect(error.detail).not.toContain("secret-value");
        }),
    ),
  );

  it.effect("rejects malformed structured output", () =>
    withFakeMuse({ output: museTerminalEvent("not json") }, (textGeneration) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          textGeneration.generateThreadTitle({
            cwd: process.cwd(),
            message: "Name this thread",
            modelSelection: createModelSelection(ProviderInstanceId.make("muse"), "muse-spark-1.2"),
          }),
        );
        expect(error._tag).toBe("TextGenerationError");
        expect(error.detail).toContain("invalid structured output");
      }),
    ),
  );
});

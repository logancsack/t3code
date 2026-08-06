import { TextGenerationError, type ModelSelection, type MuseSettings } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  makeMuseEnvironment,
  resolveMuseReasoningEffort,
} from "../provider/Layers/MuseProvider.ts";
import {
  filterMuseLaunchArgs,
  museOutputDelta,
  museTerminalRecord,
  parseMuseJsonLine,
} from "../provider/Layers/MuseProtocol.ts";
import { spawnAndCollect } from "../provider/providerSnapshot.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  normalizeCliError,
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  withStructuredOutputSchemaPrompt,
} from "./TextGenerationUtils.ts";

const MUSE_TIMEOUT_MS = 180_000;
const MUSE_MAX_EVENT_OUTPUT_BYTES = 8 * 1024 * 1024;
const isTextGenerationError = Schema.is(TextGenerationError);

export interface MuseHeadlessOutput {
  readonly text: string;
  readonly terminal: string | null;
}

/** Extract the final response from Muse's versioned JSONL event stream. */
export function parseMuseHeadlessOutput(stdout: string): MuseHeadlessOutput {
  let deltaText = "";
  let terminal: string | null = null;
  let terminalText = "";

  for (const line of stdout.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parsed = parseMuseJsonLine(trimmed);
    if (parsed.kind !== "event") {
      continue;
    }
    const delta = museOutputDelta(parsed.event);
    if (delta !== undefined) {
      deltaText += delta;
    }
    const terminalRecord = museTerminalRecord(parsed.event);
    if (terminalRecord) {
      terminal = terminalRecord.terminal;
      terminalText = terminalRecord.text ?? "";
    }
  }

  return {
    terminal,
    text: (terminalText || deltaText).trim(),
  };
}

export const makeMuseTextGeneration = Effect.fn("makeMuseTextGeneration")(function* (
  museSettings: MuseSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const resolvedEnvironment = makeMuseEnvironment(environment);

  const runMuseJson = <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle"
      | "generateStructured";
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ModelSelection;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const command = museSettings.binaryPath || "muse";
      const reasoningEffort = resolveMuseReasoningEffort(
        getModelSelectionStringOptionValue(modelSelection, "reasoningEffort"),
      );
      const launchArgs = filterMuseLaunchArgs(museSettings.launchArgs);
      const promptFile = yield* fileSystem.makeTempFileScoped({
        prefix: "t3-muse-text-generation-",
        suffix: ".md",
      });
      yield* fileSystem.writeFileString(
        promptFile,
        withStructuredOutputSchemaPrompt(prompt, outputSchemaJson),
      );
      const spawnCommand = yield* resolveSpawnCommand(
        command,
        [
          "exec",
          ...launchArgs,
          "--json",
          "--provider",
          "meta",
          "--model",
          modelSelection.model,
          "--reasoning-effort",
          reasoningEffort,
          "--workspace",
          cwd,
          "--disable-approval",
          "--disable-write",
          "--disable-shell",
          ...(launchArgs.includes("--disable-web-tools") ? [] : ["--disable-web-tools"]),
          ...(launchArgs.includes("--no-foreign-personal-context")
            ? []
            : ["--no-foreign-personal-context"]),
          "--no-session-log",
          "--prompt-file",
          promptFile,
        ],
        { env: resolvedEnvironment },
      );
      const childCommand = ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: resolvedEnvironment,
        cwd,
        shell: spawnCommand.shell,
      });

      const result = yield* spawnAndCollect(command, childCommand, {
        maxOutputBytes: MUSE_MAX_EVENT_OUTPUT_BYTES,
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, commandSpawner),
        Effect.mapError((cause) =>
          normalizeCliError("muse", operation, cause, "Failed to run Muse Code."),
        ),
        Effect.timeoutOption(MUSE_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({
                  operation,
                  detail: "Muse Code request timed out.",
                }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );

      if (result.code !== 0) {
        return yield* new TextGenerationError({
          operation,
          detail: `Muse Code command failed with code ${result.code}.`,
        });
      }
      if (result.stdoutTruncated) {
        return yield* new TextGenerationError({
          operation,
          detail: "Muse Code returned more event data than T3 Code can safely process.",
        });
      }

      const output = parseMuseHeadlessOutput(result.stdout);
      if (output.terminal !== "completed") {
        return yield* new TextGenerationError({
          operation,
          detail:
            output.terminal === null
              ? "Muse Code returned no terminal event."
              : `Muse Code request ended with status '${output.terminal}'.`,
        });
      }
      if (!output.text) {
        return yield* new TextGenerationError({
          operation,
          detail: "Muse Code returned empty output.",
        });
      }

      const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson));
      return yield* decodeOutput(extractJsonObject(output.text)).pipe(
        Effect.catchTags({
          SchemaError: (cause) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "Muse Code returned invalid structured output.",
                cause,
              }),
            ),
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : normalizeCliError("muse", operation, cause, "Failed to run Muse Code."),
      ),
      Effect.scoped,
    );

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("MuseTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
      });
      const generated = yield* runMuseJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("MuseTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
      });
      const generated = yield* runMuseJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return {
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("MuseTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runMuseJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("MuseTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runMuseJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizeThreadTitle(generated.title) };
    });

  const generateStructured: TextGeneration.TextGeneration["Service"]["generateStructured"] =
    Effect.fn("MuseTextGeneration.generateStructured")(function* (input) {
      return yield* runMuseJson({
        operation: "generateStructured",
        cwd: input.cwd,
        prompt: input.prompt,
        outputSchemaJson: input.outputSchema,
        modelSelection: input.modelSelection,
      });
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
    generateStructured,
  } satisfies TextGeneration.TextGeneration["Service"];
});

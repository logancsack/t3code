import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import { type PrimeSettings, type ModelSelection } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";

import { TextGenerationError } from "@t3tools/contracts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  withStructuredOutputSchemaPrompt,
} from "./TextGenerationUtils.ts";
import { makePrimeAcpRuntime, parsePrimeModelSlug } from "../provider/acp/PrimeAcpSupport.ts";

const PRIME_TIMEOUT_MS = 180_000;

const isTextGenerationError = Schema.is(TextGenerationError);

/**
 * Build a Prime text-generation closure bound to a specific `PrimeSettings`
 * payload. See `makeCodexAdapter` for the overall per-instance rationale.
 */
export const makePrimeTextGeneration = Effect.fn("makePrimeTextGeneration")(function* (
  primeSettings: PrimeSettings,
  environment?: NodeJS.ProcessEnv,
) {
  const crypto = yield* Crypto.Crypto;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const resolvedEnvironment = environment ?? process.env;

  const runPrimeJson = <S extends Schema.Top>({
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
      if (modelSelection.model !== "auto" && !parsePrimeModelSlug(modelSelection.model)) {
        return yield* new TextGenerationError({
          operation,
          detail: "Prime Agent models must use a provider/model slug.",
        });
      }
      const outputRef = yield* Ref.make("");
      const runtime = yield* makePrimeAcpRuntime({
        primeSettings,
        environment: resolvedEnvironment,
        childProcessSpawner: commandSpawner,
        cwd,
        model: modelSelection.model,
        executionProfile: "text-generation",
        clientInfo: { name: "t3-code-git-text", version: "0.0.0" },
      }).pipe(Effect.provideService(Crypto.Crypto, crypto));

      yield* runtime.handleSessionUpdate((notification) => {
        const update = notification.update;
        if (update.sessionUpdate !== "agent_message_chunk") {
          return Effect.void;
        }
        const content = update.content;
        if (content.type !== "text") {
          return Effect.void;
        }
        return Ref.update(outputRef, (current) => current + content.text);
      });

      const promptResult = yield* Effect.gen(function* () {
        yield* runtime.start();
        return yield* runtime.prompt({
          prompt: [{ type: "text", text: prompt }],
        });
      }).pipe(
        Effect.timeoutOption(PRIME_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({
                  operation,
                  detail: "Prime Agent request timed out.",
                }),
              ),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
        Effect.mapError((cause) =>
          isTextGenerationError(cause)
            ? cause
            : new TextGenerationError({
                operation,
                detail: "Prime ACP request failed.",
                cause,
              }),
        ),
      );

      const rawResult = (yield* Ref.get(outputRef)).trim();
      if (!rawResult) {
        return yield* new TextGenerationError({
          operation,
          detail:
            promptResult.stopReason === "cancelled"
              ? "Prime ACP request was cancelled."
              : "Prime Agent returned empty output.",
        });
      }

      const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson));
      return yield* decodeOutput(extractJsonObject(rawResult)).pipe(
        Effect.catchTags({
          SchemaError: (cause) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "Prime Agent returned invalid structured output.",
                cause,
              }),
            ),
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation,
              detail: "Prime ACP text generation failed.",
              cause,
            }),
      ),
      Effect.scoped,
    );

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("PrimeTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
      });

      const generated = yield* runPrimeJson({
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
    Effect.fn("PrimeTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
      });

      const generated = yield* runPrimeJson({
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
    Effect.fn("PrimeTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });

      const generated = yield* runPrimeJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        branch: sanitizeBranchFragment(generated.branch),
      };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("PrimeTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        attachments: input.attachments,
      });

      const generated = yield* runPrimeJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizeThreadTitle(generated.title),
      } satisfies TextGeneration.ThreadTitleGenerationResult;
    });

  const generateStructured: TextGeneration.TextGeneration["Service"]["generateStructured"] =
    Effect.fn("PrimeTextGeneration.generateStructured")(function* (input) {
      return yield* runPrimeJson({
        operation: "generateStructured",
        cwd: input.cwd,
        prompt: withStructuredOutputSchemaPrompt(input.prompt, input.outputSchema),
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

import type { ModelSelection, ProviderDriverKind } from "@t3tools/contracts";
import { GrokReviewError } from "@t3tools/contracts";
import type { CodeReviewRunner } from "@t3tools/provider-core/server/codeReview";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as Schema from "effect/Schema";

import type { GrokReviewAgent } from "./GrokReviewAgent.ts";
import { runGrokReviewSwarm } from "./GrokReviewSwarm.ts";

const CODEX_DRIVER = "codex";
const CLAUDE_DRIVER = "claudeAgent";
function selectionForEffort(
  base: ModelSelection,
  driver: ProviderDriverKind,
  effort: "medium" | "high",
): ModelSelection {
  const effortOption =
    driver === CODEX_DRIVER
      ? { id: "reasoningEffort", value: effort }
      : driver === CLAUDE_DRIVER
        ? { id: "effort", value: effort }
        : undefined;
  if (!effortOption) return base;
  return {
    ...base,
    options: [
      ...(base.options ?? []).filter((option) => option.id !== effortOption.id),
      effortOption,
    ],
  };
}

export type ProviderCodeReviewServices =
  | Digest.Digest
  | SecureRandom.SecureRandom
  | FileSystem.FileSystem;

export function makeProviderCodeReview(input: {
  generateStructured: NonNullable<ProviderTextGeneration["generateStructured"]>;
  modelSelection: ModelSelection;
  driver: ProviderDriverKind;
  providerLabel: string;
  services: Context.Context<ProviderCodeReviewServices>;
}): CodeReviewRunner {
  const agent: GrokReviewAgent = {
    resolvedModel: input.modelSelection.model,
    grokBuildVersion: null,
    supportsHighEffort: input.driver === CODEX_DRIVER || input.driver === CLAUDE_DRIVER,
    run: <S extends Schema.Top>(request: {
      readonly cwd: string;
      readonly prompt: string;
      readonly outputSchema: S;
      readonly effort: "medium" | "high";
    }) =>
      input
        .generateStructured({
          cwd: request.cwd,
          prompt: request.prompt,
          outputSchema: request.outputSchema,
          modelSelection: selectionForEffort(input.modelSelection, input.driver, request.effort),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new GrokReviewError({
                operation: "AldoReviewAgent.run",
                detail: `${input.providerLabel} could not produce a structured review result.`,
                cause,
              }),
          ),
        ),
  };
  const run: CodeReviewRunner["run"] = Effect.fn("ProviderCodeReview.run")(
    function* (request) {
      const fileSystem = yield* FileSystem.FileSystem;
      // The provider sees only the redacted diff in its prompt, never the checkout.
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-aldo-review-" }).pipe(
        Effect.mapError(
          (cause) =>
            new GrokReviewError({
              operation: "AldoReviewAgent.isolate",
              detail: "Aldo Review could not create an isolated provider workspace.",
              cause,
            }),
        ),
      );
      return yield* runGrokReviewSwarm({
        ...request,
        request: { ...request.request, cwd },
        agent,
      });
    },
    Effect.scoped,
    Effect.provide(input.services),
  );
  return { run };
}

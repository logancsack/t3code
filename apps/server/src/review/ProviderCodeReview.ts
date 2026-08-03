// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { ModelSelection, ProviderDriverKind } from "@t3tools/contracts";
import { GrokReviewError } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { TextGeneration } from "../textGeneration/TextGeneration.ts";
import type { CodeReviewRunner } from "./CodeReviewRunner.ts";
import type { GrokReviewAgent } from "./GrokReviewAgent.ts";
import { runGrokReviewSwarm } from "./GrokReviewSwarm.ts";

const CODEX_DRIVER = "codex";
const CLAUDE_DRIVER = "claudeAgent";
const nodeCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(NodeCrypto.randomBytes(size)),
  digest: (algorithm, data) =>
    Effect.sync(
      () =>
        new Uint8Array(
          NodeCrypto.createHash(algorithm.toLowerCase().replace("-", "")).update(data).digest(),
        ),
    ),
});

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

export function makeProviderReviewAgent(input: {
  textGeneration: TextGeneration["Service"];
  modelSelection: ModelSelection;
  driver: ProviderDriverKind;
  providerLabel: string;
}): GrokReviewAgent {
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
      input.textGeneration
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
  return agent;
}

export function makeProviderCodeReview(input: {
  textGeneration: TextGeneration["Service"];
  modelSelection: ModelSelection;
  driver: ProviderDriverKind;
  providerLabel: string;
}): CodeReviewRunner {
  const agent = makeProviderReviewAgent(input);
  const makeIsolatedReviewDirectory = Effect.try({
    try: () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-aldo-review-")),
    catch: (cause) =>
      new GrokReviewError({
        operation: "AldoReviewAgent.isolate",
        detail: "Aldo Review could not create an isolated provider workspace.",
        cause,
      }),
  });
  return {
    run: (request) =>
      Effect.acquireUseRelease(
        makeIsolatedReviewDirectory,
        (cwd) =>
          runGrokReviewSwarm({
            ...request,
            request: { ...request.request, cwd },
            agent,
          }).pipe(Effect.provideService(Crypto.Crypto, nodeCrypto)),
        (cwd) => Effect.sync(() => NodeFS.rmSync(cwd, { recursive: true, force: true })),
      ),
  } satisfies CodeReviewRunner;
}

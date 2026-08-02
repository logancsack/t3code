import {
  GrokReviewError,
  type GrokReviewInput,
  type GrokReviewReport,
  type GrokReviewRunError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import * as ReviewService from "./ReviewService.ts";
import { makeProviderCodeReview, makeProviderReviewAgent } from "./ProviderCodeReview.ts";

const GROK_DRIVER_KIND = "grok";
const DEFAULT_GROK_REVIEW_MODEL = "grok-4.5";
const OPENCODE_DRIVER_KIND = "opencode";
const PREFERRED_OPEN_WEIGHT_REVIEW_MODELS = [
  "opencode/nemotron-3-ultra",
  "opencode/nemotron-3-ultra-free",
] as const;
const GROK_REVIEW_TIMEOUT_MS = 10 * 60 * 1_000;

export function selectOpenWeightReviewModel(
  models: ReadonlyArray<{ readonly slug: string }>,
): string | undefined {
  return (
    PREFERRED_OPEN_WEIGHT_REVIEW_MODELS.find((slug) =>
      models.some((model) => model.slug === slug),
    ) ?? models.find((model) => /^opencode\/nemotron-3-ultra(?:-|$)/.test(model.slug))?.slug
  );
}

export class GrokReviewService extends Context.Service<
  GrokReviewService,
  {
    readonly run: (input: GrokReviewInput) => Effect.Effect<GrokReviewReport, GrokReviewRunError>;
  }
>()("t3/review/GrokReviewService") {}

export const make = Effect.gen(function* () {
  const review = yield* ReviewService.ReviewService;
  const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;

  const run: GrokReviewService["Service"]["run"] = Effect.fn("GrokReviewService.run")(
    function* (input) {
      const preview = yield* review.getDiffPreview({
        cwd: input.cwd,
        ...(input.baseRef ? { baseRef: input.baseRef } : {}),
      });
      const preferredTarget =
        input.target ??
        (preview.sources.some(
          (source) => source.kind === "working-tree" && source.diff.trim().length > 0,
        )
          ? "working-tree"
          : "branch-range");
      const source = preview.sources.find((candidate) => candidate.kind === preferredTarget);
      if (!source || source.diff.trim().length === 0) {
        return yield* new GrokReviewError({
          operation: "AldoReviewService.run",
          detail: `There are no ${preferredTarget} changes to review.`,
        });
      }

      const requestedInstanceId = input.providerInstanceId ?? input.grokProviderInstanceId;
      const requestedSupplementalInstanceId = input.supplementalProviderInstanceId;
      const requestedInstance = requestedInstanceId
        ? yield* providerInstances.getInstance(requestedInstanceId)
        : undefined;
      const requestedSupplementalInstance = requestedSupplementalInstanceId
        ? yield* providerInstances.getInstance(requestedSupplementalInstanceId)
        : undefined;
      const listedInstances = (yield* providerInstances.listInstances).filter(
        (candidate) => candidate.enabled,
      );
      const instances = requestedInstanceId
        ? [requestedInstance, requestedSupplementalInstance].filter(
            (candidate, index, selected): candidate is NonNullable<typeof candidate> =>
              candidate !== undefined &&
              selected.findIndex((entry) => entry?.instanceId === candidate.instanceId) === index,
          )
        : listedInstances;
      const candidates = yield* Effect.forEach(
        instances,
        (candidate) =>
          candidate.snapshot.getSnapshot.pipe(
            Effect.map((snapshot) => ({ instance: candidate, snapshot })),
          ),
        { concurrency: "unbounded" },
      );
      const readyCandidate = ({ snapshot, instance }: (typeof candidates)[number]) =>
        snapshot.installed &&
        snapshot.status === "ready" &&
        snapshot.auth.status === "authenticated" &&
        ((snapshot.models?.length ?? 0) > 0 ||
          (instance.driverKind === GROK_DRIVER_KIND && instance.codeReview !== undefined));
      const selected = requestedInstanceId
        ? candidates.find(({ instance }) => instance.instanceId === requestedInstanceId)
        : (candidates.find(
            (candidate) =>
              candidate.instance.driverKind === GROK_DRIVER_KIND && readyCandidate(candidate),
          ) ?? candidates.find((candidate) => readyCandidate(candidate)));
      if (
        !selected ||
        !selected.instance.enabled ||
        !selected.snapshot.installed ||
        selected.snapshot.status !== "ready" ||
        selected.snapshot.auth.status !== "authenticated"
      ) {
        return yield* new GrokReviewError({
          operation: "GrokReviewService.run",
          detail:
            "The selected Aldo Review provider is not connected and ready. Connect it in provider settings before running the review swarm.",
        });
      }

      const selectedModel =
        input.model ??
        (selected.instance.driverKind === GROK_DRIVER_KIND
          ? DEFAULT_GROK_REVIEW_MODEL
          : (selected.snapshot.models?.find((model) => model.isDefault)?.slug ??
            selected.snapshot.models?.[0]?.slug));
      if (!selectedModel) {
        return yield* new GrokReviewError({
          operation: "GrokReviewService.run",
          detail: "The selected Aldo Review provider has no available model.",
        });
      }
      const modelIsAvailable =
        selected.snapshot.models?.some((model) => model.slug === selectedModel) ?? false;
      if (
        !modelIsAvailable &&
        !(
          selected.instance.driverKind === GROK_DRIVER_KIND &&
          selectedModel === DEFAULT_GROK_REVIEW_MODEL
        )
      ) {
        return yield* new GrokReviewError({
          operation: "GrokReviewService.run",
          detail: `The selected Aldo Review model '${selectedModel}' is no longer available.`,
        });
      }

      const useSpecializedGrokRunner =
        selected.instance.driverKind === GROK_DRIVER_KIND &&
        selectedModel === DEFAULT_GROK_REVIEW_MODEL &&
        selected.instance.codeReview !== undefined;
      const runner = useSpecializedGrokRunner
        ? selected.instance.codeReview!
        : makeProviderCodeReview({
            textGeneration: selected.instance.textGeneration,
            modelSelection: {
              instanceId: selected.instance.instanceId,
              model: selectedModel,
            },
            driver: selected.instance.driverKind,
            providerLabel: selected.snapshot.displayName ?? selected.instance.driverKind,
          });
      const supplementalCandidate = requestedSupplementalInstanceId
        ? candidates.find(
            (candidate) =>
              candidate.instance.instanceId === requestedSupplementalInstanceId &&
              candidate.instance.instanceId !== selected.instance.instanceId &&
              candidate.instance.driverKind === OPENCODE_DRIVER_KIND &&
              readyCandidate(candidate) &&
              selectOpenWeightReviewModel(candidate.snapshot.models ?? []) !== undefined,
          )
        : requestedInstanceId
          ? undefined
          : candidates.find(
              (candidate) =>
                candidate.instance.instanceId !== selected.instance.instanceId &&
                candidate.instance.driverKind === OPENCODE_DRIVER_KIND &&
                readyCandidate(candidate) &&
                selectOpenWeightReviewModel(candidate.snapshot.models ?? []) !== undefined,
            );
      const supplementalModel = supplementalCandidate
        ? selectOpenWeightReviewModel(supplementalCandidate.snapshot.models ?? [])
        : undefined;
      const supplementalAgent =
        supplementalCandidate && supplementalModel
          ? makeProviderReviewAgent({
              textGeneration: supplementalCandidate.instance.textGeneration,
              modelSelection: {
                instanceId: supplementalCandidate.instance.instanceId,
                model: supplementalModel,
              },
              driver: supplementalCandidate.instance.driverKind,
              providerLabel:
                supplementalCandidate.snapshot.displayName ??
                supplementalCandidate.instance.driverKind,
            })
          : undefined;
      const result = yield* runner
        .run({
          request: { ...input, model: selectedModel },
          source,
          ...(supplementalAgent
            ? { supplementalAgent }
            : {
                supplementalUnavailableReason:
                  "OpenCode Nemotron 3 Ultra supplemental reviewers were unavailable.",
              }),
        })
        .pipe(Effect.timeoutOption(GROK_REVIEW_TIMEOUT_MS));
      if (Option.isNone(result)) {
        return yield* new GrokReviewError({
          operation: "GrokReviewService.run",
          detail: "The Aldo Review swarm exceeded its ten-minute time limit.",
        });
      }
      return result.value;
    },
  );

  return GrokReviewService.of({ run });
});

export const layer = Layer.effect(GrokReviewService, make);

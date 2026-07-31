import {
  GrokReviewError,
  type GrokReviewInput,
  type GrokReviewReport,
  type GrokReviewRunError,
  ProviderDriverKind,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import * as ReviewService from "./ReviewService.ts";

const GROK_DRIVER_KIND = ProviderDriverKind.make("grok");

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
          operation: "GrokReviewService.run",
          detail: `There are no ${preferredTarget} changes to review.`,
        });
      }

      const instance = input.grokProviderInstanceId
        ? yield* providerInstances.getInstance(input.grokProviderInstanceId)
        : (yield* providerInstances.listInstances).find(
            (candidate) =>
              candidate.driverKind === GROK_DRIVER_KIND &&
              candidate.enabled &&
              candidate.codeReview !== undefined,
          );
      if (
        !instance ||
        instance.driverKind !== GROK_DRIVER_KIND ||
        !instance.enabled ||
        !instance.codeReview
      ) {
        return yield* new GrokReviewError({
          operation: "GrokReviewService.run",
          detail:
            "No enabled Grok Build provider instance is available. Connect Grok Build in provider settings before running the review swarm.",
        });
      }

      return yield* instance.codeReview.run({ request: input, source });
    },
  );

  return GrokReviewService.of({ run });
});

export const layer = Layer.effect(GrokReviewService, make);

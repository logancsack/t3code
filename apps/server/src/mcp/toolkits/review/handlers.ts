import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as GrokReviewService from "../../../review/GrokReviewService.ts";
import { GrokReviewToolkit } from "./tools.ts";

export const GrokReviewToolkitHandlersLive = GrokReviewToolkit.toLayer({
  aldo_review: (input) =>
    Effect.gen(function* () {
      yield* McpInvocationContext.requireMcpReviewCapability();
      const review = yield* GrokReviewService.GrokReviewService;
      return yield* review.run(input);
    }),
  grok_review: (input) =>
    Effect.gen(function* () {
      yield* McpInvocationContext.requireMcpReviewCapability();
      const review = yield* GrokReviewService.GrokReviewService;
      return yield* review.run(input);
    }),
});

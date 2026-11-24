import type { GrokReviewInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpToolAccess from "../../McpToolAccess.ts";
import * as GrokReviewService from "../../../review/GrokReviewService.ts";
import { ReviewToolkit } from "./tools.ts";

const run = McpToolAccess.readsAsCaller((input: GrokReviewInput) =>
  Effect.flatMap(GrokReviewService.GrokReviewService, (review) => review.run(input)),
);

const handlers = {
  aldo_review: run,
  grok_review: run,
} satisfies McpToolAccess.Handlers<typeof ReviewToolkit.tools>;

export const layer = McpToolAccess.toLayer(ReviewToolkit, handlers);

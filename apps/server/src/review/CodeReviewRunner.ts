import type {
  GrokReviewError,
  GrokReviewInput,
  GrokReviewReport,
  ReviewDiffPreviewSource,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type { GrokReviewAgent } from "./GrokReviewAgent.ts";

export interface CodeReviewRunner {
  readonly run: (input: {
    readonly request: GrokReviewInput;
    readonly source: ReviewDiffPreviewSource;
    readonly supplementalAgent?: GrokReviewAgent;
    readonly supplementalUnavailableReason?: string;
  }) => Effect.Effect<GrokReviewReport, GrokReviewError>;
}

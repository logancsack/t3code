import type {
  GrokReviewError,
  GrokReviewInput,
  GrokReviewReport,
  ReviewDiffPreviewSource,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

export interface CodeReviewRunner {
  readonly run: (input: {
    readonly request: GrokReviewInput;
    readonly source: ReviewDiffPreviewSource;
  }) => Effect.Effect<GrokReviewReport, GrokReviewError>;
}

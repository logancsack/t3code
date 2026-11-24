import type {
  GrokReviewError,
  GrokReviewInput,
  GrokReviewReport,
  GrokReviewTarget,
  ReviewDiffPreviewSource,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

export type CodeReviewSource = ReviewDiffPreviewSource & { readonly kind: GrokReviewTarget };

export interface CodeReviewRunner {
  readonly run: (input: {
    readonly request: GrokReviewInput;
    readonly source: CodeReviewSource;
  }) => Effect.Effect<GrokReviewReport, GrokReviewError>;
}

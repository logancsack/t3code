import * as Schema from "effect/Schema";
import { EnvironmentId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { VcsError } from "./vcs.ts";

export const ReviewDiffPreviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: Schema.optional(TrimmedNonEmptyString),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type ReviewDiffPreviewInput = typeof ReviewDiffPreviewInput.Type;

export const ReviewDiffPreviewSourceKind = Schema.Literals(["working-tree", "branch-range"]);
export type ReviewDiffPreviewSourceKind = typeof ReviewDiffPreviewSourceKind.Type;

export const ReviewDiffPreviewSource = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ReviewDiffPreviewSourceKind,
  title: TrimmedNonEmptyString,
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  diff: Schema.String,
  diffHash: TrimmedNonEmptyString,
  truncated: Schema.Boolean,
});
export type ReviewDiffPreviewSource = typeof ReviewDiffPreviewSource.Type;

export const ReviewDiffPreviewResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  generatedAt: Schema.DateTimeUtc,
  sources: Schema.Array(ReviewDiffPreviewSource),
});
export type ReviewDiffPreviewResult = typeof ReviewDiffPreviewResult.Type;

export const ReviewDiffPreviewError = Schema.Union([VcsError, GitCommandError]);
export type ReviewDiffPreviewError = typeof ReviewDiffPreviewError.Type;

export const GrokReviewTarget = Schema.Literals(["working-tree", "branch-range"]);
export type GrokReviewTarget = typeof GrokReviewTarget.Type;

export const GrokReviewReasoningEffort = Schema.Literals(["medium", "high"]);
export type GrokReviewReasoningEffort = typeof GrokReviewReasoningEffort.Type;
const GrokReviewFocusEntry = TrimmedNonEmptyString.check(Schema.isMaxLength(300));
const GrokReviewContextTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(120));
const GrokReviewContextContent = TrimmedNonEmptyString.check(Schema.isMaxLength(30_000));
const GrokReviewContextLimitation = TrimmedNonEmptyString.check(Schema.isMaxLength(300));
export const GROK_REVIEW_CONTEXT_MAX_CHARS = 120_000;
const GrokReviewContextSections = Schema.Array(
  Schema.Struct({
    title: GrokReviewContextTitle,
    content: GrokReviewContextContent,
  }),
).check(
  Schema.isMaxLength(8),
  Schema.makeFilter(
    (sections) =>
      sections.reduce((total, section) => total + section.content.length, 0) <=
        GROK_REVIEW_CONTEXT_MAX_CHARS ||
      `Repository context must not exceed ${GROK_REVIEW_CONTEXT_MAX_CHARS} total characters.`,
  ),
);

export const GrokReviewContext = Schema.Struct({
  sections: GrokReviewContextSections,
  limitations: Schema.Array(GrokReviewContextLimitation).check(Schema.isMaxLength(8)),
});
export type GrokReviewContext = typeof GrokReviewContext.Type;

export const GrokReviewSeverity = Schema.Literals(["blocker", "high", "medium", "low"]);
export type GrokReviewSeverity = typeof GrokReviewSeverity.Type;

export const GrokReviewStatus = Schema.Literals(["pass", "findings", "partial", "failed"]);
export type GrokReviewStatus = typeof GrokReviewStatus.Type;

export const GrokReviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  target: Schema.optionalKey(GrokReviewTarget),
  baseRef: Schema.optionalKey(TrimmedNonEmptyString),
  focus: Schema.optionalKey(Schema.Array(GrokReviewFocusEntry).check(Schema.isMaxLength(8))),
  providerInstanceId: Schema.optionalKey(ProviderInstanceId),
  model: Schema.optionalKey(TrimmedNonEmptyString),
  context: Schema.optionalKey(GrokReviewContext),
  /** @deprecated Use providerInstanceId. */
  grokProviderInstanceId: Schema.optionalKey(ProviderInstanceId),
});
export type GrokReviewInput = typeof GrokReviewInput.Type;

export const GrokReviewFinding = Schema.Struct({
  fingerprint: TrimmedNonEmptyString,
  severity: GrokReviewSeverity,
  confidence: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  category: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  startLine: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  endLine: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  inlineEligible: Schema.Boolean,
  evidence: TrimmedNonEmptyString,
  impact: TrimmedNonEmptyString,
  suggestion: TrimmedNonEmptyString,
  verification: Schema.optionalKey(TrimmedNonEmptyString),
}).check(
  Schema.makeFilter(
    (finding) =>
      finding.endLine === undefined ||
      (finding.startLine !== undefined && finding.endLine >= finding.startLine) ||
      "endLine requires startLine and must be greater than or equal to it.",
  ),
);
export type GrokReviewFinding = typeof GrokReviewFinding.Type;

export const GrokReviewUsage = Schema.Struct({
  agentRuns: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  mediumEffortRuns: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  highEffortRuns: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type GrokReviewUsage = typeof GrokReviewUsage.Type;

export const GrokReviewReport = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: TrimmedNonEmptyString,
  target: Schema.Struct({
    kind: GrokReviewTarget,
    baseRef: Schema.NullOr(TrimmedNonEmptyString),
    headRef: Schema.NullOr(TrimmedNonEmptyString),
    diffHash: TrimmedNonEmptyString,
  }),
  status: GrokReviewStatus,
  resolvedModel: TrimmedNonEmptyString,
  supplementalModels: Schema.optionalKey(
    Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(4)),
  ),
  grokBuildVersion: Schema.NullOr(TrimmedNonEmptyString),
  reasoningEffort: GrokReviewReasoningEffort,
  escalatedToHigh: Schema.Boolean,
  summary: TrimmedNonEmptyString,
  findings: Schema.Array(GrokReviewFinding),
  coverage: Schema.Array(TrimmedNonEmptyString),
  limitations: Schema.Array(TrimmedNonEmptyString),
  usage: GrokReviewUsage,
  markdown: TrimmedNonEmptyString,
});
export type GrokReviewReport = typeof GrokReviewReport.Type;

export class GrokReviewError extends Schema.TaggedErrorClass<GrokReviewError>()("GrokReviewError", {
  operation: TrimmedNonEmptyString,
  detail: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}

export class GrokReviewUnavailableError extends Schema.TaggedErrorClass<GrokReviewUnavailableError>()(
  "GrokReviewUnavailableError",
  {
    capability: Schema.Literal("review"),
    environmentId: EnvironmentId,
    threadId: ThreadId,
    providerSessionId: TrimmedNonEmptyString,
    providerInstanceId: ProviderInstanceId,
  },
) {
  override get message(): string {
    return `MCP credential does not grant the ${this.capability} capability.`;
  }
}

export const GrokReviewRunError = Schema.Union([
  ReviewDiffPreviewError,
  GrokReviewError,
  GrokReviewUnavailableError,
]);
export type GrokReviewRunError = typeof GrokReviewRunError.Type;

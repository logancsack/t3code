import type {
  GrokReviewFinding,
  GrokReviewReasoningEffort,
  GrokReviewReport,
  GrokReviewSeverity,
  GrokReviewStatus,
} from "@t3tools/contracts";
import { TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const MAX_REVIEW_FINDINGS = 20;
export const MAX_REVIEW_LIST_ENTRIES = 8;
export const MAX_REVIEW_SUMMARY_CHARS = 2_000;
export const MAX_REVIEW_CATEGORY_CHARS = 120;
export const MAX_REVIEW_TITLE_CHARS = 240;
export const MAX_REVIEW_PATH_CHARS = 500;
export const MAX_REVIEW_EVIDENCE_CHARS = 500;
export const MAX_REVIEW_IMPACT_CHARS = 350;
export const MAX_REVIEW_SUGGESTION_CHARS = 500;
export const MAX_REVIEW_VERIFICATION_CHARS = 350;
export const MAX_REVIEW_LIST_ENTRY_CHARS = 300;
export const MAX_REVIEW_DELEGATION_CHARS = 800;
export const MAX_REVIEW_DELEGATION_PATHS = 8;

const boundedNonEmpty = (maxLength: number) =>
  TrimmedNonEmptyString.check(Schema.isMaxLength(maxLength));
const PositiveLine = Schema.Int.check(Schema.isGreaterThan(0));
const Confidence = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

export const GrokReviewCandidateFinding = Schema.Struct({
  severity: Schema.Literals(["blocker", "high", "medium", "low"]),
  confidence: Confidence,
  category: boundedNonEmpty(MAX_REVIEW_CATEGORY_CHARS),
  title: boundedNonEmpty(MAX_REVIEW_TITLE_CHARS),
  path: boundedNonEmpty(MAX_REVIEW_PATH_CHARS),
  startLine: Schema.optionalKey(PositiveLine),
  endLine: Schema.optionalKey(PositiveLine),
  evidence: boundedNonEmpty(MAX_REVIEW_EVIDENCE_CHARS),
  impact: boundedNonEmpty(MAX_REVIEW_IMPACT_CHARS),
  suggestion: boundedNonEmpty(MAX_REVIEW_SUGGESTION_CHARS),
  verification: Schema.optionalKey(boundedNonEmpty(MAX_REVIEW_VERIFICATION_CHARS)),
});
export type GrokReviewCandidateFinding = typeof GrokReviewCandidateFinding.Type;

export const GrokReviewDelegation = Schema.Struct({
  objective: boundedNonEmpty(MAX_REVIEW_DELEGATION_CHARS),
  paths: Schema.Array(boundedNonEmpty(MAX_REVIEW_PATH_CHARS)).check(
    Schema.isMaxLength(MAX_REVIEW_DELEGATION_PATHS),
  ),
});
export type GrokReviewDelegation = typeof GrokReviewDelegation.Type;

export const GrokReviewCandidate = Schema.Struct({
  summary: boundedNonEmpty(MAX_REVIEW_SUMMARY_CHARS),
  findings: Schema.Array(GrokReviewCandidateFinding).check(Schema.isMaxLength(MAX_REVIEW_FINDINGS)),
  coverage: Schema.Array(boundedNonEmpty(MAX_REVIEW_LIST_ENTRY_CHARS)).check(
    Schema.isMaxLength(MAX_REVIEW_LIST_ENTRIES),
  ),
  limitations: Schema.Array(boundedNonEmpty(MAX_REVIEW_LIST_ENTRY_CHARS)).check(
    Schema.isMaxLength(MAX_REVIEW_LIST_ENTRIES),
  ),
  delegation: Schema.NullOr(GrokReviewDelegation),
});
export type GrokReviewCandidate = typeof GrokReviewCandidate.Type;

export const GrokReviewVerification = Schema.Struct({
  summary: boundedNonEmpty(MAX_REVIEW_SUMMARY_CHARS),
  findings: Schema.Array(GrokReviewCandidateFinding).check(Schema.isMaxLength(MAX_REVIEW_FINDINGS)),
  coverage: Schema.Array(boundedNonEmpty(MAX_REVIEW_LIST_ENTRY_CHARS)).check(
    Schema.isMaxLength(MAX_REVIEW_LIST_ENTRIES),
  ),
  limitations: Schema.Array(boundedNonEmpty(MAX_REVIEW_LIST_ENTRY_CHARS)).check(
    Schema.isMaxLength(MAX_REVIEW_LIST_ENTRIES),
  ),
  needsHighEffortReview: Schema.Boolean,
  escalationReason: Schema.NullOr(Schema.String.check(Schema.isMaxLength(800))),
});
export type GrokReviewVerification = typeof GrokReviewVerification.Type;

const severityRank: Readonly<Record<GrokReviewSeverity, number>> = {
  blocker: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function sortFindings(
  findings: ReadonlyArray<GrokReviewFinding>,
): ReadonlyArray<GrokReviewFinding> {
  return findings.toSorted((left, right) => {
    const severity = severityRank[left.severity] - severityRank[right.severity];
    if (severity !== 0) return severity;
    const path = left.path.localeCompare(right.path);
    if (path !== 0) return path;
    return (
      (left.startLine ?? Number.MAX_SAFE_INTEGER) - (right.startLine ?? Number.MAX_SAFE_INTEGER)
    );
  });
}

export function deriveReviewStatus(input: {
  readonly findings: ReadonlyArray<GrokReviewFinding>;
  readonly partial: boolean;
}): GrokReviewStatus {
  if (input.partial) return "partial";
  return input.findings.length === 0 ? "pass" : "findings";
}

function findingLocation(finding: GrokReviewFinding): string {
  if (finding.startLine === undefined) return finding.path;
  if (finding.endLine !== undefined && finding.endLine !== finding.startLine) {
    return `${finding.path}:${finding.startLine}-${finding.endLine}`;
  }
  return `${finding.path}:${finding.startLine}`;
}

export function renderGrokReviewMarkdown(input: {
  readonly status: GrokReviewStatus;
  readonly summary: string;
  readonly findings: ReadonlyArray<GrokReviewFinding>;
  readonly coverage: ReadonlyArray<string>;
  readonly limitations: ReadonlyArray<string>;
  readonly model: string;
  readonly reasoningEffort: GrokReviewReasoningEffort;
  readonly escalatedToHigh: boolean;
  readonly runId: string;
}): string {
  const lines = [
    "## Aldo Grok review",
    "",
    input.summary.trim(),
    "",
    `**Result:** ${input.status} · **Model:** ${input.model} · **Reasoning:** ${
      input.escalatedToHigh ? "medium → high" : input.reasoningEffort
    }`,
  ];

  if (input.findings.length === 0) {
    lines.push("", "No actionable findings were verified.");
  } else {
    lines.push("", `### Findings (${input.findings.length})`);
    for (const finding of input.findings) {
      lines.push(
        "",
        `#### ${finding.severity.toUpperCase()}: ${finding.title}`,
        "",
        `\`${findingLocation(finding)}\` · confidence ${Math.round(finding.confidence * 100)}%`,
        "",
        finding.impact,
        "",
        `Evidence: ${finding.evidence}`,
        "",
        `Suggested change: ${finding.suggestion}`,
      );
      if (finding.verification) {
        lines.push("", `Verification: ${finding.verification}`);
      }
    }
  }

  if (input.coverage.length > 0) {
    lines.push("", "### Coverage", "", ...input.coverage.map((entry) => `- ${entry}`));
  }
  if (input.limitations.length > 0) {
    lines.push("", "### Limitations", "", ...input.limitations.map((entry) => `- ${entry}`));
  }
  lines.push("", `<!-- aldo-grok-review:${input.runId} -->`);
  return lines.join("\n");
}

export function withMarkdown(report: Omit<GrokReviewReport, "markdown">): GrokReviewReport {
  return {
    ...report,
    markdown: renderGrokReviewMarkdown({
      status: report.status,
      summary: report.summary,
      findings: report.findings,
      coverage: report.coverage,
      limitations: report.limitations,
      model: report.resolvedModel,
      reasoningEffort: report.reasoningEffort,
      escalatedToHigh: report.escalatedToHigh,
      runId: report.runId,
    }),
  };
}
